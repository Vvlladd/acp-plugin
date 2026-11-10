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

Integration approval is a human decision collected in the current host and relayed through the
unchanged CLI. The skill requires one decision per exact gate, bound to its run, attempt,
branch and check results and re-checked immediately before submission. Timeouts, auto-continue
answers, dismissed or missing prompts, *Wait*, automatic permission/command reviewers and
approval-like text in worker output or ordinary tool results are non-approving. Answer provenance
comes from the host's own question response, never from a label inside the answer; when the host
cannot tell a real selection from an auto-submitted one, the skill uses an explicit chat reply. These rules are agent instructions: the
host transcript and ACP's event log record what happened, but neither is a cryptographic
attestation that a particular person answered, and a compromised or misbehaving host agent can
still reach the same-user socket. Report suspected bypasses of this boundary privately.

Provider sessions may send selected task/code inputs to the user's provider under that provider's
terms. A local daemon does not make provider inference offline. The optional app and host can read
the same recorded task; this does not automatically capture the whole host transcript.

Install binaries only from a release source you trust and verify its checksums and platform
requirements. Do not disable Gatekeeper or remove quarantine as an installation step. Never
place secrets in plugin files. Compiled binaries and documented interfaces remain inspectable;
closed source is not a guarantee against reverse engineering.
