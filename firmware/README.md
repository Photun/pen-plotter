# Plotter Studio And Firmware

This is the practical guide for running the plotter from VS Code / PlatformIO
and Plotter Studio. The firmware source is `src/main.cpp`, but most
normal drawing should happen from the app, not by typing serial commands.

## Upload Firmware

Install the PlatformIO extension in VS Code, connect the Arduino Uno, then run
from this `firmware/` folder:

```bash
pio run -e uno
pio run -e uno -t upload
```

In VS Code's PlatformIO bar, the checkmark builds and the right-arrow uploads.
Close Plotter Studio or any serial monitor before uploading, because only one
program can use the Arduino serial port at a time.

Firmware only needs to be uploaded when `src/main.cpp` changes. Normal
drawings are sent from Plotter Studio over USB serial.

## Launch Plotter Studio

Build the Mac app:

```bash
tools/build_macos_app.sh
open "Plotter Studio.app"
```

Or run the browser version:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements.txt
.venv/bin/python tools/plotter_studio.py
```

Then open:

```text
http://127.0.0.1:8765
```

## Normal Use

1. Open Plotter Studio.
2. Connect to the Arduino in the Device tab.
3. Turn motors off.
4. Move the toolhead by hand to bottom-left `X0 Y0`.
5. Turn motors on.
6. Press `Confirm X0 Y0`.
7. Open/import art in Prepare.
8. Scale, move, and rotate it on the plate.
9. Press `Slice Plate`.
10. Check Preview, then `Confirm Slice`.
11. Send the job from Device.

For simple tests, use `Load Square` or `Load Circle`.

## Prepare And Slice

Prepare is where artwork gets loaded and placed before the machine moves.

```text
Open Image      load SVG, PNG, JPG, GIF, BMP, or WebP artwork
Load Square     load examples/square.svg
Load Circle     load examples/circle.svg
Slice Plate     generate gcode and preview paths
```

The app supports SVG files directly. Raster images open in an import popup
first, where the image is traced into vector paths. The trace controls adjust
edge threshold, simplify amount, trace size, minimum stroke length, and link
gap. Changing those values cancels the current trace and starts a new one.

Loaded artwork can be moved, resized, rotated, selected, deleted, undone, and
redone before slicing. Slice is invalidated when placement or process settings
change, so the app should not send stale gcode.

Paper size can be set to full canvas or centered Letter paper. Full canvas uses
the full `406 x 370` machine area. Letter mode keeps the full machine canvas
visible but limits slicing to a centered landscape Letter rectangle, currently
`140 x 108.182` machine units centered at `X203 Y185`.

For Letter paper, draw `examples/letter-outline.gcode` once onto the stationary
backing board, keep that board fixed, and tape Letter paper onto the outline.
That makes the real paper placement match the app's centered Letter rectangle.

After slicing, Preview shows the generated toolpath and gcode. Confirming the
slice moves you to Device, where jobs actually start.

## Device Controls

Useful controls in the Device tab:

```text
Motors On/Off        enable or release the steppers
Confirm X0 Y0        tell firmware the current spot is home
Jog                  move in X/Y by the selected step size
Pen Up / Pen Down    move the servo
Servo Off            lift pen and cut servo power
Speed delay          lower is faster
Acceleration         higher reaches speed faster
Pen up/down wait     servo settle delays
Pen up lift          percent of the full up angle to use
Stop                 abort current motion, pen up, return home, reset job
```

The pen lift uses a MOSFET-switched external 5V supply to avoid servo twitching
at boot. The app can tune the servo waits and the pen-up lift percentage without
re-slicing.

The Job panel shows a minimap after a slice is confirmed. Gray path is remaining
work, teal path is drawn work, and the moving dot estimates live toolhead
position between firmware acknowledgements.

Stop sends a realtime abort byte to the firmware, so long moves can stop in the
middle instead of waiting for the whole gcode line to finish. After stopping,
the app lifts the pen, returns to `X0 Y0` if home is confirmed, and resets job
progress.

## Manual Serial Notes

The firmware listens at `115200` baud and replies with `ok` or `error`. If you
need a raw monitor:

```bash
pio device monitor -e uno
```

Useful commands:

```text
?              show help
h              confirm current position as X0 Y0
p              print current position/settings
mon / moff     enable / disable stepper drivers
u / d          pen up / pen down
soff           servo off
M340 U200 D600 L100   set pen waits and lift percent
M204 S10000           set acceleration
```

The app normally handles generated plot commands for you.

## Hardware Target

```text
board: Arduino Uno
shield: CNC Shield V3
drivers: DRV8825
baud: 115200
machine area: X406 Y370
```

Pin mapping:

```text
D2  CNC Shield X step = CoreXY motor A step
D3  CNC Shield Y step = CoreXY motor B step
D5  CNC Shield X dir  = CoreXY motor A dir
D6  CNC Shield Y dir  = CoreXY motor B dir
D8  CNC Shield enable, active LOW
D11 Z-limit signal -> servo power MOSFET gate
D12 SpnEn -> servo signal
```

Low-side MOSFET servo wiring:

```text
Servo red wire       -> external 5V +
Servo brown/black    -> MOSFET drain
MOSFET source        -> external 5V GND and Arduino/CNC shield GND
Servo orange/yellow  -> CNC shield SpnEn / D12 signal
D11 / Z-limit signal -> 220 ohm resistor -> MOSFET gate
MOSFET gate          -> 10k pulldown -> GND
```

All grounds must be common.
