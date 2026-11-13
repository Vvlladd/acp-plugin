#!/usr/bin/env python3
"""Narrow socket client for host-confirmed ACP worktree retirement.

The client deliberately exposes only retention inventory and retirement.  In retirement mode it
keeps one socket connection open while the host shows the preview and obtains a real human answer.
The host must echo that exact preview back; this process cannot establish human provenance.
"""

import argparse
import json
import os
from pathlib import Path
import socket
import stat
import sys
import time
from typing import Optional
import uuid


class ContractRefusal(ValueError):
    """The daemon response, selected item, or host response is unsafe to relay."""


REQUIRED_ITEM = {
    "runId": str,
    "lineageId": str,
    "seq": int,
    "confirmationToken": str,
    "worktree": str,
    "branch": str,
    "integratedSha": str,
    "disposition": str,
    "reason": str,
    "retired": bool,
}


class RetentionClient:
    def __init__(self, socket_path: Optional[Path], repository: Path, socket_fd=None):
        if (socket_path is None or not socket_path.is_absolute()) and socket_fd is None:
            raise ContractRefusal("socket path must be absolute")
        if not repository.is_absolute():
            raise ContractRefusal("repository path must be absolute")
        self.repository = str(repository.resolve(strict=True))
        if socket_fd is None:
            self.stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.stream.connect(str(socket_path))
        else:  # Offline fixtures can inject a connected socket without touching a real daemon.
            self.stream = socket.socket(fileno=socket_fd)
        self.reader = self.stream.makefile("r", encoding="utf-8")
        self.writer = self.stream.makefile("w", encoding="utf-8")
        self.next_id = 1
        hello = self.call("hello", {"clientName": "acp-host-retention", "clientVersion": "1"})
        if hello.get("protocolVersion") != 1:
            raise ContractRefusal(
                f"unsupported daemon protocol {hello.get('protocolVersion')!r}; no request sent"
            )
        daemon_repo = hello.get("repoRoot")
        if not isinstance(daemon_repo, str):
            raise ContractRefusal("daemon hello did not identify its repository")
        if str(Path(daemon_repo).resolve(strict=True)) != self.repository:
            raise ContractRefusal("connected daemon belongs to a different repository")

    def close(self):
        for handle in (self.writer, self.reader):
            try:
                handle.close()
            except OSError:
                pass
        self.stream.close()

    def call(self, method, params):
        request_id = self.next_id
        self.next_id += 1
        frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        self.writer.write(json.dumps(frame, separators=(",", ":")) + "\n")
        self.writer.flush()
        while True:
            line = self.reader.readline()
            if not line:
                raise ContractRefusal(f"daemon disconnected during {method}; outcome is unknown")
            try:
                reply = json.loads(line)
            except json.JSONDecodeError as error:
                raise ContractRefusal(f"daemon returned invalid JSON during {method}") from error
            if reply.get("id") != request_id:
                continue
            if "error" in reply:
                error = reply["error"]
                message = error.get("message", "rejected") if isinstance(error, dict) else "rejected"
                raise ContractRefusal(f"{method} rejected: {message}")
            if "result" not in reply:
                raise ContractRefusal(f"daemon returned no result for {method}")
            return reply["result"]


def validate_inventory(value):
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        raise ContractRefusal("retention.inventory returned no items array")
    if not isinstance(value.get("truncated"), bool):
        raise ContractRefusal("retention.inventory returned no truncation flag")
    return value


def validate_item(value):
    if not isinstance(value, dict):
        raise ContractRefusal("inventory item is not an object")
    for name, expected in REQUIRED_ITEM.items():
        actual = value.get(name)
        # bool is an int in Python, but a sequence must not be true/false.
        if not isinstance(actual, expected) or (expected is int and isinstance(actual, bool)):
            raise ContractRefusal(f"eligible inventory item has invalid {name}")
        if expected is str and not actual:
            raise ContractRefusal(f"eligible inventory item has empty {name}")
    if value["disposition"] != "eligible":
        raise ContractRefusal("selected worktree is not eligible")
    if not Path(value["worktree"]).is_absolute():
        raise ContractRefusal("eligible worktree path is not absolute")
    return {name: value[name] for name in REQUIRED_ITEM}


def select_item(inventory, run_id, lineage_id):
    if inventory["truncated"] and lineage_id is None:
        raise ContractRefusal("inventory is truncated; select an exact lineage")
    matches = [item for item in inventory["items"]
               if isinstance(item, dict)
               and item.get("runId") == run_id
               and (lineage_id is None or item.get("lineageId") == lineage_id)
               and item.get("disposition") == "eligible"]
    if not matches:
        raise ContractRefusal("no eligible worktree matches the explicit run and lineage")
    if len(matches) != 1:
        raise ContractRefusal("more than one eligible lineage matches; select an exact lineage")
    return validate_item(matches[0])


def request_from(item):
    return {
        "requestId": str(uuid.uuid4()),
        "runId": item["runId"],
        "lineageId": item["lineageId"],
        "expectedSeq": item["seq"],
        "previewToken": item["confirmationToken"],
        "worktree": item["worktree"],
        "branch": item["branch"],
        "integratedSha": item["integratedSha"],
    }


