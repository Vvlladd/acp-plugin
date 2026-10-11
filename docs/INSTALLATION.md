# Install the plugin and its runtime dependency

## Current availability

The plugin package is publicly available for preview. This repository does **not** yet offer a public
runtime download. Until a release exists, use only a compatible runtime supplied through an agreed
pilot. There is intentionally no placeholder download URL or installer that fetches an unknown binary.

You need a local Git repository, a supported macOS runtime, a shell-capable Claude Code or Codex
host, and authenticated provider CLIs for the workers you select. A browser-only chat cannot run
this local workflow. See [compatibility](COMPATIBILITY.md).

## 1. Install a trusted compiled runtime

Use the matching `acp` and `acp-swift-checks` from the same reviewed package, with its binary terms,
notices, checksums and platform instructions. Keep the analyzer beside the **resolved executable**,
including when `acp` is reached through a symlink. Keep executable permissions and the supplied
SwiftSyntax notice. Put the trusted install directory on PATH; do not install it inside a customer
checkout. No Rust build or private source access is required.

Follow the release's signing and quarantine instructions. This guide does not authorize bypassing
OS protection. A public release must supply a complete, tested installation path first.

Verify without starting workers, substituting your actual repository path:

```sh
command -v acp
acp --version
acp doctor --repo /absolute/path/to/your/repository
```

Resolve reported incompatibilities before delegation. Doctor is a readiness probe, not a complete
provider acceptance test. Provider authentication stays in the provider's own CLI.

## 2. Load the plugin in your host

Clone the public repository, then validate the package:

```sh
git clone https://github.com/Vvlladd/acp-plugin.git
cd acp-plugin
python3 scripts/check_package.py
```

For **Claude Code**, add this repository’s catalog and install the plugin:

```sh
claude plugin marketplace add Vvlladd/acp-plugin
claude plugin install acp@acp-community
claude plugin list
```

Start a fresh conversation and confirm ACP appears. The packaged command is namespaced as
`/acp:acp`; use the entry shown by your host. These commands change host configuration but do not
install the runtime. See [Claude's marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces).

For **Codex**, add the local marketplace using:

```sh
codex plugin marketplace add /absolute/path/to/acp-plugin
```

Refresh/restart the desktop host as needed, open its plugin directory, choose **ACP Community**
and install **ACP**. Start a fresh conversation and confirm the `acp-control-plane` skill is
discovered. The included Codex catalog and compatibility manifest describe this package; host
versions can differ. See [OpenAI's packaging guide](https://developers.openai.com/plugins/build/plugins)
for the current local marketplace flow. Do not edit provider or host credentials into the repository.

Use one installation of the ACP workflow in a host. If an older ACP plugin is already installed,
finish its active work and review migration before enabling a second copy. The plugin version
does not upgrade an already-running daemon.

## 3. Start with inspection and explicit setup

Ask the host to use ACP, inspect readiness and the saved team, and help define a task. The skill
will use supported installed commands, reuse authorized choices and request missing setup.
Your current conversation stays the lead. A setup request alone does not delegate work.

The skill starts/attaches using `acp up --managed` for a new managed owner unless you choose a
persistent service. It retains its own session handle. A task uses the saved team; changing that
team needs your exact choices. Do not register an MCP configuration that starts another `serve`
owner while also using detached startup. The CLI skill needs no MCP registration.

When an integration gate appears, inspect the evidence and approve or deny through your own
terminal or the Mac app. The agent must wait. Disabled checks remain unperformed.

## Update or stop

A new plugin does not replace the CLI/helper or restart a daemon. Finish active work, preserve
history, retain the previous version for rollback, and follow the binary release's update guide.
Do not replace another session's running owner as a setup shortcut.

Ask explicitly to stop ACP when desired. Safe stop waits for work and gates; cancel-and-stop is
a separate choice. `acp down` stops supervision while workers may survive, so it is not equivalent
to cancelling everything. The shared skill documents the full lifecycle.
