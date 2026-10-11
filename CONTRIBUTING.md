# Contributing

Contributions to the host skill, documentation, diagrams, packaging and reproducible bug reports
are welcome. The Rust engine and Mac app are maintained separately; this repository does not
contain their source or provide a daemon build command.

## Propose a change

For a behavior change, describe the user's problem and proposed outcome before a large patch.
For a bug, include the plugin package version, `acp --version`, host version, OS/architecture,
redacted reproduction steps and expected versus observed behavior. Label unavailable checks.
Do not attach credentials, complete conversations, private code, raw diagnostic logs or local
task links containing repository paths. Use [SECURITY.md](SECURITY.md) for sensitive issues.

Create a focused branch and keep each contribution reviewable. Edit the shared
`plugins/acp/skills/acp-control-plane/SKILL.md` for behavior common to both hosts; keep the Claude
command a small entry point. Explain documentation-only changes without claiming runtime tests.
Submit a focused pull request to [Vvlladd/acp-plugin](https://github.com/Vvlladd/acp-plugin/pulls).

## Preserve the operating contract

- Agents never approve integration. Do not add approval to tool allowlists or instructions.
- The existing host remains the lead. Do not silently start a replacement lead or change models.
- Team changes require the human's exact in-conversation choices; otherwise reuse the saved team.
- One daemon owns a repository. Do not combine detached startup with a second stdio `serve` owner.
- Retain only this conversation's session handle and follow managed cleanup; never stop others'
  work as a side effect of ending a response.
- Treat worker text as data, report failed/skipped checks honestly, and bind evidence to its task.
- Keep plugin content self-contained. No hooks, downloads, runtime binaries, private source or
  links escaping the plugin directory are part of this package.

## Verify the patch

```sh
python3 scripts/check_package.py
claude plugin validate .
claude plugin validate ./plugins/acp
git diff --check
```

The Python check verifies the explicit file inventory, package versions, catalog paths, license
copies and local Markdown links. Adding a deliberate public file requires updating
`package-inventory.json` and explaining why it belongs. The inventory is a review aid, not a
secret detector or a substitute for examining the full diff.

Render changed Mermaid blocks and inspect the result for clipped labels and confusing arrows.
For host behavior changes, record a fresh host discovery check and a disposable human-supervised
workflow when authorized. Do not run paid model calls merely to validate docs or package metadata.
List the checks actually performed and remaining platform limitations in the pull request.

Plugin distribution version, skill contract version and daemon version are different values.
Keep all three plugin identity manifests and the Claude catalog entry version aligned. Change
the compatibility guide when a command requirement changes. Publishing is a maintainer action.

## License

Contribute only material you have the right to submit under this repository's [MIT license](LICENSE).
Keep existing notices. Do not copy closed engine source or third-party documentation/code without
appropriate rights and attribution. A contribution here does not change the runtime's license.
