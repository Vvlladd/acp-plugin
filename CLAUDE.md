# ACP plugin contributor instructions

Read the [contributing guide](CONTRIBUTING.md) before changing the host plugin or workflow map.
The [shared host skill](plugins/acp/skills/acp-control-plane/SKILL.md#choose-a-workflow)
defines the chooser for an explicit ACP invocation. Ordinary repository work follows the
current chat’s instructions. Keep Claude’s command pointed at the shared skill.

Run `python3 scripts/check_package.py` after changing the package or its documentation.
Keep these instructions in this file. [AGENTS.md](AGENTS.md) points here for Codex.
