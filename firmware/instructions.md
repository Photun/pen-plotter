# Plotter Studio Instructions

Plotter Studio is the app used to prepare artwork and send it to the CoreXY pen
plotter. It is meant to replace the terminal workflow for normal use.

## Launch The App

From the repo root:

```bash
firmware/tools/build_macos_app.sh
open "Plotter Studio.app"
```

The app starts a local backend at `http://127.0.0.1:8765` inside the native Mac
window. If the app cannot start, check `firmware/.plotter-app/desktop.log`.

The browser version can also be launched from this folder:

```bash
tools/run_plotter_studio.sh
```

Then open:

```text
http://127.0.0.1:8765
```

## Upload Firmware

Install the PlatformIO extension in VS Code, plug in the Arduino Uno, then run
from this `firmware/` folder:

```bash
pio run -e uno
pio run -e uno -t upload
```

In VS Code's PlatformIO sidebar, the checkmark builds and the right arrow
uploads. Close Plotter Studio, serial monitor, or any other app using the Arduino
port before uploading, because only one program can own the serial port at once.

Firmware only needs to be uploaded when `src/main.cpp` changes. Uploading SVGs
or images does not require reflashing the Arduino.

## Normal Plotting Workflow

1. Open Plotter Studio.
2. Go to Device and connect to the Arduino.
3. Turn motors off.
4. Move the toolhead by hand to the bottom-left home position.
5. Turn motors on.
6. Press `Confirm X0 Y0`.
7. Go to Prepare and open/import artwork.
8. Move, scale, and rotate the artwork on the plate.
9. Press `Slice Plate`.
10. Review the toolpath and gcode in Preview.
11. Press `Confirm Slice`.
12. Return to Device and press `Send To Plotter`.

Before a real drawing job starts, the app lifts the pen so an accidental pen-down
state from manual testing does not drag across the page.

## Prepare

Prepare is where artwork is placed before the machine moves.

Use `Open Image` for SVG, PNG, JPG, GIF, BMP, or WebP files. SVG files are loaded
as vector paths. Raster files open in a tracing popup first, where the image is
converted into drawable vector strokes.

The import popup has controls for edge threshold, simplify amount, trace size,
minimum stroke length, and link gap. If a trace is taking too long, changing a
slider cancels the old trace and starts a new one. The popup also shows progress
while tracing.

Use `Load Square` or `Load Circle` for quick test drawings.

Artwork on the plate can be selected, moved, resized, rotated, deleted, undone,
and redone. Dragging side handles changes one side. Dragging corners scales from
the adjacent edges. Holding shift keeps proportions. Rotation snaps to common
angles, and edges can snap to paper margins.

## Paper Mode

The paper dropdown controls what part of the machine area is considered usable.

`Full Canvas` uses the whole `406 x 370` machine coordinate area. `Letter`
displays a centered landscape Letter paper area inside the same full machine
canvas. The Letter rectangle is currently `140 x 108.182` machine units centered
at `X203 Y185`.

The gray overlay shows the margin/safety area. The grid still remains visible
under it so scale and placement are easier to judge.

To set up Letter paper physically, first put a larger backing sheet or board
under the plotter and keep it fixed in place. In Plotter Studio, set Paper to
`Letter`, set Margin to `0`, then use `Load Square`. Resize and drag the square
so its edges snap to the four edges of the Letter paper rectangle. Slice and draw
that rectangle onto the larger backing surface. This creates a permanent-ish
placement outline showing where Letter paper should sit.

After that outline exists, place Letter paper on top of the drawn rectangle and
tape it down so it cannot slide. Then load the real drawing normally, keep Paper
set to `Letter`, and raise Margin back to the safer value you actually want for
the job. The app will block anything outside the Letter paper rectangle and warn
if the drawing enters the margin.

If the art goes outside the selected paper, slicing is blocked. If it enters the
margin but stays on the paper, the app warns you but still allows slicing.

## Preview

Preview is the locked toolpath view. It shows what will be drawn after slicing,
plus the generated gcode. This is where you check that the plate looks right
before committing the job to the Device tab.

`Confirm Slice` does not start the machine. It only accepts the sliced toolpath
and moves you to Device, where the actual send button lives.

## Device

Device is for connecting to the Arduino, homing, manual control, live tuning, and
starting jobs.

Common controls:

```text
Motors On/Off        enable or release the stepper drivers
Confirm X0 Y0        tell firmware the current position is home
Jog arrows           move X/Y by the selected jog distance
Pen Up / Pen Down    move the servo and update the pen state buttons
Servo Off            lift pen and cut servo power
Speed delay          lower number means faster stepping
Acceleration         higher number reaches speed faster
Pen up/down wait     servo settle times
Pen up lift          percent of the full up angle to use
Stop                 abort, pen up, return home, reset progress
```

Jogging is manual control, so it does not automatically lift the pen. If the pen
is down and you jog, it will draw.

During a running job, jog controls are disabled. Use pause/stop before manual
movement.

## Job Minimap

After a slice is confirmed, the Device tab shows a job minimap. The remaining
path is gray, completed drawn path is teal, and the moving toolhead dot estimates
where the machine is between firmware acknowledgements. It resyncs whenever the
firmware reports that a gcode line finished.

When the job finishes, the minimap stays filled until `Stop` is pressed. Stop
acts like reset: it lifts the pen, returns home if possible, clears progress, and
hides the job map.

## Serial Port Notes

Plotter Studio connects over USB serial at `115200` baud. If connection fails
with a busy-resource error, close other serial monitors, Arduino IDE windows,
PlatformIO monitor sessions, or old Plotter Studio instances.

For raw debugging only:

```bash
pio device monitor -e uno
```
