# Maintainer release checklist

The plugin and compiled runtime preview are public; this checklist governs subsequent releases.
Running the checker does not publish, install a runtime,
submit to a directory, start a provider or approve a Git integration gate.

## Plugin release

1. Review every file in `package-inventory.json`. Keep the skill, command, metadata, original
   documentation, explicit installer and MIT notices only. Inspect the diff for private source, paths, credentials,
   research, runtime state or unrelated artifacts; the checker is not a complete secret scanner.
2. Keep the portable, Claude and Codex identity versions and Claude catalog entry aligned.
   Record the shared skill version separately. Update compatibility and release status honestly.
3. Run the package checker, both Claude manifest validations and `git diff --check`. Render
   and visually inspect changed Mermaid blocks. Confirm both host catalogs resolve their package.
4. In an explicitly chosen test host, verify discovery in a fresh conversation and a disposable
   workflow with the intended runtime. Do not replace a maintainer's existing setup by accident.
   Paid provider acceptance needs its own authorization; record exactly what was tested.
5. Configure a real security contact/private reporting before accepting external users.
6. Review the exact initial commit/file inventory and selected remote visibility with the owner.
   Record explicit owner authorization for preview publication and its unverified limits.
   Accepted release claims require the corresponding host checks. Use the separate plugin repository;
   do not point a public catalog at the private Mac application repository.
7. Consider official directory submissions after a usable runtime release and host acceptance.
   A self-hosted catalog is not an official endorsement or directory listing.

## Separate runtime release

Build the CLI and matching analyzer from reviewed MIT acp-core source, retain dependency notices,
and include the MIT license for original ACP code. Verify supported architectures, signing/notarization,
downloaded/quarantined installation, checksums and rollback. Publish the tested platform matrix;
an analyzer's universal architecture does not make a single-architecture CLI universal.

Use immutable versioned download assets and SHA-256 checksums. Do not include source, debug
symbols, credentials or internal reports in the public runtime package. Preserve the analyzer
beside the resolved CLI executable and include the relevant third-party notices.

Keep download links, pinned checksums, signing status and acceptance limits aligned with the
actual public asset. Runtime preview publication does not establish clean-machine acceptance.
Do not remove quarantine or bypass OS checks to make a demo work.
Keep a local development candidate explicitly labelled and separate from public assets.
