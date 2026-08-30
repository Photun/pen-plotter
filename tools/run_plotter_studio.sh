#!/bin/zsh
set -e

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python - <<'PY' >/dev/null 2>&1
import fastapi
import cv2
import numpy
import scipy
import serial
import svgpathtools
import uvicorn
PY
then
  .venv/bin/python -m pip install -r tools/requirements.txt
fi

exec .venv/bin/python tools/plotter_studio.py
