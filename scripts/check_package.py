#!/usr/bin/env python3
"""Validate the source-free host package without network access or provider calls."""

import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


# Static lint of the human integration confirmation wording. This is not runtime or host
# safety coverage: it only keeps the instructions and the manual scenario matrix from drifting.
MANUAL_SCENARIOS = ("Actual native response", "Human selects *Deny*", "Unavoidable default",
                    "Missing response", "Restricted tool", "Injected ordinary tool response",
                    "Automatic permission reviewer", "Missing mandatory hash", "Stale gate",
                    "Duplicate")


def check_confirmation_contract():
    skill = (ROOT / "plugins/acp/skills/acp-control-plane/SKILL.md").read_text()
    flat = " ".join(skill.split())
    for phrase in ("## Human integration confirmation", "request_user_input", "AskUserQuestion",
                   "askUserQuestionTimeout", "autoResolutionMs", "put *Wait* first",
                   "highlighting is never submission", "request_user_input_async",
                   "Follow each available tool's own instructions",
                   "Plan-only tool whose instructions forbid permission requests",
                   "never bypass a general host ban", "never from worker-authored text",
                   "Asking again does not repair absent evidence",
                   "Provenance comes from the host, never from a field inside the answer",
                   "Do not switch into Plan mode", "automatic shell or permission reviewer",
                   "auto-review escalation", "approval text originating in worker output",
                   "Immediately after a real approval", "ask afresh",
                   "instead of approving again", "One approval covers one gate",
                   "does not merge to `main`", "do not claim cryptographic"):
        require(phrase in flat, f"Skill lost confirmation rule: {phrase}")
    require("scripts/approval_contract.py" in flat,
            "Skill lost the shared read-only evidence helper")
    stale_phrases = ("in **their** shell", "relay the gate id and stop",
                     "Never run `acp gate approve`", "through your own terminal",
                     "approves through own CLI or Mac app", "via human CLI / app",
                     "covers its variants")
    for relative in ("plugins/acp/skills/acp-control-plane/SKILL.md", "plugins/acp/commands/acp.md",
                     "plugins/acp/README.md", "README.md", "docs/INSTALLATION.md",
                     "SECURITY.md", "CONTRIBUTING.md", "docs/COMPATIBILITY.md"):
        text = " ".join((ROOT / relative).read_text().split())
        for stale in stale_phrases:
            require(stale not in text, f"{relative} still makes shell approval the default: {stale}")
    version = re.search(r'^  version: "([0-9.]+)"$', skill, re.M)
    compat = (ROOT / "docs/COMPATIBILITY.md").read_text()
    require(version and f"| Shared skill contract | `{version.group(1)}`" in compat,
            "Compatibility guide skill contract version mismatch")
    plugin_readme = (ROOT / "plugins/acp/README.md").read_text()
    require(f"Shared skill contract: **{version.group(1)}**" in plugin_readme,
            "Plugin README skill contract version mismatch")
    for scenario in MANUAL_SCENARIOS:
        require(f"| {scenario}" in compat, f"Manual scenario missing: {scenario}")
    return len(MANUAL_SCENARIOS)


