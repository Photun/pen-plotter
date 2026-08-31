# CoreXY Pen Plotter

A large format Arduino based CoreXY pen plotter with a custom slicer app for turning digital artwork into physical drawings.

## Why This Exists

I built this because I wanted to make a drawing machine from the ground up, not just copy a finished plotter design and wire it exactly the same way. The interesting part became the whole chain working together: the CAD, belts, rollers, moving toolhead, pen lift, manual homing, firmware motion, gcode streaming, and a slicer app that makes the machine usable without typing terminal commands every time. It is still very much a prototype, but it can already take artwork, preview the toolpath, and draw it with a real pen.

## Photos And Demo

Main project photo:

![Main project photo placeholder](photos/main-project-photo-placeholder.svg)

Demo video:

[Plotter running demo video](photos/demo-plotter-running.mp4)

## What It Does

- Moves a pen toolhead using a CoreXY belt layout.
- Runs on an Arduino Uno with a CNC Shield V3 and DRV8825 drivers.
- Uses manual bottom-left homing, with `X0 Y0` as the home position.
- Lifts the pen with a servo.
- Switches servo power through a MOSFET so the pen does not twitch during boot.
- Streams a small plotter-focused gcode dialect over USB serial.
- Includes Plotter Studio, a local app for importing art, tracing images,
  preparing the plate, slicing, previewing, tuning motion, and sending jobs.
- Supports SVG paths and raster-image tracing through OpenCV-based tools.
- Preserves cubic Bezier curves when possible so curves are smoother than just a
  pile of short line segments.

## How It Fits Together

The physical machine is a CoreXY frame with two stepper motors, a belt-driven
gantry, and a servo pen-lift toolhead. The Arduino Uno runs the realtime motor
and pen firmware. The computer runs Plotter Studio, which turns images/SVGs into
gcode and sends one command at a time over USB serial.

```text
image or SVG
-> Plotter Studio import/trace
-> plate setup and slicing
-> gcode preview
-> USB serial
-> Arduino Uno firmware
-> CNC Shield stepper drivers
-> CoreXY motors and pen servo
```

## Build One

Start with the hardware docs:

- [Assembly guide](hardware/assembly.md)
- [Bill of materials](hardware/bom.md)
- Printable STL files in [hardware/exports/stl](hardware/exports/stl)
- Printable STEP files in [hardware/exports/step](hardware/exports/step)
- Full assembly STEP file in [hardware/exports/assembly](hardware/exports/assembly)

The CAD is also available in Onshape:

```text
https://cad.onshape.com/documents/21408afa0678dfc090a39137/w/cada99e8b20e026a88815622/e/614e2d6018b77ddf107765d2?renderMode=0&leftPanel=false&uiState=6a7a26314284ccba60f59ccc
```

After the machine is assembled and wired, install PlatformIO in VS Code and
upload the firmware:

```bash
cd firmware
pio run -e uno -t upload
```

Then build and launch Plotter Studio from the repo root:

```bash
firmware/tools/build_macos_app.sh
open "Plotter Studio.app"
```

For the browser version:

```bash
cd firmware
tools/run_plotter_studio.sh
```

Then open:

```text
http://127.0.0.1:8765
```

Normal drawing workflow:

1. Upload the firmware to the Arduino Uno.
2. Launch Plotter Studio.
3. Connect to the Arduino from the Device tab.
4. Turn motors off.
5. Move the toolhead by hand to the bottom-left corner.
6. Turn motors on.
7. Press `Confirm X0 Y0`.
8. Open or import artwork in Prepare.
9. Place, scale, and rotate it on the plate.
10. Press `Slice Plate`.
11. Check Preview and confirm the slice.
12. Send the job from Device.

For first tests, use `Load Square` or `Load Circle` in Plotter Studio.

More software instructions are in [firmware/instructions.md](firmware/instructions.md).
The deeper firmware/app notes are in [firmware/technical-notes.md](firmware/technical-notes.md).

## Repo Layout

```text
hardware/            assembly guide, BOM, exported CAD/STL files
firmware/            Arduino firmware, Plotter Studio app, scripts, examples
photos/              sample plots, wiring photos, demo video
```

Most readers should start with this README, then `hardware/assembly.md`, then
`hardware/bom.md`. The firmware internals are mostly for people changing code.

Generated local folders such as `.pio/`, `.venv/`, `.plotter-app/`, and
`Plotter Studio.app/` are not part of the source package.

## License

This project is licensed under the MIT License. See `LICENSE`.
