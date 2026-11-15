#!/usr/bin/env python3
"""Offline Unix-socket fixtures for the host retention entry point."""

import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "plugins/acp/scripts/retention_contract.py"


def item(run="run-42", lineage="lineage-7", sequence=81):
    return {
        "runId": run,
        "lineageId": lineage,
        "seq": sequence,
        "confirmationToken": "fixture-token",
        "worktree": "/tmp/disposable-acp-worktree",
        "branch": "acp/run-42/builder",
        "integratedSha": "031f62b",
        "disposition": "eligible",
        "reason": "completed integration is recorded",
        "retired": False,
    }


class SocketFixture:
    def __init__(self, directory, repository, inventory, retire="success", filter_inventory=False):
        self.directory = directory
        self.repository = str(repository)
        self.inventory = inventory
        self.retire = retire
        self.filter_inventory = filter_inventory
        self.calls = []
        self.connections = []
        self.server, self.client = socket.socketpair()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        try:
            with self.server as connection:
                reader = connection.makefile("r", encoding="utf-8")
                writer = connection.makefile("w", encoding="utf-8")
                for line in reader:
                    request = json.loads(line)
                    method = request["method"]
                    self.calls.append((method, request["params"]))
                    self.connections.append(1)
                    if method == "hello":
                        result = {"protocolVersion": 1, "repoRoot": self.repository,
                                  "stateDir": str(self.directory), "pid": 123}
                        response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
                    elif method == "retention.inventory":
                        if self.retire == "older":
                            response = {"jsonrpc": "2.0", "id": request["id"],
                                        "error": {"code": -32601, "message": "unknown method"}}
                        elif self.retire == "older_scoped" and request["params"]:
                            response = {"jsonrpc": "2.0", "id": request["id"],
                                        "error": {"code": -32602,
                                                  "message": "invalid inventory fields"}}
                        elif self.filter_inventory:
                            params = request["params"]
                            if set(params) - {"runId", "lineageId"}:
                                response = {"jsonrpc": "2.0", "id": request["id"],
                                            "error": {"code": -32602,
                                                      "message": "invalid inventory fields"}}
                            else:
                                matches = [candidate for candidate in self.inventory["items"]
                                           if (params.get("runId") is None
                                               or candidate.get("runId") == params["runId"])
                                           and (params.get("lineageId") is None
                                                or candidate.get("lineageId")
                                                == params["lineageId"])]
                                result = {"items": matches[:128], "truncated": len(matches) > 128}
                                response = {"jsonrpc": "2.0", "id": request["id"],
                                            "result": result}
                        else:
                            response = {"jsonrpc": "2.0", "id": request["id"],
                                        "result": self.inventory}
                    elif method == "retention.retire":
                        if self.retire == "disconnect":
                            return
                        params = request["params"]
                        expected = {"requestId", "runId", "lineageId", "expectedSeq", "worktree",
                                    "branch", "integratedSha", "previewToken"}
                        if set(params) != expected:
                            response = {"jsonrpc": "2.0", "id": request["id"],
                                        "error": {"code": -32602, "message": "invalid retirement fields"}}
                            writer.write(json.dumps(response) + "\n")
                            writer.flush()
                            continue
                        outcome = {
                            "requestId": params["requestId"], "runId": params["runId"],
                            "lineageId": params["lineageId"], "worktree": params["worktree"],
                            "preservedRef": "refs/acp/retained/run-42/lineage-7",
                            "restorePath": "/tmp/fake-trash/disposable-acp-worktree",
                            "diskSpaceReclaimed": False, "removed": True,
                            "alreadyRetired": False,
                        }
                        response = {"jsonrpc": "2.0", "id": request["id"], "result": outcome}
                    else:
                        raise AssertionError(f"unexpected method {method}")
                    writer.write(json.dumps(response) + "\n")
                    writer.flush()
        except OSError:
            return

    def close(self):
        self.server.close()
        self.client.close()
        self.thread.join(timeout=1)


class RetentionContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT)
        self.directory = Path(self.temporary.name)
        self.repository = self.directory / "repo"
        self.repository.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, action, *extra):
        return [sys.executable, str(HELPER), "--socket-fd", str(self.fixture.client.fileno()),
                "--repo", str(self.repository), action, *extra]

    def start(self, inventory=None, retire="success", filter_inventory=False):
        self.fixture = SocketFixture(self.directory, self.repository,
                                     inventory or {"items": [item()], "truncated": False}, retire,
                                     filter_inventory)
        self.addCleanup(self.fixture.close)

    def test_inventory_uses_only_the_bound_socket_method(self):
        self.start()
        completed = subprocess.run(self.command("inventory"), text=True, capture_output=True,
                                   pass_fds=(self.fixture.client.fileno(),),
                                   timeout=5, check=True)
        output = json.loads(completed.stdout)
        self.assertEqual(output["type"], "inventory")
        self.assertEqual(output["repository"], str(self.repository))
        self.assertEqual([call[0] for call in self.fixture.calls],
                         ["hello", "retention.inventory"])
        self.assertEqual(self.fixture.calls[-1][1], {})

    def test_filter_aware_socket_selects_item_after_bounded_129_item_inventory(self):
        earlier = [item(run=f"run-{index:03}", lineage=f"lineage-{index:03}",
                        sequence=index)
                   for index in range(128)]
        target = {**item(run="run-target", lineage="lineage-target", sequence=129),
                  "confirmationToken": "daemon-token-after-page"}
        inventory = {"items": earlier + [target], "truncated": False}

        self.start(inventory, filter_inventory=True)
        ordinary = subprocess.run(self.command("inventory"), text=True, capture_output=True,
                                  pass_fds=(self.fixture.client.fileno(),),
                                  timeout=5, check=True)
        ordinary_output = json.loads(ordinary.stdout)
        self.assertEqual(len(ordinary_output["items"]), 128)
        self.assertTrue(ordinary_output["truncated"])
        self.assertEqual(self.fixture.calls[-1][1], {})
        self.fixture.close()
        self.doCleanups()

        self.start(inventory, filter_inventory=True)
        process = subprocess.Popen(
            self.command("retire", "--run-id", "run-target",
                         "--lineage-id", "lineage-target"),
            text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            pass_fds=(self.fixture.client.fileno(),))
        envelope = json.loads(process.stdout.readline())
        self.assertEqual(envelope["item"], target)
        self.assertFalse(envelope["inventoryTruncated"])
        answer = {"decision": "retire", "requestId": envelope["requestId"],
                  "preview": envelope["item"]}
        stdout, stderr = process.communicate(json.dumps(answer) + "\n", timeout=5)
        self.assertEqual(process.returncode, 0, stderr)
        request = json.loads(stdout)["request"]
        self.assertEqual(request["previewToken"], "daemon-token-after-page")
        self.assertEqual(self.fixture.calls[1],
                         ("retention.inventory",
                          {"runId": "run-target", "lineageId": "lineage-target"}))
        self.assertEqual(self.fixture.calls[-1][1]["previewToken"],
                         "daemon-token-after-page")

    def test_exact_native_answer_retires_original_preview_on_same_connection(self):
        self.start({"items": [item()], "truncated": True})
        process = subprocess.Popen(self.command("retire", "--run-id", "run-42",
                                                "--lineage-id", "lineage-7"),
                                   text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,
                                   pass_fds=(self.fixture.client.fileno(),))
        preview_envelope = json.loads(process.stdout.readline())
        self.assertEqual(preview_envelope["type"], "retirementPreview")
        answer = {"decision": "retire", "requestId": preview_envelope["requestId"],
                  "preview": preview_envelope["item"]}
        stdout, stderr = process.communicate(json.dumps(answer) + "\n", timeout=5)
        self.assertEqual(process.returncode, 0, stderr)
        outcome = json.loads(stdout)
        self.assertEqual(outcome["type"], "retirementOutcome")
        request = outcome["request"]
        self.assertEqual(request["expectedSeq"], 81)
        self.assertEqual(request["previewToken"], item()["confirmationToken"])
        self.assertEqual(self.fixture.calls[-1][1]["previewToken"], item()["confirmationToken"])
        self.assertEqual(request["worktree"], item()["worktree"])
        self.assertEqual(outcome["outcome"]["requestId"], request["requestId"])
        self.assertEqual([call[0] for call in self.fixture.calls],
                         ["hello", "retention.inventory", "retention.retire"])
        self.assertEqual(len(set(self.fixture.connections)), 1)

    def test_background_host_answer_file_keeps_the_original_connection(self):
        self.start()
        answer_path = self.directory / "fresh-human-answer.json"
        command = [sys.executable, str(HELPER), "--socket-fd",
                   str(self.fixture.client.fileno()), "--repo", str(self.repository),
                   "--answer-file", str(answer_path), "retire", "--run-id", "run-42",
                   "--lineage-id", "lineage-7"]
        process = subprocess.Popen(command, text=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,
                                   pass_fds=(self.fixture.client.fileno(),))
        self.assertFalse(answer_path.exists())
        envelope = json.loads(process.stdout.readline())
        answer_path.write_text(json.dumps({"decision": "retire",
                                           "requestId": envelope["requestId"],
                                           "preview": envelope["item"]}) + "\n",
                               encoding="utf-8")
        stdout, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(json.loads(stdout)["type"], "retirementOutcome")
        self.assertEqual(len(set(self.fixture.connections)), 1)

    def test_wait_deny_missing_and_changed_preview_never_retire(self):
        for name, answer in (
            ("wait", {"decision": "wait"}),
            ("deny", {"decision": "deny"}),
            ("missing", None),
            ("changed", {"decision": "retire", "preview": {**item(), "seq": 82}}),
            ("changed_token", {"decision": "retire", "preview": {**item(), "confirmationToken": "changed"}}),
            ("equal_float", {"decision": "retire", "preview": {**item(), "seq": 81.0}}),
            ("bool_as_integer", {"decision": "retire", "preview": {**item(), "retired": 0}}),
        ):
            with self.subTest(name=name):
                self.start()
                process = subprocess.Popen(self.command("retire", "--run-id", "run-42",
                                                        "--lineage-id", "lineage-7"),
                                           text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE,
                                           pass_fds=(self.fixture.client.fileno(),))
                envelope = json.loads(process.stdout.readline())
                if answer is not None and answer.get("decision") == "retire":
                    answer["requestId"] = envelope["requestId"]
                supplied = "" if answer is None else json.dumps(answer) + "\n"
                process.communicate(supplied, timeout=5)
                self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])
                self.fixture.close()
                self.doCleanups()

    def test_scoped_wait_and_deny_never_retire_target_beyond_first_page(self):
        earlier = [item(run=f"run-{index:03}", lineage=f"lineage-{index:03}")
                   for index in range(128)]
        target = item(run="run-target", lineage="lineage-target", sequence=129)
        inventory = {"items": earlier + [target], "truncated": False}
        for decision in ("wait", "deny"):
            with self.subTest(decision=decision):
                self.start(inventory, filter_inventory=True)
                completed = subprocess.run(
                    self.command("retire", "--run-id", "run-target",
                                 "--lineage-id", "lineage-target"),
                    input=json.dumps({"decision": decision}) + "\n", text=True,
                    capture_output=True, timeout=5,
                    pass_fds=(self.fixture.client.fileno(),), check=True)
                self.assertEqual(json.loads(completed.stdout.splitlines()[-1]),
                                 {"type": "retirementNotSent", "decision": decision})
                self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])
                self.fixture.close()
                self.doCleanups()

    def test_scoped_ambiguous_and_unavailable_results_never_prompt_or_retire(self):
        unavailable = {**item(), "disposition": "unavailable",
                       "reason": "ownership record is unavailable"}
        cases = (
            ("ambiguous", {"items": [item(), item(sequence=82)], "truncated": False}),
            ("unavailable", {"items": [unavailable], "truncated": False}),
        )
        for name, inventory in cases:
            with self.subTest(name=name):
                self.start(inventory, filter_inventory=True)
                completed = subprocess.run(
                    self.command("retire", "--run-id", "run-42",
                                 "--lineage-id", "lineage-7"),
                    input="", text=True, capture_output=True, timeout=5,
                    pass_fds=(self.fixture.client.fileno(),))
                self.assertEqual(completed.returncode, 2)
                self.assertEqual(completed.stdout, "")
                self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])
                self.fixture.close()
                self.doCleanups()

    def test_ineligible_missing_and_ambiguous_selection_never_waits_or_retires(self):
        cases = (
            ("missing", {"items": [], "truncated": False}),
            ("truncated_run_only", {"items": [item()], "truncated": True}),
            ("missing_token", {"items": [{k: v for k, v in item().items() if k != "confirmationToken"}], "truncated": False}),
            ("empty_token", {"items": [{**item(), "confirmationToken": ""}], "truncated": False}),
            ("ineligible", {"items": [{**item(), "disposition": "retained"}], "truncated": False}),
            ("ambiguous", {"items": [item(lineage="a"), item(lineage="b")], "truncated": False}),
        )
        for name, inventory in cases:
            with self.subTest(name=name):
                self.start(inventory)
                completed = subprocess.run(self.command("retire", "--run-id", "run-42"),
                                           input="", text=True, capture_output=True, timeout=5,
                                           pass_fds=(self.fixture.client.fileno(),))
                self.assertEqual(completed.returncode, 2)
                self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])
                self.fixture.close()
                self.doCleanups()

    def test_older_runtime_and_disconnect_are_reported_without_retry(self):
        self.start(retire="older")
        older = subprocess.run(self.command("inventory"), text=True, capture_output=True, timeout=5,
                               pass_fds=(self.fixture.client.fileno(),))
        self.assertEqual(older.returncode, 2)
        self.assertIn("unknown method", older.stderr)
        self.assertEqual([call[0] for call in self.fixture.calls].count("retention.inventory"), 1)
        self.fixture.close()
        self.doCleanups()

        self.start(retire="older_scoped")
        scoped = subprocess.run(self.command("retire", "--run-id", "run-42",
                                             "--lineage-id", "lineage-7"),
                                input="", text=True, capture_output=True, timeout=5,
                                pass_fds=(self.fixture.client.fileno(),))
        self.assertEqual(scoped.returncode, 2)
        self.assertIn("invalid inventory fields", scoped.stderr)
        self.assertEqual([call[0] for call in self.fixture.calls].count("retention.inventory"), 1)
        self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])
        self.fixture.close()
        self.doCleanups()

        self.start(retire="disconnect")
        process = subprocess.Popen(self.command("retire", "--run-id", "run-42",
                                                "--lineage-id", "lineage-7"),
                                   text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,
                                   pass_fds=(self.fixture.client.fileno(),))
        envelope = json.loads(process.stdout.readline())
        _, stderr = process.communicate(json.dumps({"decision": "retire",
                                                    "requestId": envelope["requestId"],
                                                    "preview": envelope["item"]}) + "\n",
                                        timeout=5)
        self.assertEqual(process.returncode, 2)
        self.assertIn("outcome is unknown", stderr)
        self.assertEqual([call[0] for call in self.fixture.calls].count("retention.retire"), 1)

    def test_request_id_prevents_replay_between_identical_previews(self):
        first = SocketFixture(self.directory, self.repository,
                              {"items": [item()], "truncated": False})
        second = SocketFixture(self.directory, self.repository,
                               {"items": [item()], "truncated": False})
        self.addCleanup(first.close)
        self.addCleanup(second.close)

        def launch(fixture):
            command = [sys.executable, str(HELPER), "--socket-fd", str(fixture.client.fileno()),
                       "--repo", str(self.repository), "retire", "--run-id", "run-42",
                       "--lineage-id", "lineage-7"]
            process = subprocess.Popen(command, text=True, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       pass_fds=(fixture.client.fileno(),))
            return process, json.loads(process.stdout.readline())

        first_process, first_preview = launch(first)
        second_process, second_preview = launch(second)
        self.assertEqual(first_preview["item"], second_preview["item"])
        self.assertNotEqual(first_preview["requestId"], second_preview["requestId"])

        first_answer = {"decision": "retire", "requestId": first_preview["requestId"],
                        "preview": first_preview["item"]}
        first_stdout, first_stderr = first_process.communicate(
            json.dumps(first_answer) + "\n", timeout=5)
        self.assertEqual(first_process.returncode, 0, first_stderr)
        self.assertEqual(json.loads(first_stdout)["type"], "retirementOutcome")

        _, second_stderr = second_process.communicate(json.dumps(first_answer) + "\n", timeout=5)
        self.assertEqual(second_process.returncode, 2)
        self.assertIn("does not match this retirement request", second_stderr)
        self.assertEqual([call[0] for call in first.calls].count("retention.retire"), 1)
        self.assertNotIn("retention.retire", [call[0] for call in second.calls])

    def test_existing_answer_file_is_rejected_before_preview(self):
        self.start()
        answer_path = self.directory / "stale-answer.json"
        answer_path.write_text("{}\n", encoding="utf-8")
        command = [sys.executable, str(HELPER), "--socket-fd",
                   str(self.fixture.client.fileno()), "--repo", str(self.repository),
                   "--answer-file", str(answer_path), "retire", "--run-id", "run-42",
                   "--lineage-id", "lineage-7"]
        completed = subprocess.run(command, text=True, capture_output=True, timeout=5,
                                   pass_fds=(self.fixture.client.fileno(),))
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")
        self.assertIn("already exists", completed.stderr)
        self.assertNotIn("retention.retire", [call[0] for call in self.fixture.calls])


if __name__ == "__main__":
    unittest.main()
