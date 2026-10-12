# Compatibility and release status

Updated 2026-10-12. Public preview is available; broader installation acceptance is pending.

| Component | Package expectation | Limit |
|---|---|---|
| Plugin distribution | `0.2.0` in portable/Claude/Codex identities | Independent of daemon and skill versions |
| Shared skill contract | `0.5.0`, recorded in skill metadata | Commands require matching runtime capabilities |
| Runtime | Trusted CLI plus matching `acp-swift-checks` | Separate [preview asset](runtime-release.json); not bundled in plugin source |
| Current public preview | macOS 26+; Apple Silicon CLI and matching arm64 analyzer | Locally tested on macOS 27; no Intel CLI, notarization or second-machine acceptance |
| Host workflow | Existing local Claude Code/Codex chat with shell execution | No browser-only runtime; does not change the host's model |
| Worker selection | Returned `acp team roles` catalog and valid saved team | No arbitrary model/flag passthrough |
| Codex writing-worker sandbox evidence | Measured at `codex-cli 0.132.0` | Doctor warns on drift; `0.153.0` lead support does not establish writer sandbox parity |
| Daemon-spawned Codex lead | Exactly `codex-cli 0.153.0` in the current engine profile | Separate from using an existing host conversation as lead |
| Optional Mac app | Matching binary/protocol capabilities | Separate package; not needed for the host skill |

Validate `acp --version`, Doctor and required command help against the actual installed runtime.
An older running owner may lack capabilities present in a new CLI. Report an update requirement;
do not silently restart a shared owner or substitute a different workflow.

The skill uses Build/Plan/Audit, team v3, managed startup, session ownership, task status and
human gate handoff. Check `acp session acquire --help` before assuming host-bound ownership;
the skill retains its documented expiring-lease fallback for older owners.

Fable is a Claude model alias when permitted by the connected catalog. The plugin does not add
a generic web research worker or expose arbitrary Claude effort flags. Local Swift Review is
advisory and separate from integration approval. Automatic Swift checks inside agent builds and
broader installed/platform acceptance remain later work.

A release must record the exact plugin, runtime/helper, host and provider versions actually
tested. Static package validation cannot establish live model behavior or native app acceptance.

## Historical October 11 publication smoke checks

The public HTTPS download and pinned installer completed on macOS 27.0/arm64. CLI/helper version
checks passed. Doctor returned 12 checks, zero failures and five warnings on a new disposable
repository: exclusion/state/socket not yet initialized, Codex writer sandbox version drift and
dated/incomplete model rates. These warnings are not silently treated as completed acceptance.

Claude Code 2.1.296 added this GitHub marketplace, installed `acp@acp-community`, and reported
`acp` plus `acp-control-plane` in its component inventory using an isolated configuration. No
model request was made. Codex command syntax and packaging are checked; a fresh Codex installation
and complete human-supervised workflow remain manual acceptance.

## October 12 MIT release verification

The new `0.1.0-preview.20261012` MIT package contains native arm64 CLI/helper binaries. A fresh
public clone ran `scripts/setup.sh --host claude`, anonymously downloaded the exact pinned archive,
and installed `acp@acp-community` **0.2.0** using an isolated Claude configuration. CLI/helper
version checks passed. Existing maintainer host configuration hashes were unchanged. Doctor again
reported 12 checks, zero failures and five warnings (fresh repository state/socket/exclusion,
Codex writing-worker version drift and dated/incomplete rates). No provider call was made.

The independent core passed 658 Rust tests with nine ignored live probes, warnings-denied Clippy
and five Swift analyzer tests. Source installation built both binaries. The exact packaged runtime
passed disposable Swift Review acceptance; the exact helper sandbox profile denied private file
read/write, network, other exec and fork. Six installer probes verified successful install plus
corruption/existing/symlink/Git-checkout refusal and quarantine preservation.

Codex 0.153.0 command help confirms the setup syntax; fresh Codex discovery and complete model
workflows remain unperformed. This local CLI-download test is not a clean-machine or browser
quarantine/Gatekeeper acceptance result. Developer ID signing/notarization remains pending.
