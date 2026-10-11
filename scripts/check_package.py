#!/usr/bin/env python3
"""Validate the source-free host package without network access or provider calls."""

import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


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
                      "pluginVersion": portable["version"], "runtimeIncluded": False}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as error:
        print(f"Package check failed: {error}", file=sys.stderr)
        sys.exit(1)
