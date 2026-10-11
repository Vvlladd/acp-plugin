#!/bin/bash
# MIT. User-invoked installer; no hooks, sudo, provider calls or security bypasses.
set -euo pipefail
readonly RELEASE_ID='0.1.0-preview.20261011'
readonly ASSET="ACP-runtime-${RELEASE_ID}-macos-arm64.zip"
readonly BASE_URL="https://github.com/Vvlladd/acp-plugin/releases/download/runtime-v${RELEASE_ID}"
readonly EXPECTED_SHA256='fb5f09c8c3d20216f0c9e6d9d23b761e6e17de1cd64b42284e9d088ed4ec6195'
install_root="${HOME}/Library/Application Support/ACP/runtimes"
archive=''
usage() {
    cat <<'USAGE'
Usage: bash scripts/install-runtime.sh [--archive /absolute/runtime.zip] [--install-root /absolute/directory]
Downloads the pinned Apple Silicon preview, verifies it, and installs in a new version directory.
Use --archive for an already-downloaded copy of the same release. No existing version is replaced.
No executables are run, shell profiles edited, hosts configured, daemons started or gates approved.
USAGE
}
fail() { printf 'ACP install: %s\n' "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive|--install-root)
            [ "$#" -ge 2 ] || fail "Missing value for $1"
            case "$1" in --archive) archive="$2";; --install-root) install_root="$2";; esac
            shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; fail "Unknown argument: $1" ;;
    esac
done
[ "$(/usr/bin/uname -s)" = Darwin ] || fail 'This preview requires macOS.'
[ "$(/usr/bin/uname -m)" = arm64 ] || fail 'This preview requires a native Apple Silicon terminal; no Intel CLI is included.'
macos_major="$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)"
[ "$macos_major" -ge 26 ] || fail 'This preview targets macOS 26 or later; only macOS 27 has been locally tested.'
case "$install_root" in /*) ;; *) fail '--install-root must be an absolute path.';; esac
case "$install_root$archive" in *$'\n'*|*$'\r'*) fail 'Paths must not contain line breaks.';; esac
[ -n "$install_root" ] && [ "$install_root" != / ] || fail 'Choose a dedicated runtime directory.'
/bin/mkdir -p "$install_root"
install_root="$(cd "$install_root" && pwd -P)"
[ "$install_root" != / ] || fail 'Choose a dedicated runtime directory.'
if [ "$(git -C "$install_root" rev-parse --is-inside-work-tree 2>/dev/null || true)" = true ]; then
    fail 'Choose an install root outside a Git checkout.'
fi
destination="$install_root/$RELEASE_ID"
[ ! -e "$destination" ] && [ ! -L "$destination" ] || fail "Version already exists: $destination. Nothing was replaced."
work="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/acp-install.XXXXXX")"
trap '/bin/rm -rf "$work"' EXIT
if [ -z "$archive" ]; then
    archive="$work/$ASSET"
    /usr/bin/curl --fail --location --show-error --silent --proto '=https' --proto-redir '=https' \
        --connect-timeout 20 --max-time 180 --output "$archive" "$BASE_URL/$ASSET"
else
    case "$archive" in /*) ;; *) fail '--archive must be an absolute path.';; esac
    [ -f "$archive" ] && [ ! -L "$archive" ] || fail 'Archive must be a regular file, not a symlink.'
fi
actual="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
[ "$actual" = "$EXPECTED_SHA256" ] || fail 'Archive checksum mismatch. No runtime was installed.'
/bin/mkdir "$work/unpacked"
/usr/bin/ditto -x -k "$archive" "$work/unpacked"
package="$work/unpacked/ACP-runtime-$RELEASE_ID"
[ -f "$package/acp" ] && [ -f "$package/acp-swift-checks" ] || fail 'Matching CLI/helper missing.'
[ -z "$(/usr/bin/find "$work/unpacked" -type l -print)" ] || fail 'Archive contains an unexpected symlink.'
(cd "$package" && /usr/bin/shasum -a 256 -c SHA256SUMS.txt) > "$work/checks.log" || fail 'An extracted payload checksum failed.'
/usr/bin/codesign --verify --strict "$package/acp"
/usr/bin/codesign --verify --strict "$package/acp-swift-checks"
# Preserve a browser download's quarantine marker on both executables. Never remove it.
quarantine="$(/usr/bin/xattr -p com.apple.quarantine "$archive" 2>/dev/null || true)"
if [ -n "$quarantine" ]; then
    /usr/bin/xattr -w com.apple.quarantine "$quarantine" "$package/acp"
    /usr/bin/xattr -w com.apple.quarantine "$quarantine" "$package/acp-swift-checks"
fi
/bin/mkdir "$destination" # Exclusive creation; refuse concurrent/existing installs.
/usr/bin/ditto "$package" "$destination"
[ -x "$destination/acp" ] && [ -x "$destination/acp-swift-checks" ] || fail 'Executable permissions were not preserved.'
printf 'Installed verified preview files in: %s\n' "$destination"
printf 'This preview is ad hoc signed, NOT Developer ID signed or notarized. macOS may block execution.\n'
printf 'No runtime was executed or existing installation replaced. Do not bypass macOS protections.\n'
printf '\nFor this terminal, use:\nexport PATH=%q:"$PATH"\n' "$destination"
printf '\nThen check: command -v acp; acp --version; acp doctor --repo /absolute/path/to/your/repo\n'
printf 'Restart the host with this PATH or use the absolute installed acp path in your conversation.\n'
