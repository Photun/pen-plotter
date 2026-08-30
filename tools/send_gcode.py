#!/usr/bin/env python3
"""Stream plotter G-code to the Arduino and wait for ok/error after each line."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    print(
        "Missing pyserial. Install tool dependencies with:\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/python -m pip install -r tools/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)


def find_default_port() -> str | None:
    ports = list(list_ports.comports())

    for port in ports:
        text = f"{port.device} {port.description} {port.hwid}".lower()
        if "arduino" in text or "usbmodem" in text or "ttyacm" in text:
            return port.device

    for port in ports:
        if port.device.startswith(("/dev/cu.usbmodem", "/dev/ttyACM", "/dev/ttyUSB")):
            return port.device

    return None


def iter_program(path: Path):
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("("):
            continue
        yield line_number, line


def read_response(port: serial.Serial, timeout_s: float) -> bool:
    deadline = time.monotonic() + timeout_s

    while time.monotonic() < deadline:
        raw = port.readline()
        if not raw:
            continue

        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            continue

        print(f"< {text}")
        lower = text.lower()

        if lower == "ok":
            return True
        if lower.startswith("error"):
            return False

    raise TimeoutError("Timed out waiting for ok/error from firmware")


def send_line(port: serial.Serial, line: str, timeout_s: float) -> bool:
    print(f"> {line}")
    port.write((line + "\n").encode("utf-8"))
    port.flush()
    return read_response(port, timeout_s)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gcode", type=Path, help="G-code file to stream")
    parser.add_argument("--port", help="Serial port, for example /dev/cu.usbmodem141011")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--confirm-home",
        action="store_true",
        help="Prompt for manual homing, then send G28 P1 before the file",
    )
    parser.add_argument(
        "--no-reset-wait",
        action="store_true",
        help="Do not wait after opening serial port",
    )
    args = parser.parse_args()

    if not args.gcode.exists():
        print(f"G-code file not found: {args.gcode}", file=sys.stderr)
        return 2

    port_name = args.port or find_default_port()
    if not port_name:
        print("No Arduino-like serial port found. Pass --port explicitly.", file=sys.stderr)
        return 2

    with serial.Serial(port_name, args.baud, timeout=0.1, write_timeout=2) as port:
        print(f"Opened {port_name} at {args.baud} baud")

        if not args.no_reset_wait:
            time.sleep(2.0)
            port.reset_input_buffer()

        if args.confirm_home:
            input("Move toolhead to bottom-left home, enable motors, then press Enter...")
            if not send_line(port, "G28 P1", args.timeout):
                return 1

        for line_number, line in iter_program(args.gcode):
            ok = send_line(port, line, args.timeout)
            if not ok:
                print(f"Firmware returned error at {args.gcode}:{line_number}", file=sys.stderr)
                return 1

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
