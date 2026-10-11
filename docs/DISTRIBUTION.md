# Distribution and license scope

| What you receive | License / terms | Source visibility |
|---|---|---|
| This repository: instructions, packaging, docs and checker | [MIT](../LICENSE) | Available in the plugin repository |
| Separate compiled ACP daemon and analyzer | Separate binary terms and third-party notices, supplied with a release | Engine source remains private |
| Optional Mac app | Separate distribution terms | App source remains private |
| Claude/Codex provider access | Provider's own terms and charges | Supplied by the provider |

The MIT notice is included at both repository and plugin root so a host copying only the plugin
retains it. It grants rights to these package files; it does not license an absent engine binary,
the private source repository, provider software or dependencies of a separate runtime package. See the [download and installation guide](INSTALLATION.md).

The compiled preview runtime is free of ACP software charges for its defined free capabilities.
Model calls still consume the user's provider allowance or paid usage. No free hosted inference
is included. The [runtime terms](RUNTIME-TERMS.md) accompany the release.

A marketplace is a discovery/update channel for the plugin. It does not need the Rust source and
does not itself supply the runtime in this package. Users install a trusted compiled daemon,
then the skill invokes it. Compiled delivery keeps the source checkout private but cannot prevent
inspection, protocol observation or reverse engineering. No client-side secret is guaranteed.

Future paid features are proposals. Read [the roadmap](../ROADMAP.md) for the intended shared
skill/app experience and continued access to existing evidence. This package contains no billing,
license server or cloud processing component.
