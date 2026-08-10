# Firmware

Firmware for the pen plotter will live here.

## Layout

```text
firmware/
  README.md
  src/       PlatformIO or C/C++ source files
  include/   Shared headers
  arduino/   Arduino IDE sketches
```

Use `src/` and `include/` if the project moves to PlatformIO or a more structured C++ firmware setup. Use `arduino/` if the first version is a simple Arduino IDE sketch.

## Planned Responsibilities

```text
stepper motor control
pen lift servo control
homing and calibration
plot command parsing
motion limits and safety checks
```

## Hardware Target

The exact controller board has not been chosen yet. Once it is picked, add board details, wiring notes, dependencies, and upload instructions here.
