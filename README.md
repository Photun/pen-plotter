# Pen Plotter

A custom pen plotter designed in Onshape to draw physical 2D artwork with a moving pen carriage.

## Why I Built This

I wanted to make a drawing machine that turns digital designs into real pen strokes. The challenge I am working through is making the mechanical system smooth enough that the plotter draws clean lines instead of shaky ones: the frame needs to stay square, the carriage needs to move predictably, and the pen holder needs to lift and lower without throwing off alignment.

## What It Does

This project is a hardware pen plotter. The design includes a frame, belt/idler motion system, gantry, moving cart, toolhead, pen housing, stepper motors, and a servo-driven pen lift.

Current capabilities:

```text
CAD assembly designed in Onshape
Bill of materials exported and cleaned
Firmware folder scaffolded
CAD exports, photos, and final firmware still in progress
```

## Project Links

Onshape CAD:

https://cad.onshape.com/documents/21408afa0678dfc090a39137/w/cada99e8b20e026a88815622/e/614e2d6018b77ddf107765d2?renderMode=0&leftPanel=false&uiState=6a7a26314284ccba60f59ccc

Bill of materials:

```text
docs/bom.md
docs/bom.csv
```

## How It Fits Together

The plotter is organized around a rigid frame and a moving gantry/toolhead system.

```text
Frame and corner brackets
  hold the plotter square and support the belt/idler stacks

Stepper motors and pulleys
  drive the belt motion

Gantry extrusion and cart plates
  carry the moving toolhead across the drawing area

Toolhead and pencil housing
  hold the pen and handle pen lift/lower motion

Firmware
  will control motor movement, servo position, homing, and plot commands
```

## Photos

Hardware photos and CAD screenshots will go in `photos/`.

Needed before shipping:

```text
photos/cad-overview.png       Screenshot or render of the full CAD assembly
photos/frame-build.jpg        Frame/corner bracket build photo
photos/toolhead.jpg           Pen holder or moving cart photo
photos/first-plot.jpg         Photo of the plotter drawing or its first output
```

## Repository Layout

```text
docs/
  bom.md        Clean human-readable bill of materials
  bom.csv       Clean spreadsheet-friendly bill of materials

exports/
  stl/          STL files for printed parts
  drawings/     PDF or DXF drawings
  *.step        Full CAD exports

firmware/
  README.md     Firmware notes and planned controls
  src/          PlatformIO or C/C++ source
  include/      Shared headers
  arduino/      Arduino IDE sketches

photos/
  Build photos, CAD screenshots, and plot output images
```

## How to Reproduce It

1. Open the Onshape CAD link above.
2. Review the cleaned bill of materials in `docs/bom.md`.
3. Export the full assembly from Onshape as a STEP file and place it in `exports/`.
4. Export printable parts as STL files and place them in `exports/stl/`.
5. Build the frame and motion system from the CAD and BOM.
6. Add electronics and firmware once the controller board is chosen.
7. Add build photos and a first-plot photo to `photos/`.

## Setup Instructions

For CAD review:

1. Open the Onshape link in a browser.
2. Use the Assembly tab to inspect the full mechanism.
3. Use the BOM in `docs/bom.md` to match parts to the design.

For local files:

```bash
git clone https://github.com/Photun/pen-plotter.git
cd pen-plotter
```

For firmware:

```text
Firmware upload instructions will be added after the controller board and motor driver setup are finalized.
```

## Onshape Export Instructions

For the full assembly:

1. Open the assembly tab in Onshape.
2. Right-click the assembly tab at the bottom.
3. Choose `Export`.
4. Pick `STEP`.
5. Save the file into `exports/`.

For 3D printing:

1. Open the Part Studio or Assembly containing the printable part.
2. Right-click the part or tab.
3. Choose `Export`.
4. Pick `STL`.
5. Save individual files into `exports/stl/`.

## Current Status

```text
Design: in progress in Onshape
BOM: cleaned and uploaded
CAD exports: not uploaded yet
Firmware: scaffold added, code not written yet
Build photos: not uploaded yet
```

## License

This project is licensed under the MIT License. See `LICENSE`.
