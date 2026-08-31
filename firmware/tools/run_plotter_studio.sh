#!/bin/zsh
set -e

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ]; then
  /usr/bin/python3 -m venv .venv
  .venv/bin/python -m pip install -r tools/requirements.txt
fi

exec .venv/bin/python tools/plotter_studio.py
