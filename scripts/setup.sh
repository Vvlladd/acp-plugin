#!/bin/bash
# MIT. Explicit setup for the selected host; no automatic provider authentication or work.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
host=''
installer_args=("$ROOT/scripts/install-runtime.sh")
usage() { printf 'Usage: bash scripts/setup.sh --host claude|codex [--archive /absolute/runtime.zip] [--install-root /absolute/directory]\n'; }
while [ "$#" -gt 0 ]; do
    case "$1" in
        --host) [ "$#" -ge 2 ] || { usage; exit 1; }; host="$2"; shift 2 ;;
        --archive|--install-root) [ "$#" -ge 2 ] || { usage; exit 1; }; installer_args+=("$1" "$2"); shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; exit 1 ;;
    esac
done
case "$host" in claude|codex) ;; *) usage >&2; exit 1;; esac
command -v "$host" >/dev/null || { printf 'Install the selected %s CLI before setup.\n' "$host" >&2; exit 1; }
bash "${installer_args[@]}"
printf '\nInstalling the ACP plugin in %s. If this step fails, retain the runtime and use the manual host steps.\n' "$host"
"$host" plugin marketplace add Vvlladd/acp-plugin
if [ "$host" = claude ]; then
    claude plugin install acp@acp-community
else
    codex plugin add acp@acp-community
fi
"$host" plugin list
printf '\nApply the runtime PATH line above, run acp doctor for your repository, and start a fresh host conversation.\n'
