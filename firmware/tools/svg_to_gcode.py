#!/usr/bin/env python3
"""Convert SVG paths into simple plotter G-code."""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

try:
    from svgpathtools import Arc, CubicBezier, Line, QuadraticBezier, svg2paths2
except ImportError:
    print(
        "Missing svgpathtools. Install tool dependencies with:\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/python -m pip install -r tools/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)


DEFAULT_X_MAX = 406.0
DEFAULT_Y_MAX = 370.0


def parse_length(value: str | None) -> float | None:
    if not value:
        return None
    match = re.match(r"\s*([-+]?\d*\.?\d+)", value)
    if not match:
        return None
    return float(match.group(1))


def svg_height(attributes: dict[str, str], fallback: float | None) -> float:
    height = parse_length(attributes.get("height"))
    if height is not None:
        return height

    view_box = attributes.get("viewBox")
    if view_box:
        parts = [float(part) for part in re.split(r"[\s,]+", view_box.strip()) if part]
        if len(parts) == 4:
            return parts[3]

    if fallback is not None:
        return fallback

    raise ValueError("Could not determine SVG height. Pass --svg-height.")


def machine_point(point: complex, height: float, scale: float, offset_x: float, offset_y: float):
    x = point.real * scale + offset_x
    y = (height - point.imag) * scale + offset_y
    return x, y


def sample_segment(segment, sample_mm: float, scale: float):
    if isinstance(segment, Line):
        yield segment.end
        return

    length = max(segment.length(error=1e-4) * scale, 0.0)
    steps = max(1, int(math.ceil(length / sample_mm)))

    for index in range(1, steps + 1):
        yield segment.point(index / steps)


def format_xy(command: str, x: float, y: float, feed: float | None = None) -> str:
    line = f"{command} X{x:.3f} Y{y:.3f}"
    if feed is not None:
        line += f" F{feed:.1f}"
    return line


def format_cubic(control1, control2, end, feed: float | None = None) -> str:
    line = (
        f"G5 X{end[0]:.3f} Y{end[1]:.3f} "
        f"I{control1[0]:.3f} J{control1[1]:.3f} "
        f"P{control2[0]:.3f} Q{control2[1]:.3f}"
    )
    if feed is not None:
        line += f" F{feed:.1f}"
    return line


def cubic_segments(segment):
    if isinstance(segment, CubicBezier):
        return [segment]

    if isinstance(segment, QuadraticBezier):
        control1 = segment.start + (segment.control - segment.start) * (2.0 / 3.0)
        control2 = segment.end + (segment.control - segment.end) * (2.0 / 3.0)
        return [CubicBezier(segment.start, control1, control2, segment.end)]

    if isinstance(segment, Arc):
        return list(segment.as_cubic_curves())

    return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg", type=Path)
    parser.add_argument("gcode", type=Path)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--offset-x", type=float, default=0.0)
    parser.add_argument("--offset-y", type=float, default=0.0)
    parser.add_argument("--feed", type=float, default=300.0)
    parser.add_argument("--travel-feed", type=float, default=600.0)
    parser.add_argument("--accel", type=float, default=10000.0)
    parser.add_argument("--sample-mm", type=float, default=1.0)
    parser.add_argument("--x-max", type=float, default=DEFAULT_X_MAX)
    parser.add_argument("--y-max", type=float, default=DEFAULT_Y_MAX)
    parser.add_argument("--svg-height", type=float)
    parser.add_argument("--no-bounds-check", action="store_true")
    args = parser.parse_args()

    paths, _attrs, svg_attrs = svg2paths2(str(args.svg))
    height = svg_height(svg_attrs, args.svg_height)

    output: list[str] = [
        f"; Generated from {args.svg.name} by tools/svg_to_gcode.py",
        "; Manually home the toolhead before sending this file.",
        "G21",
        "G90",
        "M17",
        f"M204 S{args.accel:.1f}",
        "M5",
    ]

    plotted_points: list[tuple[float, float]] = []

    for path in paths:
        for subpath in path.continuous_subpaths():
            if not subpath:
                continue

            start_x, start_y = machine_point(
                subpath[0].start, height, args.scale, args.offset_x, args.offset_y
            )
            output.append(format_xy("G0", start_x, start_y, args.travel_feed))
            output.append("M3")
            plotted_points.append((start_x, start_y))

            for segment in subpath:
                if isinstance(segment, Line):
                    x, y = machine_point(segment.end, height, args.scale, args.offset_x, args.offset_y)
                    output.append(format_xy("G1", x, y, args.feed))
                    plotted_points.append((x, y))
                    continue

                cubics = cubic_segments(segment)
                if cubics:
                    for cubic in cubics:
                        control1 = machine_point(cubic.control1, height, args.scale, args.offset_x, args.offset_y)
                        control2 = machine_point(cubic.control2, height, args.scale, args.offset_x, args.offset_y)
                        end = machine_point(cubic.end, height, args.scale, args.offset_x, args.offset_y)
                        output.append(format_cubic(control1, control2, end, args.feed))

                        for point in sample_segment(cubic, args.sample_mm, args.scale):
                            x, y = machine_point(point, height, args.scale, args.offset_x, args.offset_y)
                            plotted_points.append((x, y))
                    continue

                for point in sample_segment(segment, args.sample_mm, args.scale):
                    x, y = machine_point(point, height, args.scale, args.offset_x, args.offset_y)
                    output.append(format_xy("G1", x, y, args.feed))
                    plotted_points.append((x, y))

            output.append("M5")

    output.extend(["M2", ""])

    if not args.no_bounds_check:
        for x, y in plotted_points:
            if x < 0 or x > args.x_max or y < 0 or y > args.y_max:
                print(
                    f"Point outside machine bounds: X{x:.3f} Y{y:.3f} "
                    f"(limits X0..{args.x_max}, Y0..{args.y_max})",
                    file=sys.stderr,
                )
                return 1

    args.gcode.parent.mkdir(parents=True, exist_ok=True)
    args.gcode.write_text("\n".join(output), encoding="utf-8")
    print(f"Wrote {args.gcode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
