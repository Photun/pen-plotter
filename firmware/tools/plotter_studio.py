#!/usr/bin/env python3
"""Local browser app for slicing and controlling the CoreXY pen plotter."""

from __future__ import annotations

import math
import base64
import html
import io
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageFilter, ImageOps
    import cv2
    import numpy as np
    from scipy import ndimage
    import serial
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from pydantic import BaseModel, Field
    from serial.tools import list_ports
    from svgpathtools import Arc, CubicBezier, Line, QuadraticBezier, svg2paths2
except ImportError:
    print(
        "Missing app dependencies. Run:\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/python -m pip install -r tools/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "app" / "static"
DATA_DIR = ROOT / ".plotter-app"
UPLOAD_DIR = DATA_DIR / "uploads"

BAUD = 115200
X_MAX = 406.0
Y_MAX = 370.0
STEPS_PER_MM = 160.0
LETTER_PAPER_WIDTH = 140.0
LETTER_PAPER_HEIGHT = round(LETTER_PAPER_WIDTH * 8.5 / 11.0, 3)
RASTER_TRACE_MAX_SIDE = 3200
trace_lock = threading.Lock()
trace_generation = 0
trace_jobs: dict[str, dict[str, Any]] = {}


class TraceCanceled(Exception):
    pass


class SliceSettings(BaseModel):
    x_max: float = Field(default=X_MAX, gt=0)
    y_max: float = Field(default=Y_MAX, gt=0)
    paper_mode: str = "full"
    margin: float = Field(default=12.0, ge=0)
    fit_to_bed: bool = True
    scale: float = Field(default=1.0, gt=0)
    scale_x: float | None = Field(default=None, gt=0)
    scale_y: float | None = Field(default=None, gt=0)
    offset_x: float = 0.0
    offset_y: float = 0.0
    rotation: float = 0.0
    speed_delay: int = Field(default=50, ge=1, le=200)
    accel: float = Field(default=10000.0, ge=8000, le=100000)
    pen_up_delay: int = Field(default=200, ge=0, le=2000)
    pen_down_delay: int = Field(default=600, ge=0, le=2000)
    pen_up_lift_percent: int = Field(default=100, ge=0, le=100)
    sample_mm: float = Field(default=1.0, gt=0)


class SliceRequest(BaseModel):
    filename: str = "drawing.svg"
    svg_text: str
    settings: SliceSettings = SliceSettings()


class ConnectRequest(BaseModel):
    port: str | None = None
    baud: int = BAUD


class ManualCommandRequest(BaseModel):
    command: str


class JogRequest(BaseModel):
    dx: float = 0.0
    dy: float = 0.0


class StartJobRequest(BaseModel):
    gcode: str
    confirm_home: bool = False
    name: str = "plate.gcode"


class SettingsRequest(BaseModel):
    speed_delay: int | None = Field(default=None, ge=1, le=200)
    accel: float | None = Field(default=None, ge=8000, le=100000)
    pen_up_delay: int | None = Field(default=None, ge=0, le=2000)
    pen_down_delay: int | None = Field(default=None, ge=0, le=2000)
    pen_up_lift_percent: int | None = Field(default=None, ge=0, le=100)


class RasterTraceRequest(BaseModel):
    filename: str = "image.png"
    image_data: str
    trace_mode: str = "contour"
    threshold: int = Field(default=34, ge=1, le=255)
    simplify_px: float = Field(default=1.5, ge=0, le=32)
    max_side: int = Field(default=720, ge=64, le=RASTER_TRACE_MAX_SIDE)
    min_path_px: float = Field(default=8.0, ge=0, le=200)
    link_gap_px: float = Field(default=5.0, ge=0, le=80)


def safe_name(name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(name).name)
    return clean or "drawing.svg"


def paper_area_for_settings(settings: SliceSettings) -> dict[str, Any]:
    mode = settings.paper_mode.strip().lower()
    if mode == "letter":
        width = min(LETTER_PAPER_WIDTH, settings.x_max)
        height = min(LETTER_PAPER_HEIGHT, settings.y_max)
        x_min = (settings.x_max - width) / 2.0
        y_min = (settings.y_max - height) / 2.0
        label = "Letter"
    else:
        mode = "full"
        width = settings.x_max
        height = settings.y_max
        x_min = 0.0
        y_min = 0.0
        label = "Full canvas"

    return {
        "mode": mode,
        "label": label,
        "x_min": round(x_min, 3),
        "x_max": round(x_min + width, 3),
        "y_min": round(y_min, 3),
        "y_max": round(y_min + height, 3),
        "width": round(width, 3),
        "height": round(height, 3),
        "center_x": round(x_min + width / 2.0, 3),
        "center_y": round(y_min + height / 2.0, 3),
    }


def next_trace_token() -> int:
    global trace_generation
    with trace_lock:
        trace_generation += 1
        return trace_generation


def check_trace_deadline(deadline: float | int) -> None:
    if isinstance(deadline, int):
        with trace_lock:
            if deadline != trace_generation:
                raise TraceCanceled("Trace canceled.")


def start_trace_job(request: RasterTraceRequest) -> dict[str, str]:
    job_id = uuid.uuid4().hex
    token = next_trace_token()
    with trace_lock:
        trace_jobs[job_id] = {
            "status": "running",
            "progress": 2,
            "label": "Queued",
            "created_at": time.monotonic(),
            "token": token,
        }

    thread = threading.Thread(target=run_trace_job, args=(job_id, token, request), daemon=True)
    thread.start()
    return {"job_id": job_id}


def trace_job_progress(job_id: str, progress: float, label: str) -> None:
    with trace_lock:
        job = trace_jobs.get(job_id)
        if not job or job.get("status") != "running":
            return
        job["progress"] = max(job.get("progress", 0), min(96, progress))
        job["label"] = label


def run_trace_job(job_id: str, token: int, request: RasterTraceRequest) -> None:
    try:
        trace_job_progress(job_id, 8, "Loading image")
        svg_text = raster_to_svg(
            request.filename,
            request.image_data,
            trace_mode=request.trace_mode,
            threshold=request.threshold,
            simplify_px=request.simplify_px,
            max_side=request.max_side,
            min_path_px=request.min_path_px,
            link_gap_px=request.link_gap_px,
            trace_token=token,
            progress=lambda pct, label: trace_job_progress(job_id, pct, label),
        )
        path_count = svg_text.count("<path ")
        with trace_lock:
            job = trace_jobs.get(job_id)
            if not job or job.get("token") != token or token != trace_generation:
                return
            job.update(
                {
                    "status": "done",
                    "progress": 100,
                    "label": "Trace ready",
                    "svg_text": svg_text,
                    "filename": f"{Path(safe_name(request.filename)).stem}_trace.svg",
                    "path_count": path_count,
                }
            )
    except TraceCanceled:
        with trace_lock:
            job = trace_jobs.get(job_id)
            if job:
                job.update({"status": "canceled", "progress": 0, "label": "Trace canceled"})
    except Exception as exc:
        with trace_lock:
            job = trace_jobs.get(job_id)
            if job:
                job.update({"status": "error", "progress": 0, "label": "Trace failed", "error": str(exc)})


def parse_length(value: str | None) -> float | None:
    if not value:
        return None
    match = re.match(r"\s*([-+]?\d*\.?\d+)", value)
    if not match:
        return None
    return float(match.group(1))


def svg_height(attributes: dict[str, str], fallback: float | None = None) -> float:
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

    raise ValueError("Could not determine SVG height.")


def source_bounds(paths: list[Any]) -> tuple[float, float, float, float]:
    bounds: tuple[float, float, float, float] | None = None

    for path in paths:
        if len(path) == 0:
            continue
        xmin, xmax, ymin, ymax = path.bbox()
        if bounds is None:
            bounds = (xmin, xmax, ymin, ymax)
        else:
            bxmin, bxmax, bymin, bymax = bounds
            bounds = (min(bxmin, xmin), max(bxmax, xmax), min(bymin, ymin), max(bymax, ymax))

    if bounds is None:
        raise ValueError("SVG has no drawable paths.")

    return bounds


def feed_from_delay(delay_micros: int) -> float:
    return 60000000.0 / (max(delay_micros, 1) * STEPS_PER_MM * 2.0)


def upload_text_to_svg(filename: str, content: str) -> str:
    if filename.lower().endswith(".svg") or content.lstrip().startswith("<svg"):
        return content

    return raster_to_svg(filename, content)


EDGE_NEIGHBORS = (
    (-1, -1), (0, -1), (1, -1),
    (-1, 0),           (1, 0),
    (-1, 1),  (0, 1),  (1, 1),
)


def clear_image_border(image: Image.Image, border: int = 2) -> None:
    pixels = image.load()
    width, height = image.size
    border = max(1, min(border, width // 2, height // 2))

    for y in range(height):
        for x in range(border):
            pixels[x, y] = 0
            pixels[width - 1 - x, y] = 0

    for x in range(width):
        for y in range(border):
            pixels[x, y] = 0
            pixels[x, height - 1 - y] = 0


def edge_strength_image(image: Image.Image) -> Image.Image:
    values = np.asarray(image, dtype=np.float32)
    values = ndimage.gaussian_filter(values, sigma=0.65)
    grad_x = ndimage.sobel(values, axis=1)
    grad_y = ndimage.sobel(values, axis=0)
    magnitude = np.hypot(grad_x, grad_y)
    high = float(np.percentile(magnitude, 99.2)) or 1.0
    magnitude = np.clip(magnitude / high, 0.0, 1.0)
    return Image.fromarray((magnitude * 255.0).astype(np.uint8), mode="L")


def binary_edges_from_image(edges: Image.Image, threshold: int) -> np.ndarray:
    values = np.asarray(edges, dtype=np.uint8)
    binary = values >= threshold
    binary = ndimage.binary_closing(binary, structure=np.ones((2, 2), dtype=bool))
    if binary.shape[0] > 4 and binary.shape[1] > 4:
        binary[:2, :] = False
        binary[-2:, :] = False
        binary[:, :2] = False
        binary[:, -2:] = False
    return binary


def shifted_mask(mask: np.ndarray, dy: int, dx: int) -> np.ndarray:
    height, width = mask.shape
    shifted = np.zeros_like(mask, dtype=bool)

    src_y0 = max(0, dy)
    src_y1 = height + min(0, dy)
    dst_y0 = max(0, -dy)
    dst_y1 = height - max(0, dy)
    src_x0 = max(0, dx)
    src_x1 = width + min(0, dx)
    dst_x0 = max(0, -dx)
    dst_x1 = width - max(0, dx)

    if src_y0 < src_y1 and src_x0 < src_x1:
        shifted[dst_y0:dst_y1, dst_x0:dst_x1] = mask[src_y0:src_y1, src_x0:src_x1]

    return shifted


def thin_edge_array(binary: np.ndarray, deadline: float, max_iterations: int = 80) -> np.ndarray:
    skeleton = binary.astype(bool).copy()
    if skeleton.shape[0] < 3 or skeleton.shape[1] < 3:
        return skeleton

    for _ in range(max_iterations):
        check_trace_deadline(deadline)
        changed = False
        for step in range(2):
            p2 = shifted_mask(skeleton, -1, 0)
            p3 = shifted_mask(skeleton, -1, 1)
            p4 = shifted_mask(skeleton, 0, 1)
            p5 = shifted_mask(skeleton, 1, 1)
            p6 = shifted_mask(skeleton, 1, 0)
            p7 = shifted_mask(skeleton, 1, -1)
            p8 = shifted_mask(skeleton, 0, -1)
            p9 = shifted_mask(skeleton, -1, -1)

            neighbor_count = (
                p2.astype(np.uint8)
                + p3.astype(np.uint8)
                + p4.astype(np.uint8)
                + p5.astype(np.uint8)
                + p6.astype(np.uint8)
                + p7.astype(np.uint8)
                + p8.astype(np.uint8)
                + p9.astype(np.uint8)
            )
            transitions = (
                (~p2 & p3).astype(np.uint8)
                + (~p3 & p4).astype(np.uint8)
                + (~p4 & p5).astype(np.uint8)
                + (~p5 & p6).astype(np.uint8)
                + (~p6 & p7).astype(np.uint8)
                + (~p7 & p8).astype(np.uint8)
                + (~p8 & p9).astype(np.uint8)
                + (~p9 & p2).astype(np.uint8)
            )

            if step == 0:
                removable = (
                    skeleton
                    & (neighbor_count >= 2)
                    & (neighbor_count <= 6)
                    & (transitions == 1)
                    & ~(p2 & p4 & p6)
                    & ~(p4 & p6 & p8)
                )
            else:
                removable = (
                    skeleton
                    & (neighbor_count >= 2)
                    & (neighbor_count <= 6)
                    & (transitions == 1)
                    & ~(p2 & p4 & p8)
                    & ~(p2 & p6 & p8)
                )

            removable[0, :] = False
            removable[-1, :] = False
            removable[:, 0] = False
            removable[:, -1] = False

            if np.any(removable):
                skeleton[removable] = False
                changed = True

        if not changed:
            break

    return skeleton


def edge_pixel_set(skeleton: np.ndarray) -> set[tuple[int, int]]:
    ys, xs = np.nonzero(skeleton)
    return set(zip(xs.tolist(), ys.tolist()))


def edge_neighbors(point: tuple[int, int], edge_pixels: set[tuple[int, int]]) -> list[tuple[int, int]]:
    x, y = point
    return [
        (x + dx, y + dy)
        for dx, dy in EDGE_NEIGHBORS
        if (x + dx, y + dy) in edge_pixels
    ]


def edge_degree(point: tuple[int, int], edge_pixels: set[tuple[int, int]]) -> int:
    return len(edge_neighbors(point, edge_pixels))


def neighbor_score(
    previous: tuple[int, int] | None,
    current: tuple[int, int],
    candidate: tuple[int, int],
    edge_pixels: set[tuple[int, int]],
) -> float:
    score = 0.0
    if previous is not None:
        vx = current[0] - previous[0]
        vy = current[1] - previous[1]
        wx = candidate[0] - current[0]
        wy = candidate[1] - current[1]
        v_len = math.hypot(vx, vy) or 1.0
        w_len = math.hypot(wx, wy) or 1.0
        score += ((vx * wx + vy * wy) / (v_len * w_len)) * 10.0
    score -= abs(edge_degree(candidate, edge_pixels) - 2) * 0.25
    score -= math.hypot(candidate[0] - current[0], candidate[1] - current[1]) * 0.05
    return score


def trace_one_edge_path(
    start: tuple[int, int],
    edge_pixels: set[tuple[int, int]],
    used: set[tuple[int, int]],
    deadline: float,
) -> list[tuple[float, float]]:
    path: list[tuple[int, int]] = [start]
    used.add(start)
    previous: tuple[int, int] | None = None
    current = start

    while True:
        if len(path) % 256 == 0:
            check_trace_deadline(deadline)
        candidates = [point for point in edge_neighbors(current, edge_pixels) if point not in used]
        if not candidates:
            if len(path) > 8 and start in edge_neighbors(current, edge_pixels):
                path.append(start)
            break

        next_point = max(
            candidates,
            key=lambda point: neighbor_score(previous, current, point, edge_pixels),
        )
        path.append(next_point)
        used.add(next_point)
        previous = current
        current = next_point

    return [(float(x), float(y)) for x, y in path]


def edge_pair(first: tuple[int, int], second: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    return (first, second) if first <= second else (second, first)


def trace_graph_path(
    start: tuple[int, int],
    first_next: tuple[int, int],
    edge_pixels: set[tuple[int, int]],
    degrees: dict[tuple[int, int], int],
    used_edges: set[tuple[tuple[int, int], tuple[int, int]]],
) -> list[tuple[float, float]]:
    path = [start]
    previous = start
    current = first_next
    used_edges.add(edge_pair(start, first_next))

    while True:
        path.append(current)
        if current == start:
            break
        if degrees.get(current, 0) != 2 and current != first_next:
            break

        candidates = [
            point
            for point in edge_neighbors(current, edge_pixels)
            if point != previous and edge_pair(current, point) not in used_edges
        ]
        if not candidates:
            break

        next_point = max(
            candidates,
            key=lambda point: neighbor_score(previous, current, point, edge_pixels),
        )
        used_edges.add(edge_pair(current, next_point))
        previous, current = current, next_point

    return [(float(x), float(y)) for x, y in path]


def trace_skeleton_paths(edge_pixels: set[tuple[int, int]]) -> list[list[tuple[float, float]]]:
    if not edge_pixels:
        return []

    degrees = {point: edge_degree(point, edge_pixels) for point in edge_pixels}
    nodes = sorted(
        [point for point, degree in degrees.items() if degree != 2],
        key=lambda point: (point[1], point[0]),
    )
    used_edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    paths: list[list[tuple[float, float]]] = []

    for node in nodes:
        neighbors = sorted(edge_neighbors(node, edge_pixels), key=lambda point: (point[1], point[0]))
        for neighbor in neighbors:
            if edge_pair(node, neighbor) in used_edges:
                continue
            path = trace_graph_path(node, neighbor, edge_pixels, degrees, used_edges)
            if len(path) >= 2:
                paths.append(path)

    for point in sorted(edge_pixels, key=lambda item: (item[1], item[0])):
        for neighbor in sorted(edge_neighbors(point, edge_pixels), key=lambda item: (item[1], item[0])):
            if edge_pair(point, neighbor) in used_edges:
                continue
            path = trace_graph_path(point, neighbor, edge_pixels, degrees, used_edges)
            if len(path) >= 2:
                paths.append(path)

    return paths


def path_length(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for index in range(1, len(points)):
        total += math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1])
    return total


def perpendicular_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    sx, sy = start
    ex, ey = end
    px, py = point
    span = math.hypot(ex - sx, ey - sy)
    if span <= 0:
        return math.hypot(px - sx, py - sy)
    return abs((ey - sy) * px - (ex - sx) * py + ex * sy - ey * sx) / span


def simplify_polyline(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2 or tolerance <= 0:
        return points

    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(points) - 1)]

    while stack:
        start_index, end_index = stack.pop()
        best_index = 0
        best_distance = 0.0

        for index in range(start_index + 1, end_index):
            dist = perpendicular_distance(points[index], points[start_index], points[end_index])
            if dist > best_distance:
                best_distance = dist
                best_index = index

        if best_distance > tolerance:
            keep[best_index] = True
            stack.append((start_index, best_index))
            stack.append((best_index, end_index))

    return [point for point, should_keep in zip(points, keep) if should_keep]


def polyline_is_closed(points: list[tuple[float, float]], tolerance: float = 1.5) -> bool:
    return len(points) > 3 and math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1]) <= tolerance


