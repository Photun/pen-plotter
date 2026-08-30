#!/bin/zsh
cd "$(dirname "$0")/.."
(sleep 1; open http://127.0.0.1:8765) &
exec tools/run_plotter_studio.sh
