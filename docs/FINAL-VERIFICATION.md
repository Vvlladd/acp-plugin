# Free preview verification

## November 23 Apple Silicon release

On macOS 27.2.1, the installer downloaded the public November ZIP anonymously, verified its
SHA-256 and installed the CLI and analyzer in a disposable directory. The downloaded daemon
reported `humanSetupVersion: 2` and Doctor completed with zero failures and two warnings about
dated model pricing and the Codex writer sandbox version. The October and November packages
could be selected side by side. Six installer tests covered valid installation, checksum
rejection, existing and symlink destinations, Git checkout refusal and quarantine preservation.
Both executables are ad hoc signed.
[Release and checksums](https://github.com/Vvlladd/acp-core/releases/tag/runtime-v0.1.0-preview.20261123)

## External acceptance checklist

Use these steps to record results on a new machine and in fresh host sessions.

- [ ] On a test Mac, record macOS, architecture, host CLI versions and package hashes.
- [ ] Inspect the MIT license and included dependency notices.
- [ ] Download/extract the exact proposed runtime through the intended distribution path.
      Record macOS’s signing/quarantine result honestly. Do not remove quarantine or disable
      Gatekeeper. A local development build passing does not establish downloaded acceptance.
- [ ] Place the CLI and matching analyzer together outside a customer repository; preserve
      permissions and notices. Verify the release checksum list before execution.
- [ ] Run `acp --version` and `acp doctor --repo /absolute/path/to/disposable/repo`.
      Record unsupported/missing providers explicitly.
- [ ] In a chosen test Claude Code host, install this marketplace and confirm `/acp:acp`
      in a fresh conversation. Check that setup does not start paid work automatically.
- [ ] In a chosen test Codex host, add the local clone’s marketplace and install ACP;
      confirm `acp-control-plane` in a fresh conversation. Keep only one active ACP plugin.
- [ ] In a disposable repository, inspect readiness and confirm an exact supported team.
      Provider work is optional and consumes the user’s provider account; authorize it explicitly.
- [ ] If exercising a build, inspect frozen evidence and personally approve or deny the gate.
      Confirm the agent waits. Never use a real production gate as a test.
- [ ] Confirm the current host remains the lead and task/history views describe the same run.
      Complete chat transfer is not promised.
- [ ] Finish work before changing runtime versions. Test returning to the previous version
      while preserving local history. Do not run two daemon owners for one repository.
- [ ] Record results, limitations and supported platforms. Use these observations for the next accepted release and supported-platform claims.

An official marketplace directory submission is optional and separate from this GitHub catalog.
