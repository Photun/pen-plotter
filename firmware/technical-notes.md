# Technical Notes

This file describes how the software side works. It is not the main user guide;
it is here so the firmware, slicer, and serial behavior are easier to understand
or modify later.

## System Shape

The plotter has three main software pieces:

```text
src/main.cpp                 Arduino Uno firmware
tools/plotter_studio.py      local Python backend and serial controller
app/static/*                 Plotter Studio frontend
```

The Mac app in `desktop/macos/` is a small WebKit wrapper. It starts the Python
backend and loads the local Plotter Studio page. The generated `Plotter
Studio.app` is intentionally ignored by git because it is a local build artifact.

## Firmware Target

```text
board: Arduino Uno
shield: CNC Shield V3
drivers: DRV8825
baud: 115200
machine area: X406 Y370
```

Pin mapping:

```text
D2   CNC Shield X step = CoreXY motor A step
D3   CNC Shield Y step = CoreXY motor B step
D5   CNC Shield X dir  = CoreXY motor A dir
D6   CNC Shield Y dir  = CoreXY motor B dir
D8   CNC Shield enable, active LOW
D11  Z-limit signal -> servo power MOSFET gate
D12  SpnEn -> servo signal
```

The machine coordinates are internal plotter units, not real millimeters. That
is why the full area is `406 x 370`, while Letter paper is represented as `140 x
108.182` in the app.

## Serial Protocol

The firmware reads newline-terminated serial commands at `115200` baud. Most
commands reply with `ok` when complete or `error` when rejected. The Python
backend sends one command at a time and waits for the acknowledgement before
sending the next normal gcode line.

There is also a realtime abort byte so `Stop` can interrupt long moves without
waiting for the current line to finish. After aborting, the app lifts the pen,
returns to `X0 Y0` when home is confirmed, and resets job state.

Manual serial commands:

```text
?                 show help
h                 confirm current position as X0 Y0
p                 print position/settings
mon / moff        enable / disable motors
u / d             pen up / pen down
son / soff        servo power on / off
a 100             set servo angle directly
s 20              set raw step delay
accel 20000       set raw acceleration
```

Supported plot-style commands:

```text
G0 Xn Yn Fn       travel move
G1 Xn Yn Fn       draw move
G5 Xn Yn I J P Q  cubic bezier move
G28 P1            confirm manual home at X0 Y0
M3                pen down
M5                pen up
M17 / M18         motors on / off
M204 Snnn         acceleration in steps/sec^2
M340 U D L        pen up wait, pen down wait, lift percent
M2 / M30          end program, pen up and servo off
```

## Motion Planning

The firmware uses CoreXY mixing, so Cartesian X/Y moves are converted into motor
A/B step counts. The movement loop steps whichever motor axes need a pulse at
each Bresenham-like interval so straight lines stay coordinated.

Speed is controlled mainly by step delay. Lower delay means faster pulses.
Acceleration controls how quickly the firmware is allowed to approach that
requested speed. The intended velocity profile is trapezoidal: accelerate,
cruise when the line is long enough, then decelerate. For short moves, the
profile naturally becomes triangular because there is not enough distance to hit
the requested top speed.

Curves are not sent as hundreds of tiny straight gcode segments when the slicer
can preserve them. The app can emit cubic bezier moves as `G5`, and the firmware
samples those curves internally while sharing one continuous motion profile
across the curve. This avoids the repeated stop/start behavior that happens when
a curve is broken into too many independent line moves.

## Servo Power And Pen Lift

The pen servo is powered through a low-side MOSFET so it does not twitch at boot.
The firmware sets the desired servo target, attaches the servo signal, then turns
on the MOSFET-controlled power. When powering off, it lifts the pen first, cuts
power, waits briefly, then detaches the servo signal.

Wiring summary:

```text
Servo red wire       -> external 5V +
Servo brown/black    -> MOSFET drain
MOSFET source        -> external 5V GND and Arduino/CNC shield GND
Servo orange/yellow  -> CNC shield SpnEn / D12 signal
D11 / Z-limit signal -> 220 ohm resistor -> MOSFET gate
MOSFET gate          -> 10k pulldown -> GND
```

All grounds must be common.

The app exposes pen up wait, pen down wait, and pen up lift percent. The lift
percent is useful for dense dotted drawings where the pen only needs to rise a
little before the next nearby stroke.

## Slicing Pipeline

Plotter Studio accepts SVG directly and raster images through the trace importer.
SVG paths are parsed with `svgpathtools`. Lines, quadratic curves, cubic curves,
and arcs are normalized into drawable strokes. The slicer keeps cubic geometry
where possible so the firmware can run smoother bezier motion.

Raster tracing uses OpenCV-based preprocessing and contour extraction. The import
settings control how aggressively edges are found, simplified, linked, and
filtered. Tracing runs as a cancellable job: changing a setting abandons the old
trace request so a bad threshold does not trap the app in a long computation.

Before gcode is accepted, the backend checks machine bounds, selected paper
bounds, and margin warnings. Outside the machine or selected paper blocks
slicing. Inside the paper margin only warns.

After slicing, the generated preview contains path geometry, gcode text, bounds,
warnings, estimated distance, and estimated runtime. Confirming the slice queues
that result for the Device tab.

## Route Optimization

The slicer groups drawable geometry into strokes and orders them to reduce
pen-up travel. It can reverse strokes when starting from the other end is
shorter. This is a practical nearest-neighbor style optimization, not a perfect
traveling-salesman solve. The goal is to cut obvious wasted travel without
making slicing painfully slow.

This matters because every pen-up travel and every separate stroke resets some
motion momentum. Fewer disconnected strokes usually means less servo waiting,
less acceleration/deceleration, and a cleaner plot.

## Generated And Ignored Files

These are local artifacts and should not be committed:

```text
.pio/
.venv/
.plotter-app/
Plotter Studio.app/
```

The source files live in git. The built app, Python environment, PlatformIO
builds, uploaded images, and local logs are regenerated on each machine.
