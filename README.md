# Pen Plotter

A custom pen plotter designed in Onshape to draw precise 2D artwork with a moving pen carriage.

I built this because I wanted a physical drawing machine that turns digital designs into real pen strokes. The interesting part is the mechanical system: making a frame, carriage, and pen holder that can move smoothly enough to create clean drawings instead of shaky sketches.

## CAD

The current source design lives in Onshape:

https://cad.onshape.com/documents/21408afa0678dfc090a39137/w/cada99e8b20e026a88815622/e/911062ddadce9426653d0762?renderMode=0&uiState=6a7948f8a6b0562811866a59

Exported CAD files should go in `exports/`.

Recommended exports:

```text
exports/pen-plotter.step  Complete assembly for CAD review
exports/stl/              Individual STL files for 3D printing
exports/drawings/         PDF or DXF drawings, if needed
```

## Project Status

```text
Design: in progress in Onshape
Build: not documented yet
Firmware: scaffold added in firmware/
Photos: not added yet
```

## How to Reproduce

1. Open the Onshape CAD link above.
2. Export the assembly as a STEP file for the full design.
3. Export printable parts as STL files.
4. Add the exported files to `exports/`.
5. Add build photos, renders, and wiring photos to `photos/`.
6. Use the bill of materials in `docs/bom.md` once parts are finalized.
7. Add controller code and upload notes to `firmware/` once the electronics are chosen.

## Onshape Export Quick Guide

For the full assembly:

1. Open the assembly tab in Onshape.
2. Right-click the assembly tab at the bottom.
3. Choose `Export`.
4. Pick `STEP` for a shareable CAD file.
5. Save the file into `exports/`.

For 3D printing:

1. Open the Part Studio or Assembly containing the printable part.
2. Right-click the part or tab.
3. Choose `Export`.
4. Pick `STL`.
5. Save individual files into `exports/stl/`.

## Photos

Add photos or screenshots to `photos/` before shipping on Macondo. Good options:

```text
photos/cad-overview.png
photos/frame-build.jpg
photos/pen-carriage.jpg
photos/first-plot.jpg
```

## License

This project is licensed under the MIT License. See `LICENSE`.
