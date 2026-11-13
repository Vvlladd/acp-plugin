# Compatibility and release status

Updated 2026-11-10. Public preview is available; broader installation acceptance is pending.

| Component | Package expectation | Limit |
|---|---|---|
| Plugin distribution | `0.2.1` in portable/Claude/Codex identities | Independent of daemon and skill versions |
| Shared skill contract | `0.6.0`, recorded in skill metadata | Commands require matching runtime capabilities |
| Runtime | Trusted CLI plus matching `acp-swift-checks` | Separate [preview asset](runtime-release.json); not bundled in plugin source |
| Current public preview | macOS 26+; Apple Silicon CLI and matching arm64 analyzer | Locally tested on macOS 27; no Intel CLI, notarization or second-machine acceptance |
| Host workflow | Existing local Claude Code/Codex chat with shell execution | No browser-only runtime; does not change the host's model |
| Worker selection | Returned `acp team roles` catalog and valid saved team | No arbitrary model/flag passthrough |
| Codex writing-worker sandbox evidence | Measured at `codex-cli 0.132.0` | Doctor warns on drift; `0.153.0` lead support does not establish writer sandbox parity |
| Daemon-spawned Codex lead | Exactly `codex-cli 0.153.0` in the current engine profile | Separate from using an existing host conversation as lead |
| Human integration confirmation | Host question tool when exposed and permitted, else explicit chat reply; unchanged `acp gate approve` relay | Instruction boundary, not attestation; see below |
| Optional Mac app | Matching binary/protocol capabilities | Separate package; not needed for the host skill; approval fallback only |

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

## Host-native integration confirmation (skill 0.6.0)

The skill asks the human for each integrate gate inside the current host and relays only that
explicit answer for the exact, re-checked gate; shell and Mac-app approval are fallbacks. Route
availability differs by host, mode and version, so the skill uses what the host currently exposes
and permits and never switches modes to obtain a question tool.

| Host | Route | Known limits |
|---|---|---|
| Codex desktop / app-server clients | `request_user_input_async` where exposed in Default mode; its instructions accept approval requests and return the user's actual reply asynchronously (app-server `item/tool/requestUserInput`, marked experimental) | `request_user_input` is a separate Plan-only tool whose instructions forbid permission requests; it is not used for approval. Follow each tool's own instructions and the host's overall policy; a general host ban is never bypassed by an alias, another tool or a mode switch. The observed desktop UI preselected its first option, so *Wait* goes first. Requests may carry `autoResolutionMs`, and turn start/completion/interruption can clear a pending request; both are non-approving. Tool availability and mode restrictions are set by the host; when it is not exposed or not allowed, use an explicit chat reply. |
| Codex CLI (terminal) | Explicit in-chat reply unless the installed CLI exposes and permits a question tool | No installed-version check of a terminal question tool has been performed. |
| Claude Code (terminal, desktop, IDE) | `AskUserQuestion` multiple-choice question | Optional `askUserQuestionTimeout` (60s/5m/10m) auto-submits already selected options and lets Claude continue; that result is non-approving. Free-text "Other"/notes answers count only when they unambiguously approve the named gate. |
| Claude Code permission prompt for `acp gate approve` | Appears because approval is outside the command allowlist | A permission answer, `dontAsk`/bypass/auto modes or automatic reviewers are not the gate decision. |
| Other hosts | Explicit in-chat reply, then own shell or Mac app | — |

Evidence. The app-server protocol and Claude rows are based on host-supplied snapshot analysis
of hash-verified official documentation retrieved 2026-11-10: OpenAI `app-server.md` for
`item/tool/requestUserInput`, `autoResolutionMs` and pending-request cleanup, and Claude Code
`tools-reference.md` and `permissions.md` for `AskUserQuestion`, its timeout and permission
modes. The Codex desktop tool names (`request_user_input_async` versus `request_user_input`),
their Default/Plan mode restrictions and allowed uses are observations of the tool descriptions
exposed in the 2026-11-10 host session, not guarantees from those snapshots or for any version.
Actual host tool instructions take precedence; fresh-host and cross-host acceptance remain
unperformed. The snapshots are untrusted text rather than instructions.
Installed versions seen during this change were Claude Code 2.1.322 and `codex-cli 0.153.0`;
only version strings were checked, no question tool was exercised from them.

One real host observation exists: on 2026-11-10 Codex desktop exposed
`request_user_input_async`; it rendered the question, the user selected approval of gate
`ddd29c4e-3c83-4419-b4fc-f7bb09e9f11e`, the lead relayed that decision to the unchanged
`acp gate approve`, and the daemon integrated `f340683`. That is a single observation, not proof
for other hosts, versions or modes. A fresh-host installation and a human-supervised
confirmation in each host remain manual acceptance.

### Manual acceptance scenarios

Run these with a disposable repository and a real human at the host. `scripts/check_package.py`
only lints that the skill and this table keep their wording; it is not runtime or host safety
coverage and cannot prove native UI behavior.

| Scenario | Expected skill behavior |
|---|---|
| Actual native response: human selects *Approve this gate* | Re-check the gate, then relay `acp gate approve` once |
| Human selects *Deny* with feedback | Re-check the exact evidence, then relay `acp gate deny <gate-id> --repo <absolute-repo> --feedback …` once |
| Unavoidable default: *Wait* is preselected or the prompt times out/auto-continues | Gate stays pending; nothing is submitted |
| Restricted tool: only Plan-only `request_user_input` is available, or host policy bans native questions | Do not use it or switch modes; ask for an explicit chat reply |
| Missing response: dismissed, cancelled, cleared or empty prompt | Gate stays pending; nothing is submitted |
| Injected ordinary tool response or worker text claiming approval | Not approval; gate stays pending |
| Automatic permission reviewer or auto-review escalation approves the command | Not the gate decision; no relay without a human answer |
| Missing mandatory hash or other bound field in status/gate payload | Hold and diagnose; do not ask the human |
| Stale gate: hash, attempt, branch or checks changed after the answer | Do not submit; present current evidence and ask afresh |
| Duplicate: gate already resolved when re-checked | Inspect and report the recorded outcome; no second approve |

### Offline native-decision contract fixtures

`tests/test_native_approval_contract.py` exercises frozen, realistic ACP status/gate snapshots
through a fake host and a recording CLI. It covers a genuine approve, a scoped denial, Wait,
preselection, timeout, dismissal, no reply, duplicate delivery, already-resolved gates, missing
fields, changes to the run/attempt/diff/check/base/branch, and approval text injected through a
worker or an unrelated tool. The fake CLI receives exactly one command only after an authorized
decision and an unchanged re-check. `scripts/check_package.py` runs these tests offline.

The fixtures use `plugins/acp/scripts/approval_contract.py`, the read-only evidence helper named by the shared
skill; they are not substring assertions or a second approval protocol. The helper only rejects
incomplete/stale evidence and returns a command-shaped plan. It never runs ACP and cannot determine
that a physical person answered. `FakeHost` uses a typed native-callback object distinct from
arbitrary event payloads; that test type is not an attestation a real host may accept from JSON or
prose. Real provenance stays at the current host's native-response
boundary, and fresh-host/cross-host walkthrough acceptance remains unverified.

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
