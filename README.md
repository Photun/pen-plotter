# CoreXY Pen Plotter

A custom CoreXY pen plotter that turns SVGs and traced raster images into real
pen drawings. The hardware is designed in Onshape, the firmware runs on an
Arduino Uno with a CNC Shield, and the local Plotter Studio app handles image
import, slicing, preview, serial control, and sending jobs to the machine.

## Why This Exists

I wanted to build a drawing machine from the ground up instead of just copying a
finished plotter. The interesting part is not only making motors move. It is
getting the whole chain to behave: CAD, belts, rollers, toolhead, servo lift,
manual homing, firmware motion, gcode streaming, and a slicer app that makes the
machine usable without living in terminal forever.

The current prototype can draw test SVGs, trace images into vector paths, preview
toolpaths, and stream jobs over USB serial.

## Current Features

- Arduino Uno + CNC Shield firmware for CoreXY motion.
- Manual homing with bottom-left as `X0 Y0`.
- Acceleration-limited motion profile for straight and Bezier moves.
- Servo pen lift using MOSFET-switched external 5V power to avoid boot twitch.
- Plotter-specific gcode dialect over USB serial.
- Plotter Studio desktop/browser app for preparing art, slicing, previewing,
  live device control, and sending jobs.
- SVG slicing with cubic Bezier support.
- Raster image import using OpenCV-assisted tracing modes.
- Example square and circle files for smoke testing.

## Project Status

This is a working prototype, still being prepared for a polished Macondo ship.

Done:

- CAD design exists in Onshape.
- BOM is exported and cleaned.
- Firmware builds with PlatformIO.
- Manual motor/servo tests have passed.
- Plotter Studio app is usable locally.
- SVG and raster-to-vector workflows exist.

Still needed before final shipping:

- Add build photos and first plot photos to `photos/`.
- Add a real Macondo thumbnail showing the actual project.
- Do final mechanical tuning and document any changed dimensions.

## Quick Start

Clone the repo:

```bash
git clone https://github.com/Photun/pen-plotter.git
cd pen-plotter
```

Install PlatformIO for VS Code, then build firmware:

```bash
cd firmware
pio run -e uno
```

Upload to an Arduino Uno:

```bash
cd firmware
pio run -e uno -t upload
```

Build and launch the desktop controller app:

```bash
cd firmware
tools/build_macos_app.sh
open "Plotter Studio.app"
```

Or launch the browser version:

```bash
cd firmware
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements.txt
.venv/bin/python tools/plotter_studio.py
```

Then open:

```text
http://127.0.0.1:8765
```

## Normal Drawing Workflow

1. Upload the firmware to the Arduino Uno.
2. Launch Plotter Studio.
3. Connect to the Arduino from the Device tab.
4. Turn motors off.
5. Move the toolhead by hand to the bottom-left corner.
6. Turn motors on.
7. Press Confirm X0 Y0.
8. Open or import artwork in Prepare.
9. Place/scale/rotate it on the plate.
10. Press Slice Plate.
11. Check Preview and confirm the slice.
12. Send the job from Device.

For first tests, use `Load Square` or `Load Circle` in Plotter Studio.

## Hardware Overview

Main electronics:

```text
Arduino Uno
CNC Shield V3
DRV8825 stepper drivers
2x NEMA 17 stepper motors
servo for pen lift
external motor supply
external 5V servo supply
IRLZ44N N-channel MOSFET for servo power switching
```

Known machine bounds:

```text
X0 Y0       bottom-left manual home
X203 Y185   approximate center
X406 Y370   far corner
```

Known pin mapping:

```text
D2  CNC Shield X step = CoreXY motor A step
D3  CNC Shield Y step = CoreXY motor B step
D5  CNC Shield X dir  = CoreXY motor A dir
D6  CNC Shield Y dir  = CoreXY motor B dir
D8  CNC Shield enable, active LOW
D11 Z-limit signal -> MOSFET gate for servo power
D12 SpnEn -> servo signal
```

## What's In This Repo

```text
hardware/            assembly guide and BOM
firmware/            Arduino firmware, Plotter Studio app, scripts, examples
photos/              build photos, CAD screenshots, plot photos
```

Most readers should start with `README.md`, then `hardware/assembly.md`, then the
BOM. The firmware and app folders are mostly implementation details unless you
are changing code.

Folders you can mostly ignore when just reviewing or building the machine:

```text
firmware/app/        app frontend internals
firmware/desktop/    native macOS wrapper source
firmware/tools/      Python backend and helper scripts
firmware/examples/   quick test drawings
hardware/exports/    final CAD exports
photos/              project photos, once added
```

Generated local folders such as `.pio/`, `.venv/`, `.plotter-app/`, and
`Plotter Studio.app/` are not part of the source package.

## Build Files

- `hardware/assembly.md` - main build guide: mechanical assembly, electronics, wiring, first tests
- `hardware/bom.md` - human-readable bill of materials
- `hardware/bom.csv` - spreadsheet-friendly bill of materials
- `firmware/README.md` - Plotter Studio, firmware upload, controls, pin notes

## CAD

Onshape CAD:

```text
https://cad.onshape.com/documents/21408afa0678dfc090a39137/w/cada99e8b20e026a88815622/e/614e2d6018b77ddf107765d2?renderMode=0&leftPanel=false&uiState=6a7a26314284ccba60f59ccc
```

Exported CAD files are included in `hardware/exports/`: the full assembly STEP
is in `hardware/exports/assembly/`, and printable STL files are in
`hardware/exports/stl/`.

## Before Shipping

Before final Macondo shipping, this repo still needs:

- build photos, CAD screenshots, and first plot photos in `photos/`
- a good project thumbnail
- one last pass through the assembly guide with the real final hardware

## License

This project is licensed under the MIT License. See `LICENSE`.
