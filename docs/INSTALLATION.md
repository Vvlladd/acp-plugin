# Install the free daemon and plugin

The [compiled runtime preview](https://github.com/Vvlladd/acp-core/releases/tag/runtime-v0.1.0-preview.20261012)
is available for Apple Silicon Macs running macOS 26 or later. Local checks ran on macOS 27;
second-machine and broader OS acceptance remain pending. It includes the daemon/CLI and matching
analyzer. **The Mac app and Rust toolchain are not required.** Provider access is your own.

**This preview is not Developer ID signed or notarized.** macOS may block downloaded executables.
The installer preserves quarantine and does not bypass Gatekeeper. If execution is blocked, stop
and use a later signed/notarized release. See [signing status](SIGNING.md).

## Quick setup — runtime and one host

After cloning this repository and reviewing both scripts:

```sh
bash scripts/setup.sh --host claude
# Or, for Codex:
bash scripts/setup.sh --host codex
```

This runs the pinned runtime installer and the chosen host's marketplace/plugin commands. It
prints the PATH line; apply it before launching the host and start a fresh conversation. It does
not alter shell profiles, authenticate providers, execute downloaded binaries or start work.
If host installation fails after runtime installation, keep that runtime and continue with step 2;
do not rerun the runtime installer over an existing version. Keep one active ACP plugin per host.

For a source build with Rust 1.94+ and Xcode 27, use the
[public core build/install guide](https://github.com/Vvlladd/acp-core/blob/main/docs/INSTALLATION.md),
then continue at step 2 below. The Mac app is not needed for either route.

## 1. Download and install the compiled runtime

Clone the MIT plugin repository and inspect the installer, then run it:

```sh
git clone https://github.com/Vvlladd/acp-plugin.git
cd acp-plugin
less scripts/install-runtime.sh
bash scripts/install-runtime.sh
```

The installer downloads the exact release asset over HTTPS, checks a pinned SHA-256 before
extraction, validates all payload checksums and copies the complete package into a new version
folder. It does not execute downloaded binaries, alter host settings, start workers or replace
another installation. It uses built-in macOS tools; no Python or Cargo is needed for installation.
The original core and plugin are MIT; keep their license and bundled third-party notices.
Read the [runtime license](RUNTIME-TERMS.md).

For an already downloaded ZIP, pass `--archive /absolute/path/to/ACP-runtime-0.1.0-preview.20261012-macos-arm64.zip`.
For a different install location, pass `--install-root /absolute/path/outside/your/repositories`.
Existing version folders are refused. The [release manifest](runtime-release.json) records the
asset URL, architecture, tested OS and checksum.

With the default location, activate it in this terminal:

```sh
export PATH="$HOME/Library/Application Support/ACP/runtimes/0.1.0-preview.20261012:$PATH"
command -v acp
acp --version
```

For a custom location, use the quoted PATH command printed by the installer. These changes apply
to the current terminal. To keep this version across terminals, add the reviewed PATH line to your
shell profile yourself after testing. Launch Claude/Codex from a terminal with that PATH, or give
your host the absolute installed `acp` path. A GUI host already running may retain its older PATH.
Keep `acp-swift-checks` beside the **resolved** executable, with all notices and executable bits.

Check an actual repository without starting workers:

```sh
acp doctor --repo /absolute/path/to/your/repository
```

Resolve reported provider/version incompatibilities before delegation. Authenticate selected
providers through their own CLI. Doctor is a readiness check, not a completed provider workflow.

## 2. Install the skill in your preferred host

For **Claude Code**:

```sh
claude plugin marketplace add Vvlladd/acp-plugin
claude plugin install acp@acp-community
claude plugin list
```

Start a fresh conversation and confirm `/acp:acp` or the entry shown by your host. See
[Claude's marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces).

For **Codex**:

```sh
codex plugin marketplace add Vvlladd/acp-plugin
codex plugin add acp@acp-community
codex plugin list
```

The `plugin add` syntax was checked against codex-cli 0.153.0. On desktop versions using the
plugin directory instead, refresh/restart the host, choose **ACP Community**, then install **ACP**.
Start a new conversation and confirm `acp-control-plane` is discovered. See
[OpenAI's marketplace guidance](https://developers.openai.com/plugins/build/plugins).
These CLI commands alter host configuration; they do not install the daemon or change the host model.

Keep one active ACP plugin per host. If an older private ACP plugin is installed, finish its work
and choose which installation to retain before enabling this one. Do not remove credentials or
runtime history as part of plugin migration. See [compatibility](COMPATIBILITY.md).

## 3. First task

Ask: “Use ACP for this repository. Inspect readiness and the saved team first, and help me define
one small task. Keep this conversation as the lead and show me the evidence before integration.”

The skill reuses authorized saved choices or asks for missing exact setup. It starts or attaches
to a managed daemon and retains its own session handle. Provider work consumes your provider
allowance; a setup check alone does not delegate work. Do not add an MCP registration starting
another `serve` owner alongside detached startup. The CLI skill needs no MCP registration.

Personally inspect the frozen evidence and approve or deny the gate through your own terminal
or optional Mac app. Agents must wait; disabled checks remain unperformed. Full chat transfer
between the host and optional app is not promised.

## Update, rollback and uninstall

Finish active work and gates before switching runtime versions. Keep the previous version folder
and history. Change PATH to the desired version and check `command -v acp`; a new plugin does not
upgrade a running owner. Rollback must be verified for the exact version pair in a disposable repo.

To uninstall the runtime, finish the owning daemon's work, remove only its version folder and any
PATH line you added. Keep `.acp` history and resumable worktrees. Uninstall the plugin through its
host separately. `acp down` leaves workers potentially alive; use the skill's safe stop lifecycle.
The [acceptance checklist](FINAL-VERIFICATION.md) records further manual checks.
