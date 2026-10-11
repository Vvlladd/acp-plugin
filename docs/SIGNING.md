# What needs signing?

The free distribution contains two macOS executables: `acp` (the Rust CLI/daemon) and
`acp-swift-checks` (its bundled analyzer). **Both need Developer ID signing for the planned
notarized distribution.** The text skill, marketplace metadata and README need no Apple signature.
The Mac app is not in this package and is not required.

## Current preview

This release has ad hoc development signatures. It is not Developer ID signed or notarized.
Checksums verify that a download matches the published bytes; they do not provide an Apple-verified
publisher identity. macOS may block downloaded executables. The installer retains quarantine and
does not modify Gatekeeper settings. Do not bypass those protections to report a successful install.

## Maintainer prerequisites for a notarized release

1. Membership in an Apple Developer team and its Team ID.
2. A **Developer ID Application** certificate with its matching private key installed in Keychain.
   Apple Development and Apple Distribution certificates are different certificate types.
3. A `notarytool` Keychain profile for that team's notarization credentials. Configure it in your
   own terminal with interactive prompts; do not put passwords, API private keys or exported
   certificate keys in this repository or chat.

For a ZIP containing these executables, **Developer ID Installer is not required**. It becomes
relevant if a later release uses a signed `.pkg` installer. Apple documents the certificate types
and creation process in [Create Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).

## Release sequence

- Sign each executable with Developer ID Application, a secure timestamp and hardened runtime.
- Verify both signatures, then rerun the local daemon/helper acceptance checks.
- Recreate checksums and the ZIP after signing; submit it using the configured `notarytool` profile.
- Require an accepted notarization result and retain its submission ID/log. A ZIP is not a
  stapling target; a future supported container such as a DMG or PKG can carry a stapled ticket.
- Test the downloaded/quarantined result on a clean Mac, including offline behavior where claimed.
- Publish a **new** version and update the installer’s pinned URL/hash. Do not silently replace
  an already published preview asset.

See [Apple's signing overview](https://developer.apple.com/developer-id/) and
[custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).
The certificate/profile names are enough to select existing credentials for automation; private
keys and passwords stay in Keychain. No subscription or Mac GUI app is required by ACP itself.