def validate_outcome(value, request):
    if not isinstance(value, dict):
        raise ContractRefusal("retirement response was not an object")
    for name in ("requestId", "runId", "lineageId", "worktree"):
        if value.get(name) != request[name]:
            raise ContractRefusal(f"retirement response did not bind the original {name}")
    for name in ("preservedRef", "restorePath"):
        if not isinstance(value.get(name), str):
            raise ContractRefusal(f"retirement response has invalid {name}")
    if not value["preservedRef"]:
        raise ContractRefusal("retirement response has no preserved ref")
    for name in ("diskSpaceReclaimed", "removed", "alreadyRetired"):
        if not isinstance(value.get(name), bool):
            raise ContractRefusal(f"retirement response has invalid {name}")
    return value


def json_exact(left, right):
    """Compare decoded JSON without Python's bool/int and int/float coercions."""

    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(
            json_exact(left[key], right[key]) for key in left
        )
    if isinstance(left, list):
        return len(left) == len(right) and all(
            json_exact(left_item, right_item)
            for left_item, right_item in zip(left, right)
        )
    return left == right


def parse_host_answer(line, request_id, preview):
    try:
        answer = json.loads(line)
    except json.JSONDecodeError as error:
        raise ContractRefusal("host answer was not JSON; no retirement sent") from error
    if not isinstance(answer, dict) or set(answer) - {"decision", "requestId", "preview"}:
        raise ContractRefusal("host answer has an invalid shape; no retirement sent")
    decision = answer.get("decision")
    if decision in {"wait", "deny"}:
        return decision
    if decision != "retire":
        raise ContractRefusal("host did not provide an explicit retirement answer")
    if answer.get("requestId") != request_id:
        raise ContractRefusal("host answer does not match this retirement request")
    if not json_exact(answer.get("preview"), preview):
        raise ContractRefusal("approved preview does not exactly match the original preview")
    return decision


def prepare_answer_file(answer_file):
    if answer_file is None:
        return None
    path = Path(answer_file)
    if not path.is_absolute():
        raise ContractRefusal("answer file path must be absolute")
    if path.exists() or path.is_symlink():
        raise ContractRefusal("answer file already exists; refusing a stale or reused answer")
    return path


def read_host_answer(answer_path):
    if answer_path is None:
        return sys.stdin.readline()
    path = answer_path
    while True:
        try:
            first = os.lstat(path)
        except FileNotFoundError:
            time.sleep(0.2)
            continue
        except OSError as error:
            raise ContractRefusal(f"answer file is unavailable: {error}") from error
        if not stat.S_ISREG(first.st_mode):
            raise ContractRefusal("answer file is not a regular file")
        time.sleep(0.1)
        try:
            second = os.lstat(path)
        except FileNotFoundError:
            continue
        if (first.st_dev, first.st_ino) != (second.st_dev, second.st_ino):
            raise ContractRefusal("answer file identity changed while being read")
        if first.st_size == 0 or (first.st_size, first.st_mtime_ns) != (second.st_size, second.st_mtime_ns):
            continue
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError as error:
            raise ContractRefusal(f"answer file is unavailable: {error}") from error
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            metadata = os.fstat(handle.fileno())
            if (metadata.st_dev, metadata.st_ino) != (second.st_dev, second.st_ino):
                raise ContractRefusal("answer file identity changed while being opened")
            line = handle.readline(1_000_001)
            if len(line) > 1_000_000:
                raise ContractRefusal("answer file is too large")
            return line


def print_json(value):
    print(json.dumps(value, sort_keys=True), flush=True)


def run(args):
    client = RetentionClient(Path(args.socket) if args.socket else None, Path(args.repo), args.socket_fd)
    try:
        inventory = validate_inventory(client.call("retention.inventory", {}))
        if args.action == "inventory":
            print_json({"type": "inventory", "repository": client.repository, **inventory})
            return 0
        preview = select_item(inventory, args.run_id, args.lineage_id)
        request = request_from(preview)
        answer_path = prepare_answer_file(args.answer_file)
        print_json({"type": "retirementPreview", "requestId": request["requestId"],
                    "repository": client.repository,
                    "inventoryTruncated": inventory["truncated"], "item": preview})
        answer_line = read_host_answer(answer_path)
        if not answer_line:
            raise ContractRefusal("no explicit host answer received; no retirement sent")
        decision = parse_host_answer(answer_line, request["requestId"], preview)
        if decision != "retire":
            print_json({"type": "retirementNotSent", "decision": decision})
            return 0
        outcome = validate_outcome(client.call("retention.retire", request), request)
        print_json({"type": "retirementOutcome", "request": request, "outcome": outcome})
        return 0
    finally:
        client.close()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    connection = result.add_mutually_exclusive_group(required=True)
    connection.add_argument("--socket", help="absolute acp.sock path reported for the selected repo")
    connection.add_argument("--socket-fd", type=int, help=argparse.SUPPRESS)
    result.add_argument("--repo", required=True, help="absolute selected repository root")
    result.add_argument("--answer-file", help="new host-owned file used by background-capable hosts")
    commands = result.add_subparsers(dest="action", required=True)
    commands.add_parser("inventory")
    retire = commands.add_parser("retire")
    retire.add_argument("--run-id", required=True)
    retire.add_argument("--lineage-id")
    return result


if __name__ == "__main__":
    try:
        sys.exit(run(parser().parse_args()))
    except (ContractRefusal, OSError) as error:
        print(json.dumps({"type": "retentionError", "message": str(error)}), file=sys.stderr)
        sys.exit(2)
