# ACP workflow map

The workflow map is an optional local browser client for an ACP daemon. It shows task activity,
selected worker conversations and gate evidence. The example mode is simulated and does not send
decisions. The map is MIT licensed under this repository's [license](../LICENSE).

## Runtime requirement

Use the November 23 runtime preview for worker transcripts and per-run lead decisions.
Install the matching CLI and analyzer with the public installer or build the tagged core
source on a supported Mac. [Installation guide](../docs/INSTALLATION.md) · [Tagged source](https://github.com/Vvlladd/acp-core/tree/runtime-v0.1.0-preview.20261123)

Use the PATH line printed by the installer. Start the repository daemon with that runtime.
An already running daemon continues using its original executable until restarted.

## Start

Use a local Git repository, Node.js 25.2.1 (the version used for the recorded source tests), and a
compatible ACP runtime. Start or attach to the repository's existing ACP daemon using its normal
workflow. From the plugin checkout, run:

```sh
node workflow-map/serve.mjs --repo /absolute/path/to/repository
```

Open the exact URL printed by the server in a local browser. The URL contains a pairing secret;
keep it private. `--state-dir /absolute/path` selects a non-default ACP state directory and
`--port 0` chooses an available loopback port. Stop the viewer with Ctrl-C; it does not stop the
daemon. The server checks the daemon's repository and state directory before presenting its data.

The server binds to `127.0.0.1`. Pairing grants access to the selected repository's local workflow
and decision interface, so do not share the pairing URL or expose the server through a proxy.
Opening a worker conversation may display sensitive user or worker text in the paired browser.
Human approval is the default. On a compatible runtime, lead authority requires explicit per-run
human confirmation; escalations remain human decisions. A native access request stays paused when
the runtime cannot verify a grant for that worker.

## Verify

```sh
node --test workflow-map/test/*.test.mjs
python3 scripts/check_package.py
```

The tests use disposable repositories and local fake daemons; they do not call model providers.
Local socket access is required. They do not establish a fresh-host, production installation or
full native acceptance.


## Observed provider runs

On November 23, 2026, two disposable status-page repositories exercised the paired browser with live providers. In each run, the map displayed the lead's assignment and builder's reply. The person authorized the run once, the designated lead approved the frozen patch, and ACP wrote one commit to the task worktree.

| Lead | Builder | Result |
| --- | --- | --- |
| Codex GPT-6.2 Sol | Codex GPT-6.1 Terra | The lead approved the delegated task after a follow-up. |
| Claude Opus 5.5 | Claude Sonnet 5.5 | The lead approved the task in the same conversation after the builder reported its check. |

For Claude attempts, the viewer reads the native model ID from the initialization header so it
can display the version used in that run. When that ID is unavailable, it labels the configured
alias. A completed decision shows its recorded outcome, commit and run models. The decision
record holds the original gate summary.

Both builders ran the fixture's Python check. Re-running it from each resulting Git commit passed. Both tests selected only a lead and a builder. A separate verifier or reviewer can be selected when needed.
