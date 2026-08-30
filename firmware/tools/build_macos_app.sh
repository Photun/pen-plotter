#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Plotter Studio.app"

if [ ! -x "$ROOT/.venv/bin/python" ]; then
  python3 -m venv "$ROOT/.venv"
fi

"$ROOT/.venv/bin/python" -m pip install -r "$ROOT/tools/requirements.txt"

mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

swiftc "$ROOT/desktop/macos/PlotterStudio.swift" \
  -framework Cocoa \
  -framework WebKit \
  -o "$APP/Contents/MacOS/Plotter Studio"

cp "$ROOT/desktop/macos/Info.plist" "$APP/Contents/Info.plist"
chmod +x "$APP/Contents/MacOS/Plotter Studio"

echo "Built $APP"
