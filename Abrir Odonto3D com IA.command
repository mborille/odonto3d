#!/bin/zsh
set -e
HERE="${0:A:h}"
BUNDLED="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ -x "$HOME/.cache/odonto3d/ai-venv/bin/python" ]]; then
  PYTHON="$HOME/.cache/odonto3d/ai-venv/bin/python"
elif [[ -x "$BUNDLED" ]]; then
  PYTHON="$BUNDLED"
else
  PYTHON="$(command -v python3)"
fi
"$PYTHON" "$HERE/odonto3d/ai/launch.py"
