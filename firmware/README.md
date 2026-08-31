# Firmware And Plotter Studio

This folder contains the Arduino firmware, the Plotter Studio app, and the small
helper scripts used to run the machine.

Start here:

- [Instructions](instructions.md) for normal use: opening art,
  slicing, connecting, homing, tuning, and sending a plot.
- [Technical notes](technical-notes.md) for how the app, slicer, serial sender,
  gcode, motion planner, and servo power system fit together.

Most users should not need to touch the Python scripts directly. Normal drawing
happens through Plotter Studio, while firmware only needs to be re-uploaded when
`src/main.cpp` changes.
