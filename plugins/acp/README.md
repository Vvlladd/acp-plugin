# ACP host plugin

This MIT package teaches a local Claude Code or Codex host to operate a separately installed ACP
daemon. Read [the shared skill](skills/acp-control-plane/SKILL.md) for the operating contract.
The [Claude command](commands/acp.md) is a thin entry point to that same workflow.

The compiled daemon and matching analyzer are external dependencies, not included or licensed
by this package. The original conversation stays the lead. Agents must never approve integration.
No automatic download hook, daemon startup hook or MCP configuration is installed here.

Distribution package version: **0.1.0**. Shared skill contract: **0.5.0**. They are independent
of the daemon version. Provider usage comes from the user's own provider accounts.

Copyright and permissions: [MIT license](LICENSE).

For Claude Code versions supporting one-step marketplace installs:

```text
/plugin install acp --marketplace Vvlladd/acp-plugin
```

This installs the plugin only; the separate compiled runtime is still required.

Install the required daemon using the [public installation guide](https://github.com/Vvlladd/acp-plugin/blob/main/docs/INSTALLATION.md).
The free runtime preview contains no Mac app; its current signing limitations are stated there.