def simplify_closed_polyline(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if not polyline_is_closed(points) or len(points) <= 4:
        return simplify_polyline(points, tolerance)

    body = points[:-1]
    pivot = max(
        range(len(body)),
        key=lambda index: math.hypot(body[index][0] - body[0][0], body[index][1] - body[0][1]),
    )
    rotated = body[pivot:] + body[:pivot] + [body[pivot]]
    simplified = simplify_polyline(rotated, tolerance)
    if simplified and simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def smooth_polyline(points: list[tuple[float, float]], passes: int = 2) -> list[tuple[float, float]]:
    if len(points) <= 3 or passes <= 0:
        return points

    closed = polyline_is_closed(points)
    working = points[:-1] if closed else points[:]

    for _ in range(passes):
        if len(working) <= 2:
            break

        if closed:
            smoothed = []
            count = len(working)
            for index, current in enumerate(working):
                prev_point = working[(index - 1) % count]
                next_point = working[(index + 1) % count]
                smoothed.append((
                    (prev_point[0] + 2.0 * current[0] + next_point[0]) / 4.0,
                    (prev_point[1] + 2.0 * current[1] + next_point[1]) / 4.0,
                ))
        else:
            smoothed = [working[0]]
            for index in range(1, len(working) - 1):
                prev_point = working[index - 1]
                current = working[index]
                next_point = working[index + 1]
                smoothed.append((
                    (prev_point[0] + 2.0 * current[0] + next_point[0]) / 4.0,
                    (prev_point[1] + 2.0 * current[1] + next_point[1]) / 4.0,
                ))
            smoothed.append(working[-1])

        working = smoothed

    if closed and working:
        working.append(working[0])
    return working


def optimize_polylines(paths: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    remaining = paths[:]
    ordered: list[list[tuple[float, float]]] = []
    current = (0.0, 0.0)

    while remaining:
        best_index = 0
        best_reverse = False
        best_distance = float("inf")

        for index, path in enumerate(remaining):
            start_distance = math.hypot(path[0][0] - current[0], path[0][1] - current[1])
            end_distance = math.hypot(path[-1][0] - current[0], path[-1][1] - current[1])
            if start_distance < best_distance:
                best_index = index
                best_reverse = False
                best_distance = start_distance
            if end_distance < best_distance and not polyline_is_closed(path):
                best_index = index
                best_reverse = True
                best_distance = end_distance

        chosen = remaining.pop(best_index)
        if best_reverse:
            chosen = list(reversed(chosen))
        ordered.append(chosen)
        current = chosen[-1]

    return ordered


def endpoint_direction(path: list[tuple[float, float]], at_end: bool) -> tuple[float, float]:
    if len(path) < 2:
        return (0.0, 0.0)

    if at_end:
        ax, ay = path[-2]
        bx, by = path[-1]
    else:
        ax, ay = path[1]
        bx, by = path[0]

    length = math.hypot(bx - ax, by - ay)
    if length <= 0:
        return (0.0, 0.0)
    return ((bx - ax) / length, (by - ay) / length)


def merge_candidate(
    first: list[tuple[float, float]],
    second: list[tuple[float, float]],
    max_gap: float,
) -> tuple[float, list[tuple[float, float]]] | None:
    best: tuple[float, list[tuple[float, float]]] | None = None

    for reverse_first in (False, True):
        first_oriented = list(reversed(first)) if reverse_first else first
        first_dir = endpoint_direction(first_oriented, True)

        for reverse_second in (False, True):
            second_oriented = list(reversed(second)) if reverse_second else second
            gap = math.hypot(
                first_oriented[-1][0] - second_oriented[0][0],
                first_oriented[-1][1] - second_oriented[0][1],
            )
            if gap > max_gap:
                continue

            second_dir = endpoint_direction(second_oriented, False)
            alignment = first_dir[0] * second_dir[0] + first_dir[1] * second_dir[1]
            if gap > 1.25 and alignment < -0.15:
                continue

            score = gap - alignment * max_gap * 0.2
            merged = first_oriented + second_oriented[1:]
            if best is None or score < best[0]:
                best = (score, merged)

    return best


def close_near_open_paths(
    paths: list[list[tuple[float, float]]],
    max_gap: float,
) -> list[list[tuple[float, float]]]:
    closed_paths: list[list[tuple[float, float]]] = []
    for path in paths:
        if len(path) > 3 and not polyline_is_closed(path) and math.hypot(
            path[0][0] - path[-1][0],
            path[0][1] - path[-1][1],
        ) <= max_gap:
            closed_paths.append(path + [path[0]])
        else:
            closed_paths.append(path)
    return closed_paths


def merge_nearby_polylines(
    paths: list[list[tuple[float, float]]],
    max_gap: float,
    deadline: float,
) -> list[list[tuple[float, float]]]:
    if len(paths) <= 1:
        return close_near_open_paths(paths, max_gap)

    remaining = paths[:]
    ordered: list[list[tuple[float, float]]] = []
    active: list[tuple[float, float]] | None = None
    current = (0.0, 0.0)

    while remaining:
        check_trace_deadline(deadline)
        best_index = 0
        best_reverse = False
        best_distance = float("inf")

        for index, path in enumerate(remaining):
            start_distance = math.hypot(path[0][0] - current[0], path[0][1] - current[1])
            end_distance = math.hypot(path[-1][0] - current[0], path[-1][1] - current[1])

            if start_distance < best_distance:
                best_index = index
                best_reverse = False
                best_distance = start_distance

            if end_distance < best_distance and not polyline_is_closed(path):
                best_index = index
                best_reverse = True
                best_distance = end_distance

        chosen = remaining.pop(best_index)
        if best_reverse:
            chosen = list(reversed(chosen))

        can_link = False
        if active is not None and max_gap > 0 and not polyline_is_closed(active) and not polyline_is_closed(chosen):
            gap = math.hypot(active[-1][0] - chosen[0][0], active[-1][1] - chosen[0][1])
            active_dir = endpoint_direction(active, True)
            chosen_dir = endpoint_direction(chosen, False)
            alignment = active_dir[0] * chosen_dir[0] + active_dir[1] * chosen_dir[1]
            if gap <= max_gap and (gap <= 1.25 or alignment >= -0.15):
                active = active + chosen[1:]
                can_link = True

        if not can_link:
            if active is not None:
                ordered.append(active)
            active = chosen

        current = active[-1]

    if active is not None:
        ordered.append(active)

    return close_near_open_paths(ordered, max_gap)


def trace_edge_paths(
    edges: Image.Image,
    threshold: int,
    simplify_px: float,
    min_path_px: float,
    link_gap_px: float,
    deadline: float,
) -> list[list[tuple[float, float]]]:
    binary = binary_edges_from_image(edges, threshold)

    skeleton = thin_edge_array(binary, deadline)
    edge_pixels = edge_pixel_set(skeleton)
    if not edge_pixels:
        return []

    paths: list[list[tuple[float, float]]] = []
    smoothing_passes = 1 if simplify_px < 0.75 else 2

    used: set[tuple[int, int]] = set()
    endpoints = [point for point in edge_pixels if edge_degree(point, edge_pixels) <= 1]
    starts = sorted(endpoints, key=lambda point: (point[1], point[0]))
    starts.extend(sorted(edge_pixels - set(starts), key=lambda point: (point[1], point[0])))

    for start in starts:
        check_trace_deadline(deadline)
        if start in used:
            continue
        path = trace_one_edge_path(start, edge_pixels, used, deadline)
        if len(path) < 2 or path_length(path) < min_path_px:
            continue
        smoothed = smooth_polyline(path, smoothing_passes)
        simplified = simplify_closed_polyline(smoothed, simplify_px)
        if len(simplified) >= 2 and path_length(simplified) >= min_path_px:
            paths.append(simplified)

    paths = merge_nearby_polylines(paths, link_gap_px, deadline)
    paths = [
        simplify_closed_polyline(smooth_polyline(path, 1), simplify_px)
        for path in paths
        if len(path) >= 2 and path_length(path) >= min_path_px
    ]
    paths = [path for path in paths if len(path) >= 2 and path_length(path) >= min_path_px]
    paths.sort(key=path_length, reverse=True)
    return paths


def odd_kernel_size(value: int, minimum: int = 3) -> int:
    value = max(minimum, int(value))
    return value if value % 2 else value + 1


def cv_gray_for_trace(image: Image.Image, max_side: int) -> np.ndarray:
    image = ImageOps.exif_transpose(image).convert("L")
    image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    gray = np.asarray(image, dtype=np.uint8)
    if gray.size == 0:
        raise ValueError("Could not read that image file.")

    long_side = max(gray.shape)
    background_kernel = odd_kernel_size(min(181, max(31, long_side // 7)))
    background = cv2.medianBlur(gray, background_kernel)
    normalized = cv2.divide(gray, background, scale=255)
    normalized = cv2.normalize(normalized, None, 0, 255, cv2.NORM_MINMAX)

    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    equalized = clahe.apply(normalized)
    return cv2.bilateralFilter(equalized, 7, 36, 36)


def contour_to_polyline(contour: np.ndarray, simplify_px: float) -> list[tuple[float, float]]:
    points = [(float(point[0][0]), float(point[0][1])) for point in contour]
    if len(points) < 2:
        return []

    if len(points) > 3:
        first = points[0]
        last = points[-1]
        if math.hypot(first[0] - last[0], first[1] - last[1]) <= 1.75:
            points.append(first)

    smoothing_passes = 1 if simplify_px < 0.65 else 2
    smoothed = smooth_polyline(points, smoothing_passes)
    return simplify_closed_polyline(smoothed, simplify_px)


def contour_is_border_artifact(contour: np.ndarray, width: int, height: int) -> bool:
    x, y, w, h = cv2.boundingRect(contour)
    near_left_frame = x <= width * 0.2 and h >= height * 0.4 and w <= width * 0.035
    if near_left_frame:
        return True

    border = max(3, int(min(width, height) * 0.012))
    touches_edge = x <= border or y <= border or x + w >= width - border or y + h >= height - border
    if not touches_edge:
        return False

    long_vertical = h >= height * 0.28 and w <= width * 0.08
    long_horizontal = w >= width * 0.28 and h <= height * 0.08
    huge_edge_shape = w * h >= width * height * 0.2
    return long_vertical or long_horizontal or huge_edge_shape


def cv_contour_trace_paths(
    image: Image.Image,
    threshold: int,
    simplify_px: float,
    max_side: int,
    min_path_px: float,
    link_gap_px: float,
    deadline: float,
) -> tuple[list[list[tuple[float, float]]], int, int]:
    gray = cv_gray_for_trace(image, max_side)
    check_trace_deadline(deadline)

    lower = max(1, min(254, int(threshold)))
    upper = max(lower + 1, min(255, int(lower * 2.6 + 28)))
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, lower, upper, apertureSize=3, L2gradient=True)

    edges[:2, :] = 0
    edges[-2:, :] = 0
    edges[:, :2] = 0
    edges[:, -2:] = 0
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    width = int(gray.shape[1])
    height = int(gray.shape[0])

    paths: list[list[tuple[float, float]]] = []
    contour_limit = 6000
    for index, contour in enumerate(sorted(contours, key=lambda item: cv2.arcLength(item, False), reverse=True)):
        if index % 100 == 0:
            check_trace_deadline(deadline)
        if index >= contour_limit:
            break
        if len(contour) < 3:
            continue
        if cv2.arcLength(contour, False) < min_path_px:
            continue
        if contour_is_border_artifact(contour, width, height):
            continue

        path = contour_to_polyline(contour, simplify_px)
        if len(path) >= 2 and path_length(path) >= min_path_px:
            paths.append(path)

    paths = merge_nearby_polylines(paths, link_gap_px, deadline)
    paths = [
        simplify_closed_polyline(smooth_polyline(path, 1), simplify_px)
        for path in paths
        if len(path) >= 2 and path_length(path) >= min_path_px
    ]
    paths = [path for path in paths if len(path) >= 2 and path_length(path) >= min_path_px]
    paths = [path for path in paths if not path_is_border_artifact(path, width, height)]
    paths.sort(key=path_length, reverse=True)
    return paths[:3200], int(gray.shape[1]), int(gray.shape[0])


def cv_ink_trace_paths(
    image: Image.Image,
    threshold: int,
    simplify_px: float,
    max_side: int,
    min_path_px: float,
    link_gap_px: float,
    deadline: float,
) -> tuple[list[list[tuple[float, float]]], int, int]:
    gray = cv_gray_for_trace(image, max_side)
    width = int(gray.shape[1])
    height = int(gray.shape[0])
    check_trace_deadline(deadline)

    ink = cv2.subtract(255, gray)
    ink = cv2.normalize(ink, None, 0, 255, cv2.NORM_MINMAX)
    _, mask = cv2.threshold(ink, max(1, int(threshold)), 255, cv2.THRESH_BINARY)

    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    clean = np.zeros_like(mask)
    min_component_area = max(3, int(min_path_px * 0.35))
    for component_index in range(1, component_count):
        if component_index % 100 == 0:
            check_trace_deadline(deadline)
        x, y, w, h, area = stats[component_index]
        if area < min_component_area:
            continue
        touches_edge = x <= 2 or y <= 2 or x + w >= width - 2 or y + h >= height - 2
        if touches_edge and (h >= height * 0.18 or w >= width * 0.18):
            continue
        clean[labels == component_index] = 255

    edge_image = Image.fromarray(clean, "L")
    paths = trace_edge_paths(edge_image, 1, simplify_px, min_path_px, link_gap_px, deadline)
    return [path for path in paths if not path_is_border_artifact(path, width, height)], width, height


def path_bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def path_is_border_artifact(path: list[tuple[float, float]], width: int, height: int) -> bool:
    min_x, min_y, max_x, max_y = path_bounds(path)
    path_width = max_x - min_x
    path_height = max_y - min_y
    near_left_skinny = min_x <= width * 0.2 and path_height >= height * 0.12 and path_width <= width * 0.055
    edge_skinny = (
        (min_x <= 3 or min_y <= 3 or max_x >= width - 3 or max_y >= height - 3)
        and (path_height >= height * 0.08 or path_width >= width * 0.08)
    )
    return near_left_skinny or edge_skinny


def svg_path_from_polyline(points: list[tuple[float, float]]) -> str:
    commands = [f"M {points[0][0]:.2f} {points[0][1]:.2f}"]
    if len(points) < 4 or path_length(points) < 10:
        for x, y in points[1:]:
            commands.append(f"L {x:.2f} {y:.2f}")
        return " ".join(commands)

    closed = polyline_is_closed(points)
    tension = 0.72

    if closed:
        body = points[:-1]
        count = len(body)
        for index in range(count):
            p0 = body[(index - 1) % count]
            p1 = body[index]
            p2 = body[(index + 1) % count]
            p3 = body[(index + 2) % count]
            c1 = (p1[0] + (p2[0] - p0[0]) * tension / 6.0, p1[1] + (p2[1] - p0[1]) * tension / 6.0)
            c2 = (p2[0] - (p3[0] - p1[0]) * tension / 6.0, p2[1] - (p3[1] - p1[1]) * tension / 6.0)
            commands.append(f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
        return " ".join(commands)

    for index in range(len(points) - 1):
        p0 = points[index - 1] if index > 0 else points[index]
        p1 = points[index]
        p2 = points[index + 1]
        p3 = points[index + 2] if index + 2 < len(points) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 6.0, p1[1] + (p2[1] - p0[1]) * tension / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 6.0, p2[1] - (p3[1] - p1[1]) * tension / 6.0)
        commands.append(f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    return " ".join(commands)


def raster_to_svg(
    filename: str,
    content: str,
    trace_mode: str = "contour",
    threshold: int = 34,
    simplify_px: float = 1.5,
    max_side: int = 720,
    min_path_px: float = 8.0,
    link_gap_px: float = 5.0,
    trace_token: int | None = None,
    progress=None,
) -> str:
    deadline = trace_token if trace_token is not None else next_trace_token()
    if "," in content and content[:80].lower().startswith("data:"):
        content = content.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(content, validate=True)
    except Exception as exc:
        raise ValueError("Unsupported file. Upload an SVG, PNG, JPG, GIF, BMP, or WebP image.") from exc

    try:
        if progress:
            progress(10, "Reading image")
        image = Image.open(io.BytesIO(image_bytes))
    except Exception as exc:
        raise ValueError("Could not read that image file.") from exc

    threshold = max(1, min(255, int(threshold)))
    simplify_px = max(0.0, min(32.0, float(simplify_px)))
    max_side = max(64, min(RASTER_TRACE_MAX_SIDE, int(max_side)))
    min_path_px = max(0.0, min(200.0, float(min_path_px)))
    link_gap_px = max(0.0, min(80.0, float(link_gap_px)))
    trace_mode = trace_mode if trace_mode in {"contour", "ink", "legacy"} else "contour"

    if trace_mode == "ink":
        if progress:
            progress(24, "Tracing ink")
        paths, width, height = cv_ink_trace_paths(
            image,
            threshold,
            simplify_px,
            max_side,
            min_path_px,
            link_gap_px,
            deadline,
        )
    elif trace_mode == "legacy":
        if progress:
            progress(24, "Detecting edges")
        paths: list[list[tuple[float, float]]] = []
        fallback_image = ImageOps.exif_transpose(image).convert("L")
        fallback_image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        fallback_image = ImageOps.autocontrast(fallback_image)
        edges = edge_strength_image(fallback_image)
        edges = ImageOps.autocontrast(edges)
        clear_image_border(edges)
        width, height = edges.size
        if progress:
            progress(54, "Following edge paths")
        paths = trace_edge_paths(edges, threshold, simplify_px, min_path_px, link_gap_px, deadline)
    else:
        if progress:
            progress(24, "Finding contours")
        paths, width, height = cv_contour_trace_paths(
            image,
            threshold,
            simplify_px,
            max_side,
            min_path_px,
            link_gap_px,
            deadline,
        )

        if not paths:
            if progress:
                progress(54, "Trying ink trace")
            paths, width, height = cv_ink_trace_paths(
                image,
                threshold,
                simplify_px,
                max_side,
                min_path_px,
                link_gap_px,
                deadline,
            )

    if not paths:
        raise ValueError("That image did not produce drawable edges. Try a higher-contrast image.")

    title = html.escape(safe_name(filename))
    path_lines = []
    if progress:
        progress(82, "Building svg")
    for index, path in enumerate(paths):
        if index % 50 == 0:
            check_trace_deadline(deadline)
            if progress and paths:
                progress(82 + (index / len(paths)) * 14, "Building svg")
        path_lines.append(f'<path d="{svg_path_from_polyline(path)}" />')
    path_markup = "\n  ".join(path_lines)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'  <title>{title}</title>\n'
        f'  <g fill="none" stroke="black" stroke-width="1" stroke-linecap="round">\n'
        f'  {path_markup}\n'
        f'  </g>\n'
        f'</svg>\n'
    )


def machine_point(
    point: complex,
    height: float,
    center_x: float,
    center_y: float,
    scale_x: float,
    scale_y: float,
    offset_x: float,
    offset_y: float,
) -> tuple[float, float]:
    x = (point.real - center_x) * scale_x
    y = ((height - point.imag) - center_y) * scale_y
    return x + offset_x, y + offset_y


def transform_point(
    point: complex,
    height: float,
    center_x: float,
    center_y: float,
    scale_x: float,
    scale_y: float,
    offset_x: float,
    offset_y: float,
    rotation: float,
) -> tuple[float, float]:
    x = (point.real - center_x) * scale_x
    y = ((height - point.imag) - center_y) * scale_y
    if rotation:
        radians = math.radians(rotation)
        cos_a = math.cos(radians)
        sin_a = math.sin(radians)
        x, y = x * cos_a - y * sin_a, x * sin_a + y * cos_a
    return x + offset_x, y + offset_y


def transformed_selection(
    width: float,
    height: float,
    scale_x: float,
    scale_y: float,
    offset_x: float,
    offset_y: float,
    rotation: float,
) -> dict[str, Any]:
    scaled_width = width * scale_x
    scaled_height = height * scale_y
    radians = math.radians(rotation)
    cos_a = math.cos(radians)
    sin_a = math.sin(radians)

    def rotate(local_x: float, local_y: float) -> dict[str, float]:
        return {
            "x": round(offset_x + local_x * cos_a - local_y * sin_a, 3),
            "y": round(offset_y + local_x * sin_a + local_y * cos_a, 3),
        }

    half_w = scaled_width / 2.0
    half_h = scaled_height / 2.0
    handle_defs = [
        ("nw", -half_w, half_h),
        ("n", 0.0, half_h),
        ("ne", half_w, half_h),
        ("e", half_w, 0.0),
        ("se", half_w, -half_h),
        ("s", 0.0, -half_h),
        ("sw", -half_w, -half_h),
        ("w", -half_w, 0.0),
    ]

    handles = [
        {"name": name, **rotate(local_x, local_y)}
        for name, local_x, local_y in handle_defs
    ]
    rotate_handle = rotate(0.0, half_h + 30.0)

    return {
        "center": {"x": round(offset_x, 3), "y": round(offset_y, 3)},
        "width": round(scaled_width, 3),
        "height": round(scaled_height, 3),
        "rotation": round(rotation, 3),
        "corners": [
            rotate(-half_w, half_h),
            rotate(half_w, half_h),
            rotate(half_w, -half_h),
            rotate(-half_w, -half_h),
        ],
        "handles": handles,
        "rotate_handle": rotate_handle,
    }


def sample_segment(segment: Any, sample_mm: float, scale: float):
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


def format_cubic(
    control1: tuple[float, float],
    control2: tuple[float, float],
    end: tuple[float, float],
    feed: float | None = None,
) -> str:
    line = (
        f"G5 X{end[0]:.3f} Y{end[1]:.3f} "
        f"I{control1[0]:.3f} J{control1[1]:.3f} "
        f"P{control2[0]:.3f} Q{control2[1]:.3f}"
    )
    if feed is not None:
        line += f" F{feed:.1f}"
    return line


def cubic_segments(segment: Any) -> list[Any]:
    if isinstance(segment, CubicBezier):
        return [segment]

    if isinstance(segment, QuadraticBezier):
        control1 = segment.start + (segment.control - segment.start) * (2.0 / 3.0)
        control2 = segment.end + (segment.control - segment.end) * (2.0 / 3.0)
        return [CubicBezier(segment.start, control1, control2, segment.end)]

    if isinstance(segment, Arc):
        return list(segment.as_cubic_curves())

    return []


def reverse_draw_op(op: dict[str, Any]) -> dict[str, Any]:
    if op["type"] == "cubic":
        return {
            "type": "cubic",
            "start": op["end"],
            "control1": op["control2"],
            "control2": op["control1"],
            "end": op["start"],
        }

    return {
        "type": "line",
        "start": op["end"],
        "end": op["start"],
    }


def reverse_stroke(stroke: dict[str, Any]) -> dict[str, Any]:
    return {
        **stroke,
        "start": stroke["end"],
        "end": stroke["start"],
        "ops": [reverse_draw_op(op) for op in reversed(stroke["ops"])],
        "preview": list(reversed(stroke["preview"])),
        "points": list(reversed(stroke["points"])),
    }


def stroke_is_closed(stroke: dict[str, Any], tolerance: float = 0.25) -> bool:
    start = stroke["start"]
    end = stroke["end"]
    return math.hypot(start[0] - end[0], start[1] - end[1]) <= tolerance


def ordered_strokes_by_nearest(strokes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = strokes[:]
    ordered: list[dict[str, Any]] = []
    current = (0.0, 0.0)

    while remaining:
        best_index = 0
        best_reverse = False
        best_distance = float("inf")

        for index, stroke in enumerate(remaining):
            start = stroke["start"]
            end = stroke["end"]
            start_distance = math.hypot(start[0] - current[0], start[1] - current[1])
            end_distance = math.hypot(end[0] - current[0], end[1] - current[1])

            if start_distance < best_distance:
                best_index = index
                best_reverse = False
                best_distance = start_distance

            if end_distance < best_distance and not stroke_is_closed(stroke):
                best_index = index
                best_reverse = True
                best_distance = end_distance

        chosen = remaining.pop(best_index)
        if best_reverse:
            chosen = reverse_stroke(chosen)
        ordered.append(chosen)
        current = chosen["end"]

    return ordered


def stroke_travel_distance(strokes: list[dict[str, Any]]) -> float:
    current = (0.0, 0.0)
    total = 0.0
    for stroke in strokes:
        start = stroke["start"]
        total += math.hypot(start[0] - current[0], start[1] - current[1])
        current = stroke["end"]
    return total


def build_stroke_from_subpath(
    subpath: Any,
    height: float,
    source_center_x: float,
    source_center_y: float,
    scale_x: float,
    scale_y: float,
    offset_x: float,
    offset_y: float,
    rotation: float,
    sample_mm: float,
    sample_scale: float,
) -> dict[str, Any] | None:
    start = transform_point(
        subpath[0].start,
        height,
        source_center_x,
        source_center_y,
        scale_x,
        scale_y,
        offset_x,
        offset_y,
        rotation,
    )
    current = start
    ops: list[dict[str, Any]] = []
    preview = [[round(start[0], 3), round(start[1], 3)]]
    points = [start]

    def append_line(end: tuple[float, float]) -> None:
        nonlocal current
        if math.hypot(end[0] - current[0], end[1] - current[1]) <= 0.001:
            return
        ops.append({"type": "line", "start": current, "end": end})
        preview.append([round(end[0], 3), round(end[1], 3)])
        points.append(end)
        current = end

    for segment in subpath:
        if isinstance(segment, Line):
            append_line(
                transform_point(
                    segment.end,
                    height,
                    source_center_x,
                    source_center_y,
                    scale_x,
                    scale_y,
                    offset_x,
                    offset_y,
                    rotation,
                )
            )
            continue

        cubics = cubic_segments(segment)
        if cubics:
            for cubic in cubics:
                control1 = transform_point(
                    cubic.control1,
                    height,
                    source_center_x,
                    source_center_y,
                    scale_x,
                    scale_y,
                    offset_x,
                    offset_y,
                    rotation,
                )
                control2 = transform_point(
                    cubic.control2,
                    height,
                    source_center_x,
                    source_center_y,
                    scale_x,
                    scale_y,
                    offset_x,
                    offset_y,
                    rotation,
                )
                end = transform_point(
                    cubic.end,
                    height,
                    source_center_x,
                    source_center_y,
                    scale_x,
                    scale_y,
                    offset_x,
                    offset_y,
                    rotation,
                )
                if math.hypot(end[0] - current[0], end[1] - current[1]) <= 0.001:
                    current = end
                    continue
                ops.append({
                    "type": "cubic",
                    "start": current,
                    "control1": control1,
                    "control2": control2,
                    "end": end,
                })
                for point in sample_segment(cubic, sample_mm, sample_scale):
                    sample = transform_point(
                        point,
                        height,
                        source_center_x,
                        source_center_y,
                        scale_x,
                        scale_y,
                        offset_x,
                        offset_y,
                        rotation,
                    )
                    preview.append([round(sample[0], 3), round(sample[1], 3)])
                    points.append(sample)
                current = end
            continue

        for point in sample_segment(segment, sample_mm, sample_scale):
            append_line(
                transform_point(
                    point,
                    height,
                    source_center_x,
                    source_center_y,
                    scale_x,
                    scale_y,
                    offset_x,
                    offset_y,
                    rotation,
                )
            )

    if not ops:
        return None

    return {
        "start": start,
        "end": current,
        "ops": ops,
        "preview": preview,
        "points": points,
    }


def slice_svg(request: SliceRequest) -> dict[str, Any]:
    settings = request.settings
    paper = paper_area_for_settings(settings)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    source_name = safe_name(request.filename)
    svg_text = upload_text_to_svg(source_name, request.svg_text)
    if not source_name.lower().endswith(".svg"):
        source_name = f"{Path(source_name).stem}_trace.svg"
    svg_path = UPLOAD_DIR / source_name
    svg_path.write_text(svg_text, encoding="utf-8")

    paths, _attrs, svg_attrs = svg2paths2(str(svg_path))
    height = svg_height(svg_attrs)
    xmin, xmax, ymin, ymax = source_bounds(paths)
    source_width = max(xmax - xmin, 0.001)
    source_height = max(ymax - ymin, 0.001)
    source_center_x = (xmin + xmax) / 2.0
    source_center_y = ((height - ymax) + (height - ymin)) / 2.0

    if settings.fit_to_bed:
        available_x = max(paper["width"] - 2 * settings.margin, 1.0)
        available_y = max(paper["height"] - 2 * settings.margin, 1.0)
        scale = min(available_x / source_width, available_y / source_height)
        scale_x = scale
        scale_y = scale
        offset_x = paper["center_x"]
        offset_y = paper["center_y"]
    else:
        scale = settings.scale
        scale_x = settings.scale_x or scale
        scale_y = settings.scale_y or scale
        offset_x = settings.offset_x
        offset_y = settings.offset_y
    rotation = settings.rotation
    selection = transformed_selection(
        source_width,
        source_height,
        scale_x,
        scale_y,
        offset_x,
        offset_y,
        rotation,
    )

    feed = feed_from_delay(settings.speed_delay)
    gcode: list[str] = [
        f"; Generated from {source_name} by Plotter Studio",
        "; Manually home the toolhead before sending this file.",
        "G21",
        "G90",
        "M17",
        f"M204 S{settings.accel:.1f}",
        f"M340 U{settings.pen_up_delay} D{settings.pen_down_delay} L{settings.pen_up_lift_percent}",
        "M5",
    ]

    preview_paths: list[list[list[float]]] = []
    all_points: list[tuple[float, float]] = []
    travel_moves = 0
    draw_moves = 0
    curve_moves = 0
    strokes: list[dict[str, Any]] = []

    for path in paths:
        for subpath in path.continuous_subpaths():
            if len(subpath) == 0:
                continue

            stroke = build_stroke_from_subpath(
                subpath,
                height,
                source_center_x,
                source_center_y,
                scale_x,
                scale_y,
                offset_x,
                offset_y,
                rotation,
                settings.sample_mm,
                scale,
            )
            if stroke is not None:
                strokes.append(stroke)

    travel_distance_before = stroke_travel_distance(strokes)
    ordered_strokes = ordered_strokes_by_nearest(strokes)
    travel_distance_after = stroke_travel_distance(ordered_strokes)

    for stroke in ordered_strokes:
        start_x, start_y = stroke["start"]
        gcode.append(format_xy("G0", start_x, start_y, feed))
        gcode.append("M3")
        travel_moves += 1

        for op in stroke["ops"]:
            end_x, end_y = op["end"]
            if op["type"] == "cubic":
                gcode.append(format_cubic(op["control1"], op["control2"], op["end"], feed))
                curve_moves += 1
            else:
                gcode.append(format_xy("G1", end_x, end_y, feed))
            draw_moves += 1

        gcode.append("M5")
        preview_paths.append(stroke["preview"])
        all_points.extend(stroke["points"])

    gcode.extend(["M2", ""])

    warnings: list[str] = []
    within_bounds = True
    within_machine = True
    within_paper = True
    within_margin = True
    if all_points:
        min_x = min(point[0] for point in all_points)
        max_x = max(point[0] for point in all_points)
        min_y = min(point[1] for point in all_points)
        max_y = max(point[1] for point in all_points)
        if min_x < 0 or max_x > settings.x_max or min_y < 0 or max_y > settings.y_max:
            within_machine = False
            within_bounds = False
            warnings.append("Toolpath extends outside the configured machine bounds.")
        if (
            min_x < paper["x_min"]
            or max_x > paper["x_max"]
            or min_y < paper["y_min"]
            or max_y > paper["y_max"]
        ):
            within_paper = False
            within_bounds = False
            if paper["mode"] == "letter":
                warnings.append("Toolpath extends outside the centered Letter paper.")
            else:
                warnings.append("Toolpath extends outside the drawable canvas.")
        if (
            settings.margin > 0
            and within_machine
            and within_paper
            and (
                min_x < paper["x_min"] + settings.margin
                or max_x > paper["x_max"] - settings.margin
                or min_y < paper["y_min"] + settings.margin
                or max_y > paper["y_max"] - settings.margin
            )
        ):
            within_margin = False
            warnings.append("Toolpath enters the selected paper margin safety area.")
    else:
        min_x = max_x = min_y = max_y = 0.0
        warnings.append("No drawable path points were generated.")

    return {
        "gcode": "\n".join(gcode),
        "preview": {
            "paths": preview_paths,
            "bounds": {
                "min_x": round(min_x, 3),
                "max_x": round(max_x, 3),
                "min_y": round(min_y, 3),
                "max_y": round(max_y, 3),
            },
            "machine": {"x_max": settings.x_max, "y_max": settings.y_max},
            "paper": paper,
            "margin": round(settings.margin, 3),
            "selection": selection,
        },
        "stats": {
            "line_count": len([line for line in gcode if line.strip()]),
            "travel_moves": travel_moves,
            "draw_moves": draw_moves,
            "curve_moves": curve_moves,
            "scale": round(scale, 4),
            "offset_x": round(offset_x, 3),
            "offset_y": round(offset_y, 3),
            "feed": round(feed, 1),
            "travel_distance_before": round(travel_distance_before, 3),
            "travel_distance_after": round(travel_distance_after, 3),
            "travel_distance_saved": round(max(0.0, travel_distance_before - travel_distance_after), 3),
            "within_bounds": within_bounds,
            "within_machine": within_machine,
            "within_paper": within_paper,
            "within_margin": within_margin,
            "paper_mode": paper["mode"],
            "paper": paper,
            "transform": {
                "scale_x": round(scale_x, 6),
                "scale_y": round(scale_y, 6),
                "offset_x": round(offset_x, 3),
                "offset_y": round(offset_y, 3),
                "rotation": round(rotation, 3),
            },
        },
        "warnings": warnings,
    }


def clean_gcode_lines(gcode: str) -> list[str]:
    lines: list[str] = []
    for raw in gcode.splitlines():
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("("):
            continue
        lines.append(line)
    return lines


def replace_word(line: str, letter: str, value: float) -> str:
    tokens = [token for token in line.split() if not token.upper().startswith(letter.upper())]
    tokens.append(f"{letter.upper()}{value:.1f}")
    return " ".join(tokens)


def motion_code(line: str) -> str | None:
    if not line:
        return None
    token = line.split()[0].upper()
    if token in {"G0", "G00"}:
        return "G0"
    if token in {"G1", "G01"}:
        return "G1"
    if token in {"G5", "G05"}:
        return "G5"
    return None


def parse_xy(line: str) -> tuple[float | None, float | None]:
    x_match = re.search(r"(?:^|\s)X([-+]?\d*\.?\d+)", line, re.IGNORECASE)
    y_match = re.search(r"(?:^|\s)Y([-+]?\d*\.?\d+)", line, re.IGNORECASE)
    x = float(x_match.group(1)) if x_match else None
    y = float(y_match.group(1)) if y_match else None
    return x, y


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


class PlotterController:
    def __init__(self) -> None:
        self.serial_port: serial.Serial | None = None
        self.port_name: str | None = None
        self.baud = BAUD
        self.lock = threading.Lock()
        self.logs: deque[dict[str, str]] = deque(maxlen=600)
        self.job_thread: threading.Thread | None = None
        self.pause_event = threading.Event()
        self.stop_event = threading.Event()
        self.job = {
            "running": False,
            "paused": False,
            "stopping": False,
            "name": None,
            "current_line": 0,
            "total_lines": 0,
            "message": "Idle",
            "line_started_at_ms": None,
            "error": None,
        }
        self.settings = {
            "speed_delay": 50,
            "accel": 10000.0,
            "pen_up_delay": 200,
            "pen_down_delay": 600,
            "pen_up_lift_percent": 100,
        }
        self.home_confirmed = False
        self.position_x = 0.0
        self.position_y = 0.0
        self.pen_state = "off"
        self.pending_accel = False
        self.pending_pen_config = False

    def log(self, direction: str, text: str) -> None:
        self.logs.append(
            {
                "time": time.strftime("%H:%M:%S"),
                "direction": direction,
                "text": text,
            }
        )

    def list_ports(self) -> list[dict[str, str]]:
        ports = []
        for port in list_ports.comports():
            text = f"{port.device} {port.description} {port.hwid}".lower()
            ports.append({
                "device": port.device,
                "description": port.description,
                "hwid": port.hwid,
                "preferred": any(token in text for token in ["arduino", "usbmodem", "ttyacm"]),
            })
        return ports

    def is_connected(self) -> bool:
        return self.serial_port is not None and self.serial_port.is_open

    def connect(self, port: str | None = None, baud: int = BAUD) -> None:
        with self.lock:
            if self.is_connected():
                self.disconnect_locked()

            port_name = port or find_default_port()
            if not port_name:
                raise RuntimeError("No Arduino-like serial port found.")

            try:
                self.serial_port = serial.Serial(port_name, baud, timeout=0.1, write_timeout=2)
            except OSError as exc:
                owner_text = self.port_owner_summary(port_name)
                message = f"Could not open {port_name}: {exc}"
                if owner_text:
                    message += f"\n\nProcess using this port:\n{owner_text}"
                raise RuntimeError(message) from exc

            self.port_name = port_name
            self.baud = baud
            self.home_confirmed = False
            self.position_x = 0.0
            self.position_y = 0.0
            self.pen_state = "off"
            self.log("system", f"Opened {port_name} at {baud} baud")
            time.sleep(2.0)
            self.read_available_locked()

    def port_owner_summary(self, port_name: str) -> str:
        try:
            result = subprocess.run(
                ["lsof", port_name],
                text=True,
                capture_output=True,
                timeout=3,
            )
        except Exception:
            return ""

        return result.stdout.strip()

    def disconnect_locked(self) -> None:
        if self.serial_port is not None:
            try:
                self.serial_port.close()
            finally:
                self.log("system", "Serial port closed")
        self.serial_port = None
        self.port_name = None
        self.home_confirmed = False
        self.pen_state = "off"

    def disconnect(self) -> None:
        with self.lock:
            self.disconnect_locked()

    def read_available_locked(self) -> list[str]:
        if not self.is_connected():
            return []

        assert self.serial_port is not None
        lines: list[str] = []
        while self.serial_port.in_waiting:
            raw = self.serial_port.readline()
            if not raw:
                break
            text = raw.decode("utf-8", errors="replace").strip()
            if text:
                lines.append(text)
                self.log("in", text)
                self.update_position_from_line(text)
        return lines

    def update_position_from_line(self, text: str) -> None:
        match = re.search(r"Position:\s*X=([-+]?\d*\.?\d+)\s*Y=([-+]?\d*\.?\d+)", text)
        if match:
            self.position_x = float(match.group(1))
            self.position_y = float(match.group(2))
        if "home=YES" in text or "Manual home confirmed" in text:
            self.home_confirmed = True
        lower = text.strip().lower()
        if lower in {"pen up.", "pen up"}:
            self.pen_state = "up"
        elif lower in {"pen down.", "pen down"}:
            self.pen_state = "down"
        elif lower in {"servo power off.", "servo power off"}:
            self.pen_state = "off"

    def require_connected_locked(self) -> serial.Serial:
        if not self.is_connected() or self.serial_port is None:
            raise RuntimeError("Not connected to plotter.")
        return self.serial_port

    def write_line_locked(self, line: str) -> None:
        port = self.require_connected_locked()
        self.log("out", line)
        port.write((line + "\n").encode("utf-8"))
        port.flush()

    def send_realtime_abort(self) -> None:
        port = self.serial_port
        if port is None or not port.is_open:
            return

        try:
            self.log("out", "! realtime abort")
            port.write(b"!")
            port.flush()
        except Exception as exc:
            self.log("system", f"Realtime abort write failed: {exc}")

    def wait_for_ok_locked(self, timeout_s: float = 90.0) -> bool:
        port = self.require_connected_locked()
        deadline = time.monotonic() + timeout_s

        while time.monotonic() < deadline:
            raw = port.readline()
            if not raw:
                continue

            text = raw.decode("utf-8", errors="replace").strip()
            if not text:
                continue

            self.log("in", text)
            self.update_position_from_line(text)
            lower = text.lower()
            if lower == "ok":
                return True
            if lower.startswith("error"):
                return False

        raise TimeoutError("Timed out waiting for ok/error from firmware.")

    def send_gcode_locked(self, line: str, timeout_s: float = 90.0) -> bool:
        self.write_line_locked(line)
        ok = self.wait_for_ok_locked(timeout_s)
        x, y = parse_xy(line)
        if ok and x is not None:
            self.position_x = x
        if ok and y is not None:
            self.position_y = y
        if ok:
            self.update_pen_from_command(line)
        return ok

    def update_pen_from_command(self, line: str) -> None:
        stripped = line.strip().lower()
        if re.match(r"^m0*3(?:\s|$)", stripped):
            self.pen_state = "down"
        elif re.match(r"^m0*5(?:\s|$)", stripped):
            self.pen_state = "up"
        elif re.match(r"^m0*(2|30)(?:\s|$)", stripped):
            self.pen_state = "off"
        elif re.match(r"^g0*0(?:\s|$)", stripped):
            self.pen_state = "up"

    def send_gcode(self, line: str, timeout_s: float = 90.0) -> bool:
        with self.lock:
            return self.send_gcode_locked(line, timeout_s)

    def send_quiet_manual_locked(self, command: str) -> None:
        self.write_line_locked(command)
        deadline = time.monotonic() + 0.8
        while time.monotonic() < deadline:
            self.read_available_locked()
            time.sleep(0.05)

    def send_manual(self, command: str) -> dict[str, Any]:
        command = command.strip()
        if not command:
            raise RuntimeError("Command is empty.")

        with self.lock:
            if self.job["running"] and not self.job["paused"]:
                raise RuntimeError("Manual commands are blocked while a job is running.")

            if re.match(r"^[GMgm]\d+", command):
                ok = self.send_gcode_locked(command)
                return {"ok": ok}

            self.write_line_locked(command)
            deadline = time.monotonic() + 1.5
            while time.monotonic() < deadline:
                self.read_available_locked()
                time.sleep(0.05)
            lower = command.lower()
            if lower == "u":
                self.pen_state = "up"
            elif lower == "d":
                self.pen_state = "down"
            elif lower in {"soff", "penoff"}:
                self.pen_state = "off"
            return {"ok": True}

    def update_settings(self, updates: SettingsRequest) -> None:
        if updates.speed_delay is not None:
            self.settings["speed_delay"] = int(updates.speed_delay)
        if updates.accel is not None:
            self.settings["accel"] = float(updates.accel)
            self.pending_accel = True
        if updates.pen_up_delay is not None:
            self.settings["pen_up_delay"] = int(updates.pen_up_delay)
            self.pending_pen_config = True
        if updates.pen_down_delay is not None:
            self.settings["pen_down_delay"] = int(updates.pen_down_delay)
            self.pending_pen_config = True
        if updates.pen_up_lift_percent is not None:
            self.settings["pen_up_lift_percent"] = int(updates.pen_up_lift_percent)
            self.pending_pen_config = True

        if self.is_connected() and not self.job["running"]:
            with self.lock:
                if updates.accel is not None:
                    self.send_gcode_locked(f"M204 S{self.settings['accel']:.1f}", timeout_s=10.0)
                if updates.speed_delay is not None:
                    self.send_quiet_manual_locked(f"s {self.settings['speed_delay']}")
                if updates.pen_up_delay is not None or updates.pen_down_delay is not None or updates.pen_up_lift_percent is not None:
                    self.send_gcode_locked(
                        f"M340 U{self.settings['pen_up_delay']} D{self.settings['pen_down_delay']} L{self.settings['pen_up_lift_percent']}",
                        timeout_s=10.0,
                    )
                    self.pending_pen_config = False

    def confirm_home(self) -> None:
        with self.lock:
            self.send_gcode_locked("M17", timeout_s=20.0)
            ok = self.send_gcode_locked("G28 P1", timeout_s=20.0)
            if not ok:
                raise RuntimeError("Firmware rejected manual home confirmation.")
            self.position_x = 0.0
            self.position_y = 0.0
            self.home_confirmed = True

    def jog(self, dx: float, dy: float) -> None:
        with self.lock:
            if self.job["running"] and not self.job["paused"]:
                raise RuntimeError("Jog is blocked while a job is running. Pause first.")
            if not self.home_confirmed:
                raise RuntimeError("Confirm manual home before jogging.")
            target_x = self.position_x + dx
            target_y = self.position_y + dy
            if target_x < 0 or target_x > X_MAX or target_y < 0 or target_y > Y_MAX:
                raise RuntimeError(f"Jog target outside bounds: X{target_x:.2f} Y{target_y:.2f}")
            feed = feed_from_delay(self.settings["speed_delay"])
            ok = self.send_gcode_locked(f"G1 X{target_x:.3f} Y{target_y:.3f} F{feed:.1f}")
            if not ok:
                raise RuntimeError("Firmware rejected jog command.")

    def start_job(self, gcode: str, confirm_home: bool, name: str) -> None:
        if self.job["running"]:
            raise RuntimeError("A job is already running.")
        if not self.is_connected():
            raise RuntimeError("Connect to the plotter before sending a job.")

        lines = clean_gcode_lines(gcode)
        if not lines:
            raise RuntimeError("No G-code lines to send.")

        self.pause_event.clear()
        self.stop_event.clear()
        self.job = {
            "running": True,
            "paused": False,
            "stopping": False,
            "name": name,
            "current_line": 0,
            "total_lines": len(lines),
            "message": "Starting",
            "line_started_at_ms": None,
            "error": None,
        }

        self.job_thread = threading.Thread(
            target=self.run_job,
            args=(lines, confirm_home),
            daemon=True,
        )
        self.job_thread.start()

    def apply_live_overrides_locked(self) -> None:
        if self.pending_accel:
            self.send_gcode_locked(f"M204 S{self.settings['accel']:.1f}", timeout_s=20.0)
            self.pending_accel = False
        if self.pending_pen_config:
            self.send_gcode_locked(
                f"M340 U{self.settings['pen_up_delay']} D{self.settings['pen_down_delay']} L{self.settings['pen_up_lift_percent']}",
                timeout_s=20.0,
            )
            self.pending_pen_config = False

    def rewrite_motion_feed(self, line: str) -> str:
        code = motion_code(line)
        if code in {"G0", "G1", "G5"}:
            return replace_word(line, "F", feed_from_delay(self.settings["speed_delay"]))
        return line

    def run_job(self, lines: list[str], confirm_home: bool) -> None:
        try:
            with self.lock:
                self.job["message"] = "Lifting pen"
                self.pen_state = "up"
                self.send_gcode_locked("M5", timeout_s=30.0)

                if confirm_home:
                    self.send_gcode_locked("M17", timeout_s=20.0)
                    ok = self.send_gcode_locked("G28 P1", timeout_s=20.0)
                    if not ok:
                        raise RuntimeError("Firmware rejected manual home confirmation.")
                    self.home_confirmed = True
                    self.position_x = 0.0
                    self.position_y = 0.0

            for index, raw_line in enumerate(lines, 1):
                if self.stop_event.is_set():
                    self.job["message"] = "Stopping"
                    break

                while self.pause_event.is_set():
                    self.job["paused"] = True
                    self.job["message"] = "Paused"
                    time.sleep(0.1)
                    if self.stop_event.is_set():
                        break

                if self.stop_event.is_set():
                    self.job["message"] = "Stopping"
                    break

                line = self.rewrite_motion_feed(raw_line)

                with self.lock:
                    self.apply_live_overrides_locked()
                    self.job["paused"] = False
                    self.job["message"] = line
                    self.job["line_started_at_ms"] = int(time.time() * 1000)
                    ok = self.send_gcode_locked(line, timeout_s=180.0)
                    self.job["current_line"] = index
                    if not ok:
                        if self.stop_event.is_set():
                            self.job["message"] = "Stopping"
                            break
                        raise RuntimeError(f"Firmware returned error for: {line}")

            with self.lock:
                if self.stop_event.is_set():
                    self.job["message"] = "Returning home"
                    self.send_gcode_locked("M5", timeout_s=30.0)
                    if self.home_confirmed:
                        feed = feed_from_delay(self.settings["speed_delay"])
                        self.send_gcode_locked(f"G0 X0.000 Y0.000 F{feed:.1f}", timeout_s=180.0)
                    self.send_gcode_locked("M2", timeout_s=30.0)
                    self.position_x = 0.0
                    self.position_y = 0.0
                    self.pen_state = "off"
                    self.job["current_line"] = 0
                    self.job["total_lines"] = 0
                    self.job["name"] = None
                    self.job["line_started_at_ms"] = None
                    self.job["message"] = "Stopped and reset"
                else:
                    self.job["line_started_at_ms"] = None
                    self.job["message"] = "Complete"
        except Exception as exc:
            self.log("system", f"Job error: {exc}")
            self.job["error"] = str(exc)
            self.job["message"] = "Error"
        finally:
            self.job["running"] = False
            self.job["paused"] = False
            self.job["stopping"] = False

    def pause_job(self) -> None:
        if self.job["running"]:
            self.pause_event.set()
            self.job["paused"] = True

    def resume_job(self) -> None:
        self.pause_event.clear()
        self.job["paused"] = False

    def stop_job(self) -> None:
        if self.job["running"]:
            self.stop_event.set()
            self.job["stopping"] = True
            self.job["current_line"] = 0
            self.job["message"] = "Stopping and returning home"
            self.send_realtime_abort()
            return

        with self.lock:
            self.reset_idle_locked()

    def reset_idle_locked(self) -> None:
        self.job["current_line"] = 0
        self.job["total_lines"] = 0
        self.job["name"] = None
        self.job["line_started_at_ms"] = None
        self.job["error"] = None
        self.job["message"] = "Reset"

        if not self.is_connected():
            return

        self.send_gcode_locked("M5", timeout_s=30.0)
        if self.home_confirmed:
            feed = feed_from_delay(self.settings["speed_delay"])
            self.send_gcode_locked(f"G0 X0.000 Y0.000 F{feed:.1f}", timeout_s=180.0)
            self.position_x = 0.0
            self.position_y = 0.0
        self.send_gcode_locked("M2", timeout_s=30.0)
        self.pen_state = "off"

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.is_connected(),
            "server_time_ms": int(time.time() * 1000),
            "port": self.port_name,
            "baud": self.baud,
            "ports": self.list_ports(),
            "job": self.job,
            "settings": self.settings,
            "home_confirmed": self.home_confirmed,
            "pen_state": self.pen_state,
            "position": {"x": self.position_x, "y": self.position_y},
            "logs": list(self.logs)[-220:],
        }


controller = PlotterController()
app = FastAPI(title="Plotter Studio")
app.mount("/examples", StaticFiles(directory=ROOT / "examples"), name="examples")


NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html", headers=NO_CACHE_HEADERS)


@app.get("/static/{path:path}")
def static_file(path: str):
    target = (STATIC_DIR / path).resolve()
    if STATIC_DIR.resolve() not in target.parents:
        raise HTTPException(status_code=404, detail="Not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target, headers=NO_CACHE_HEADERS)


@app.get("/api/status")
def api_status():
    return controller.status()


@app.post("/api/connect")
def api_connect(request: ConnectRequest):
    try:
        controller.connect(request.port, request.baud)
        return controller.status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/disconnect")
def api_disconnect():
    if controller.job["running"]:
        raise HTTPException(status_code=409, detail="Stop the running job before disconnecting.")
    controller.disconnect()
    return controller.status()


@app.post("/api/upload-firmware")
def api_upload_firmware():
    if controller.job["running"]:
        raise HTTPException(status_code=409, detail="Stop the running job before uploading.")

    controller.disconnect()
    controller.log("system", "Uploading firmware with PlatformIO")
    result = subprocess.run(
        ["pio", "run", "-e", "uno", "-t", "upload"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=90,
    )
    output = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
    for line in output.splitlines()[-40:]:
        controller.log("system", line)

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=output or "Firmware upload failed.")

    return {"ok": True, "output": output}


@app.post("/api/slice")
def api_slice(request: SliceRequest):
    try:
        result = slice_svg(request)
        if not result["stats"]["within_bounds"]:
            paper = result["preview"]["paper"]
            if not result["stats"].get("within_paper", True) and paper["mode"] != "full":
                raise ValueError(f"Toolpath is off the {paper['label']} paper. Move or scale it inside the paper before slicing.")
            raise ValueError("Toolpath is off the machine canvas. Move or scale it inside the 406 x 370 area before slicing.")
        controller.settings["speed_delay"] = request.settings.speed_delay
        controller.settings["accel"] = request.settings.accel
        controller.settings["pen_up_delay"] = request.settings.pen_up_delay
        controller.settings["pen_down_delay"] = request.settings.pen_down_delay
        controller.settings["pen_up_lift_percent"] = request.settings.pen_up_lift_percent
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/preview")
def api_preview(request: SliceRequest):
    try:
        return slice_svg(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/raster/trace")
def api_raster_trace(request: RasterTraceRequest):
    return start_trace_job(request)


@app.get("/api/raster/trace/{job_id}")
def api_raster_trace_status(job_id: str):
    with trace_lock:
        job = trace_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Trace job not found.")
        return {key: value for key, value in job.items() if key not in {"token", "created_at"}}


@app.post("/api/raster/trace/{job_id}/cancel")
def api_raster_trace_cancel(job_id: str):
    global trace_generation
    with trace_lock:
        job = trace_jobs.get(job_id)
        if not job:
            return {"status": "missing"}
        if job.get("status") == "running":
            trace_generation += 1
            job.update({"status": "canceled", "progress": 0, "label": "Trace canceled"})
        return {"status": job.get("status", "canceled")}


@app.post("/api/settings")
def api_settings(request: SettingsRequest):
    try:
        controller.update_settings(request)
        return controller.status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/manual")
def api_manual(request: ManualCommandRequest):
    try:
        return controller.send_manual(request.command)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/home/confirm")
def api_confirm_home():
    try:
        controller.confirm_home()
        return controller.status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/jog")
def api_jog(request: JogRequest):
    try:
        controller.jog(request.dx, request.dy)
        return controller.status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/job/start")
def api_job_start(request: StartJobRequest):
    try:
        controller.start_job(request.gcode, request.confirm_home, request.name)
        return controller.status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/job/pause")
def api_job_pause():
    controller.pause_job()
    return controller.status()


@app.post("/api/job/resume")
def api_job_resume():
    controller.resume_job()
    return controller.status()


@app.post("/api/job/stop")
def api_job_stop():
    controller.stop_job()
    return controller.status()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
