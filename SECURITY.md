# Security and reporting

## Reporting status

Private vulnerability reporting is enabled. Use
[Report a vulnerability](https://github.com/Vvlladd/acp-plugin/security/advisories/new)
for sensitive findings. Do not post credentials, private source, raw task histories or exploitable
details in a public issue. Public issues are suitable for redacted ordinary packaging bugs.

Include affected versions, prerequisites, a minimal redacted reproduction and the observed
impact. A package validation pass is not a security audit or a promise of complete isolation.

## Boundaries

The plugin is agent instructions and metadata. It asks the host to invoke the separately installed
`acp` executable with the user's authorization. Inspect the skill before enabling it. No
auto-download hook or bundled remote MCP service is present.

The daemon controls its own provider launches, role scope, worktrees and recorded evidence.
The host agent's independent tools remain governed by the host. MCP refuses integration approval
from an agent; a host with shell access is governed by the skill's prohibition on approval.
The socket is a local same-user boundary, not proof that the caller is a physical human.

Provider sessions may send selected task/code inputs to the user's provider under that provider's
terms. A local daemon does not make provider inference offline. The optional app and host can read
the same recorded task; this does not automatically capture the whole host transcript.

Install binaries only from a release source you trust and verify its checksums and platform
requirements. Do not disable Gatekeeper or remove quarantine as an installation step. Never
place secrets in plugin files. Compiled binaries and documented interfaces remain inspectable;
closed source is not a guarantee against reverse engineering.
