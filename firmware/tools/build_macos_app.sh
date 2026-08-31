#!/bin/zsh
set -e

FIRMWARE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$FIRMWARE_ROOT/.." && pwd)"
APP="$REPO_ROOT/Plotter Studio.app"

if [ ! -x "$FIRMWARE_ROOT/.venv/bin/python" ]; then
  /usr/bin/python3 -m venv "$FIRMWARE_ROOT/.venv"
fi

"$FIRMWARE_ROOT/.venv/bin/python" -m pip install -r "$FIRMWARE_ROOT/tools/requirements.txt"

mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

swiftc "$FIRMWARE_ROOT/desktop/macos/PlotterStudio.swift" \
  -framework Cocoa \
  -framework WebKit \
  -o "$APP/Contents/MacOS/Plotter Studio"

cp "$FIRMWARE_ROOT/desktop/macos/Info.plist" "$APP/Contents/Info.plist"
chmod +x "$APP/Contents/MacOS/Plotter Studio"

echo "Built $APP"