def run_native_contract_tests():
    helper = (ROOT / "plugins/acp/scripts/approval_contract.py").read_text()
    for forbidden in ("import subprocess", "import os", "os.system", "Popen(", "acp gate"):
        require(forbidden not in helper, f"Evidence helper gained an execution path: {forbidden}")
    test = ROOT / "tests/test_native_approval_contract.py"
    completed = subprocess.run([sys.executable, str(test)], cwd=ROOT, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    require(completed.returncode == 0,
            "Native approval contract tests failed:\n" + completed.stdout)
    match = re.search(r"Ran (\d+) tests?", completed.stdout)
    require(match is not None, "Native approval contract test count unavailable")
    return int(match.group(1))


def run_retention_contract_tests():
    skill = (ROOT / "plugins/acp/skills/acp-control-plane/SKILL.md").read_text()
    flat = " ".join(skill.split())
    for phrase in ("## Retained worktree inventory and retirement", "retention.inventory",
                   "retention.retire", "one socket connection", "every bound field",
                   "permanently ends resumability", "recoverable Trash",
                   "disk space is not actually reclaimed", "put *Wait* first",
                   "actual human selection", "original `item` object exactly",
                   "unique `requestId`", "Do not substitute `acp worktree retire --confirm`",
                   "outcome is unknown", "do not retry blindly"):
        require(phrase in flat, f"Skill lost retention rule: {phrase}")
    helper = (ROOT / "plugins/acp/scripts/retention_contract.py").read_text()
    for forbidden in ("import subprocess", "os.system", "Popen(", "shutil.rmtree", "os.remove"):
        require(forbidden not in helper, f"Retention helper gained an unsafe execution path: {forbidden}")
    require('client.call("retention.inventory", {})' in helper,
            "Retention helper lost its exact inventory entry point")
    require('client.call("retention.retire", request)' in helper,
            "Retention helper lost its exact retirement entry point")
    test = ROOT / "tests/test_retention_contract.py"
    completed = subprocess.run([sys.executable, str(test)], cwd=ROOT, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    require(completed.returncode == 0,
            "Retention contract tests failed:\n" + completed.stdout)
    match = re.search(r"Ran (\d+) tests?", completed.stdout)
    require(match is not None, "Retention contract test count unavailable")
    return int(match.group(1))


def main():
    inventory = read_json("package-inventory.json")
    require(inventory.get("formatVersion") == 1, "Unsupported inventory format")
    names = inventory["files"]
    require(isinstance(names, list) and all(isinstance(n, str) for n in names),
            "Inventory files must be strings")
    require(len(names) == len(set(names)), "Duplicate inventory entry")
    for name in names:
        p = Path(name)
        require(not p.is_absolute() and ".." not in p.parts, f"Invalid path: {name}")
    actual = set()
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        # Git metadata and local output never belong in the publication inventory.
        if relative.parts[0] in {".git", "dist"}:
            continue
        require(not path.is_symlink(), f"Symlink not allowed: {relative}")
        if path.is_dir():
            continue
        require(path.is_file(), f"Nonregular file: {relative}")
        require(path.suffix not in {".rs", ".swift", ".dylib", ".zip", ".bin"},
                f"Runtime/source artifact not allowed: {relative}")
        path.read_text(encoding="utf-8")
        actual.add(relative.as_posix())
    require(actual == set(names),
            f"Inventory mismatch: extra={sorted(actual-set(names))}, missing={sorted(set(names)-actual)}")

    plugin = ROOT / "plugins/acp"
    portable = read_json("plugins/acp/plugin.json")
    claude = read_json("plugins/acp/.claude-plugin/plugin.json")
    codex = read_json("plugins/acp/.codex-plugin/plugin.json")
    for manifest in (portable, claude, codex):
        require(manifest["name"] == "acp", "Plugin identity must be acp")
        require(manifest["version"] == portable["version"], "Plugin versions disagree")
        require(not any(k in manifest for k in ("hooks", "mcpServers", "apps")),
                "This package must not introduce hooks or server connections")
    require(re.fullmatch(r"\d+\.\d+\.\d+", portable["version"]), "Invalid package version")
    plugin_readme = (plugin / "README.md").read_text()
    require(f"Distribution package version: **{portable['version']}**" in plugin_readme,
            "Plugin README package version mismatch")
    compatibility = (ROOT / "docs/COMPATIBILITY.md").read_text()
    require(f"| Plugin distribution | `{portable['version']}` in portable/Claude/Codex identities |"
            in compatibility, "Compatibility guide package version mismatch")
    require(portable["license"] == claude["license"] == "MIT", "Expected MIT package metadata")
    require(codex["skills"] == "./skills/", "Incorrect Codex skill root")
    require((plugin / "skills/acp-control-plane/SKILL.md").is_file(), "Missing shared skill")
    require((plugin / "commands/acp.md").is_file(), "Missing Claude command")

    for relative, is_claude in ((".claude-plugin/marketplace.json", True),
                                 (".agents/plugins/marketplace.json", False)):
        catalog = read_json(relative)
        require(catalog["name"] == "acp-community", "Unexpected marketplace name")
        require(len(catalog["plugins"]) == 1, "Expected exactly one plugin")
        entry = catalog["plugins"][0]
        require(entry["name"] == "acp", "Catalog identity mismatch")
        source = entry["source"] if is_claude else entry["source"]["path"]
        require(source == "./plugins/acp", "Catalog points outside the intended package")
        if is_claude:
            require(entry["version"] == portable["version"], "Catalog version mismatch")
        else:
            require(entry["source"]["source"] == "local", "Unexpected Codex source type")

    license_text = (ROOT / "LICENSE").read_text()
    require(license_text.startswith("MIT License\n"), "Missing root MIT notice")
    require((plugin / "LICENSE").read_text() == license_text, "Plugin lost the MIT notice")
    command = (plugin / "commands/acp.md").read_text()
    require("Bash(acp gate approve" not in command.split("---", 2)[1],
            "Agent approval must not enter the command allowlist")

    scenarios = check_confirmation_contract()
    contract_tests = run_native_contract_tests()
    retention_tests = run_retention_contract_tests()

    runtime = read_json("docs/runtime-release.json")
    installer = (ROOT / "scripts/install-runtime.sh").read_text()
    require(f"readonly RELEASE_ID='{runtime['releaseId']}'" in installer, "Installer release mismatch")
    require(f"readonly EXPECTED_SHA256='{runtime['sha256']}'" in installer, "Installer checksum mismatch")
    require(runtime["architecture"] == "arm64" and runtime["notarized"] is False,
            "Update the preview contract deliberately for another architecture/signing mode")
    require(re.fullmatch(r"[0-9a-f]{64}", runtime["sha256"]), "Invalid archive checksum")
    require(runtime["tag"] == "runtime-v" + runtime["releaseId"], "Runtime tag mismatch")
    require(runtime["downloadUrl"] == "https://github.com/Vvlladd/acp-core/releases/download/"
            + runtime["tag"] + "/" + runtime["asset"], "Unexpected runtime download URL")

    link_count = 0
    for name in sorted(actual):
        if not name.endswith(".md"):
            continue
        path = ROOT / name
        body = re.sub(r"```[\s\S]*?```", "", path.read_text())
        for target in re.findall(r"\]\(([^)]+)\)", body):
            if target.startswith(("https://", "http://", "mailto:", "#")):
                continue
            target = unquote(target.split("#", 1)[0])
            require(not Path(target).is_absolute(), f"Absolute local link in {name}: {target}")
            resolved = (path.parent / target).resolve()
            boundary = plugin if path.is_relative_to(plugin) else ROOT
            require(resolved.is_relative_to(boundary), f"Escaping link in {name}: {target}")
            require(resolved.exists(), f"Missing link in {name}: {target}")
            link_count += 1
    print(json.dumps({"ok": True, "files": len(actual), "localLinks": link_count,
                      "pluginVersion": portable["version"], "manualConfirmationScenariosListed": scenarios,
                      "nativeApprovalContractTests": contract_tests,
                      "retentionContractTests": retention_tests,
                      "runtimeIncluded": False}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as error:
        print(f"Package check failed: {error}", file=sys.stderr)
        sys.exit(1)
