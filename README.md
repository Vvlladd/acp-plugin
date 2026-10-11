# ACP — keep your conversation, coordinate the work

Use ACP from an existing **Claude Code or Codex conversation** to coordinate selected workers,
inspect their evidence and return the integration decision to you. The optional Mac app shows
the same local task and history.

**This repository contains the free MIT plugin, not the Rust daemon source.** The plugin requires
a separately installed `acp` executable. The engine remains private and is intended for a free
compiled distribution under separate terms. Provider access and usage come from your own accounts.

**Release status:** the MIT plugin is available for preview in this public repository.
The compiled runtime is awaiting the maintainer’s final verification; there is no public runtime
download yet. Existing pilot users can validate it with a
compatible trusted runtime. Installing the plugin alone does not install ACP or start workers.

[Install](docs/INSTALLATION.md) · [Architecture](#architecture) ·
[Compatibility](docs/COMPATIBILITY.md) · [Roadmap](ROADMAP.md) ·
[Contribute](CONTRIBUTING.md) · [License scope](docs/DISTRIBUTION.md) ·
[Final verification](docs/FINAL-VERIFICATION.md)

## What you can do

| Workflow | What happens | What the human decides |
|---|---|---|
| Build | A builder works in an isolated Git worktree; selected tests/reviews follow | Task, team and approval of the frozen change |
| Audit | Selected workers inspect an explicitly chosen snapshot | Comparison base and input; there is no integration |
| Plan | Discuss a plan in your current conversation | Direction and next action; no writing workers |
| Inspect | Read task status, evidence and history | Whether to continue, request changes or stop |

The current conversation remains the lead with its existing model. The connected daemon's
catalog determines supported worker choices. Disabling a check leaves it explicitly unperformed;
it does not count as a pass. ACP uses a local daemon for worktree isolation, coordination,
recorded results, recovery and human gates. Launching a model alone does not provide those controls.

Example request after installation and setup:

> Use ACP for this repository. Inspect readiness and the saved team first, then help me define
> a small task. Keep this conversation as the lead and show me the evidence before integration.

No new paid feature or subscription is required by this plugin. Proposed paid understanding
features are described separately in the [roadmap](ROADMAP.md).

## Architecture

### HLD — three pieces, one local task

The marketplace supplies instructions; a separate binary package supplies the runtime. The Mac
app is another client of that runtime. A task link does not transfer the host's complete chat.

```mermaid
flowchart TB
    subgraph distribution["Installation — separate packages"]
        plugin["MIT plugin<br/>skill · command · documentation"]
        binary["Compiled ACP runtime<br/>CLI + matching analyzer<br/>separate distribution terms"]
    end
    subgraph local["Developer machine"]
        host["Existing Claude Code / Codex chat<br/>keeps its current lead and model"]
        cli["Installed acp CLI<br/>readiness · setup · task commands"]
        daemon["ACP daemon<br/>one owner for the repository"]
        app["Optional Mac app<br/>same task · evidence · history"]
        workers["Selected worker processes<br/>Builder · Tests · Review · Security"]
        tree[("Isolated worktree / captured audit input")]
        evidence[("Local records<br/>attempts · outcomes · frozen evidence")]
        human["Developer<br/>reviews the exact change"]
    end
    plugin -->|host loads skill| host
    binary -->|user installs| cli
    host -->|skill guides commands| cli
    cli -->|start or attach; local socket| daemon
    app -->|local socket| daemon
    daemon -->|checked launch and role scope| workers
    workers --> tree
    daemon --> evidence
    evidence --> human
    human -->|approve or deny via human CLI / app| daemon
    classDef package fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef control fill:#ede9fe,stroke:#7c3aed,color:#2e1065
    classDef record fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef decision fill:#fef3c7,stroke:#b45309,color:#451a03
    class plugin,binary package
    class host,cli,daemon,app,workers control
    class tree,evidence record
    class human decision
```

### LLD — one build attempt, from request to decision

The diagram shows a build with enabled checks. The exact worker set comes from the saved team.
The skill uses CLI commands; optional MCP wiring is a separate entry choice, not an installer hook.

```mermaid
sequenceDiagram
    autonumber
    actor Human as Developer
    participant Host as Existing host + skill
    participant CLI as acp CLI
    participant ACP as Local daemon
    participant Workers as Selected workers
    participant Git as Isolated worktree
    Human->>Host: Define task, reuse saved team or confirm exact changes
    Host->>CLI: doctor, up --managed, acquire own session
    CLI->>ACP: Start or attach, inspect team and catalog
    Note over Host,ACP: Attaching does not change another owner's lifetime
    Host->>CLI: Delegate bounded task
    CLI->>ACP: Validate task and recorded execution choices
    ACP->>Git: Create isolated builder worktree
    ACP->>Workers: Launch role-scoped builder
    Workers->>Git: Produce changes, workers do not commit
    ACP->>Workers: Run selected checks on this attempt
    alt Check fails and repair is permitted
        ACP->>Workers: Repair within policy, then rerun selected checks
    else Selected workflow reaches review
        ACP->>ACP: Freeze evidence for the current attempt
        ACP-->>Host: Pending human gate and recorded results
        Host-->>Human: Show evidence and gate, wait
        alt Human approves through own CLI or Mac app
            Human->>ACP: Approve gate
            ACP->>Git: Verify approved bytes still match, commit
            ACP-->>Human: Recorded outcome and commit
        else Human denies
            Human->>ACP: Deny with feedback
            ACP-->>Host: Repair or escalation under recorded policy
        end
    end
    Note over Human,Git: Landing the resulting branch on the main branch is a separate human action
```

An agent must never approve integration. MCP refuses agent approval; on the skill's shell path,
this is an instruction boundary. The local socket identifies the OS user, not a physical human.
See [security boundaries](SECURITY.md) before assuming stronger isolation between same-user processes.

## Package layout

```text
acp-plugin/
├── .claude-plugin/marketplace.json   # Claude catalog
├── .agents/plugins/marketplace.json # Codex catalog
├── plugins/acp/
│   ├── plugin.json                  # Portable identity
│   ├── .claude-plugin/plugin.json   # Claude metadata
│   ├── .codex-plugin/plugin.json    # Codex compatibility metadata
│   ├── skills/acp-control-plane/SKILL.md
│   ├── commands/acp.md
│   └── LICENSE                     # Retained when a host copies the plugin
├── docs/                            # Install, compatibility and release guidance
├── scripts/check_package.py         # Local package checks; no downloads
├── CONTRIBUTING.md
└── LICENSE                          # MIT for this repository's files
```

The plugin contains no daemon binary, daemon source, provider credentials, startup hooks or
automatic MCP configuration. The [distribution guide](docs/DISTRIBUTION.md) explains the license
boundary and why compiled delivery does not prevent reverse engineering.

## Development

With Python 3.10 or later, run `python3 scripts/check_package.py` from this repository. With
Claude Code installed, run `claude plugin validate .` and
`claude plugin validate ./plugins/acp`. Read [CONTRIBUTING.md](CONTRIBUTING.md) for scope and review.
These checks do not start a daemon, run a model or prove installed runtime compatibility.
