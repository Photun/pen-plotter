const state = {
  svgText: "",
  fileName: "",
  artworks: [],
  selectedArtworkId: null,
  nextArtworkId: 1,
  undoStack: [],
  redoStack: [],
  gcode: "",
  preparePreview: null,
  prepareStats: null,
  prepareTransform: null,
  preparePreviewSeq: 0,
  preparePreviewPending: false,
  prepareInteraction: null,
  preview: null,
  stats: null,
  sliceReady: false,
  sliceSignature: "",
  sliceConfirmed: false,
  motionPlan: null,
  jobSim: {
    activeLine: "",
    startedAt: 0,
    segment: null,
    durationMs: 0,
    profile: null,
    fraction: 0,
  },
  status: null,
  activeTab: "prepare",
  sendBusy: false,
  homeBusy: false,
  tuningDirty: false,
  import: {
    open: false,
    fileName: "",
    imageData: "",
    traceSvg: "",
    traceFileName: "",
    tracePreviewUrl: "",
    abortController: null,
    seq: 0,
    pending: false,
    progressTimer: 0,
    progressStartedAt: 0,
  },
};

const MACHINE_X_MAX = 406;
const MACHINE_Y_MAX = 370;
const LETTER_PAPER_WIDTH = 140;
const LETTER_PAPER_HEIGHT = Number((LETTER_PAPER_WIDTH * 8.5 / 11).toFixed(3));
const CURVE_SAMPLE_MM = 4;
const STEPS_PER_MM = 160;
const START_STEP_DELAY = 600;
const ROTATION_SNAP_INCREMENT = 45;
const ROTATION_SNAP_THRESHOLD = 5;
const EDGE_SNAP_THRESHOLD = 4;
const TRACE_REQUEST_TIMEOUT_MS = 14000;
const TRACE_DEFAULTS = {
  mode: "contour",
  threshold: 34,
  simplify: 1.5,
  size: 720,
  minPath: 8,
  linkGap: 5,
};

const $ = (id) => document.getElementById(id);

function maybe(id) {
  return document.getElementById(id);
}

function paperAreaForMode(mode = "full") {
  if (mode === "letter") {
    const width = LETTER_PAPER_WIDTH;
    const height = LETTER_PAPER_HEIGHT;
    const xMin = (MACHINE_X_MAX - width) / 2;
    const yMin = (MACHINE_Y_MAX - height) / 2;
    return {
      mode: "letter",
      label: "Letter",
      x_min: Number(xMin.toFixed(3)),
      x_max: Number((xMin + width).toFixed(3)),
      y_min: Number(yMin.toFixed(3)),
      y_max: Number((yMin + height).toFixed(3)),
      width,
      height,
    };
  }

  return {
    mode: "full",
    label: "Full canvas",
    x_min: 0,
    x_max: MACHINE_X_MAX,
    y_min: 0,
    y_max: MACHINE_Y_MAX,
    width: MACHINE_X_MAX,
    height: MACHINE_Y_MAX,
  };
}

function currentPaperArea() {
  return paperAreaForMode(maybe("paperModeInput")?.value || "full");
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.style.background = isError ? "#b42318" : "#26313d";
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  return data;
}

function settingsFromInputs() {
  return settingsForArtwork(selectedArtwork());
}

function tuneFromInputs() {
  const speed = $("liveSpeedDelayInput");
  const accel = $("liveAccelInput");
  const penUp = $("livePenUpDelayInput");
  const penDown = $("livePenDownDelayInput");
  const penUpLift = $("livePenUpLiftInput");
  return {
    speed_delay: Number(speed.value),
    accel: Number(accel.value),
    pen_up_delay: Number(penUp.value),
    pen_down_delay: Number(penDown.value),
    pen_up_lift_percent: Number(penUpLift.value),
  };
}

function selectedArtwork() {
  return state.artworks.find((artwork) => artwork.id === state.selectedArtworkId) || null;
}

function artworkById(id) {
  return state.artworks.find((artwork) => artwork.id === id) || null;
}

function cloneArtwork(artwork) {
  return {
    id: artwork.id,
    fileName: artwork.fileName,
    svgText: artwork.svgText,
    transform: artwork.transform ? { ...artwork.transform } : null,
    preview: artwork.preview ? JSON.parse(JSON.stringify(artwork.preview)) : null,
    stats: artwork.stats ? JSON.parse(JSON.stringify(artwork.stats)) : null,
    warnings: [...(artwork.warnings || [])],
  };
}

function snapshotArtworkState() {
  return {
    artworks: state.artworks.map(cloneArtwork),
    selectedArtworkId: state.selectedArtworkId,
    nextArtworkId: state.nextArtworkId,
    fitToBed: $("fitToBed").checked,
    paperMode: $("paperModeInput").value,
    margin: Number($("marginInput").value),
  };
}

function restoreArtworkState(snapshot) {
  state.artworks = snapshot.artworks.map(cloneArtwork);
  state.selectedArtworkId = snapshot.selectedArtworkId;
  state.nextArtworkId = snapshot.nextArtworkId;
  $("fitToBed").checked = snapshot.fitToBed;
  $("paperModeInput").value = snapshot.paperMode || "full";
  $("marginInput").value = snapshot.margin;
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
  updateFileSummary();
  markSliceDirty("Placement changed. Slice plate again.");
}

function pushUndo() {
  state.undoStack.push(snapshotArtworkState());
  if (state.undoStack.length > 80) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshotArtworkState());
  restoreArtworkState(state.undoStack.pop());
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshotArtworkState());
  restoreArtworkState(state.redoStack.pop());
}

function setSelectedArtwork(id) {
  state.selectedArtworkId = id;
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
  updateFileSummary();
  scheduleDraw();
}

function addArtwork(fileName, svgText) {
  const artwork = {
    id: state.nextArtworkId++,
    fileName,
    svgText,
    transform: null,
    preview: null,
    stats: null,
    warnings: [],
  };
  state.artworks.push(artwork);
  state.selectedArtworkId = artwork.id;
  syncLegacyArtworkFields();
  updateFileSummary();
  return artwork;
}

function deleteSelectedArtwork() {
  const selected = selectedArtwork();
  if (!selected) return;
  pushUndo();
  state.artworks = state.artworks.filter((artwork) => artwork.id !== selected.id);
  state.selectedArtworkId = state.artworks.length ? state.artworks[state.artworks.length - 1].id : null;
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
  updateFileSummary();
  markSliceDirty("Artwork deleted. Slice plate again.");
}

function clearAllArtworks() {
  if (!state.artworks.length) return;
  pushUndo();
  state.artworks = [];
  state.selectedArtworkId = null;
  state.nextArtworkId = 1;
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
  updateFileSummary();
  invalidateSlice("No plate sliced");
}

function syncLegacyArtworkFields() {
  const selected = selectedArtwork();
  state.svgText = selected?.svgText || "";
  state.fileName = selected?.fileName || "";
  state.prepareTransform = selected?.transform || null;
}

function updateFileSummary() {
  const label = $("fileName");
  if (!state.artworks.length) {
    label.textContent = "No image loaded";
    return;
  }

  const selected = selectedArtwork();
  label.textContent = state.artworks.length === 1
    ? selected?.fileName || state.artworks[0].fileName
    : `${state.artworks.length} images loaded${selected ? ` - ${selected.fileName}` : ""}`;
}

function settingsForArtwork(artwork) {
  const transform = artwork?.transform || null;
  return {
    x_max: MACHINE_X_MAX,
    y_max: MACHINE_Y_MAX,
    paper_mode: currentPaperArea().mode,
    margin: Number($("marginInput").value),
    fit_to_bed: $("fitToBed").checked && !transform,
    scale: transform ? Math.sqrt(transform.scaleX * transform.scaleY) : 1,
    scale_x: transform?.scaleX,
    scale_y: transform?.scaleY,
    offset_x: transform?.offsetX ?? 0,
    offset_y: transform?.offsetY ?? 0,
    rotation: transform?.rotation ?? 0,
    speed_delay: Number($("liveSpeedDelayInput").value),
    accel: Number($("liveAccelInput").value),
    pen_up_delay: Number($("livePenUpDelayInput").value),
    pen_down_delay: Number($("livePenDownDelayInput").value),
    pen_up_lift_percent: Number($("livePenUpLiftInput").value),
    sample_mm: CURVE_SAMPLE_MM,
  };
}

function rebuildPreparePreviewFromArtworks() {
  const paths = [];
  const warnings = [];
  let lineCount = 0;
  let drawMoves = 0;
  let curveMoves = 0;
  let travelMoves = 0;
  let travelSaved = 0;
  let withinBounds = true;
  let withinMachine = true;
  let withinPaper = true;
  let withinMargin = true;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const artwork of state.artworks) {
    const preview = artwork.preview;
    const stats = artwork.stats || {};
    if (preview?.paths) {
      paths.push(...preview.paths);
    }
    if (preview?.bounds) {
      minX = Math.min(minX, preview.bounds.min_x);
      maxX = Math.max(maxX, preview.bounds.max_x);
      minY = Math.min(minY, preview.bounds.min_y);
      maxY = Math.max(maxY, preview.bounds.max_y);
    }
    lineCount += Number(stats.line_count || 0);
    drawMoves += Number(stats.draw_moves || 0);
    curveMoves += Number(stats.curve_moves || 0);
    travelMoves += Number(stats.travel_moves || 0);
    travelSaved += Number(stats.travel_distance_saved || 0);
    if (stats.within_bounds === false) withinBounds = false;
    if (stats.within_machine === false) withinMachine = false;
    if (stats.within_paper === false) withinPaper = false;
    if (stats.within_margin === false) withinMargin = false;
    warnings.push(...(artwork.warnings || []));
  }

  const selected = selectedArtwork();
  const hasBounds = Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY);
  state.preparePreview = state.artworks.length
    ? {
      paths,
      bounds: hasBounds ? {
        min_x: Number(minX.toFixed(3)),
        max_x: Number(maxX.toFixed(3)),
        min_y: Number(minY.toFixed(3)),
        max_y: Number(maxY.toFixed(3)),
      } : null,
      machine: { x_max: MACHINE_X_MAX, y_max: MACHINE_Y_MAX },
      paper: currentPaperArea(),
      margin: Number($("marginInput").value),
      selection: selected?.preview?.selection || null,
    }
    : null;
  state.prepareStats = state.artworks.length
    ? {
      line_count: lineCount,
      draw_moves: drawMoves,
      curve_moves: curveMoves,
      travel_moves: travelMoves,
      travel_distance_saved: travelSaved,
      within_bounds: withinBounds,
      within_machine: withinMachine,
      within_paper: withinPaper,
      within_margin: withinMargin,
      paper_mode: currentPaperArea().mode,
      paper: currentPaperArea(),
    }
    : null;

  updateStats({
    preview: state.preparePreview,
    stats: state.prepareStats,
    warnings: [...new Set(warnings)],
  });
}

function currentSliceSignature() {
  return JSON.stringify({
    artworks: state.artworks.map((artwork) => ({
      id: artwork.id,
      fileName: artwork.fileName,
      svgText: artwork.svgText,
      transform: artwork.transform ? {
        scaleX: Number(artwork.transform.scaleX.toFixed(6)),
        scaleY: Number(artwork.transform.scaleY.toFixed(6)),
        offsetX: Number(artwork.transform.offsetX.toFixed(3)),
        offsetY: Number(artwork.transform.offsetY.toFixed(3)),
        rotation: Number(artwork.transform.rotation.toFixed(3)),
      } : null,
    })),
    fitToBed: $("fitToBed").checked,
    paperMode: currentPaperArea().mode,
    margin: Number($("marginInput").value),
    xMax: MACHINE_X_MAX,
    yMax: MACHINE_Y_MAX,
    sampleMm: CURVE_SAMPLE_MM,
  });
}

function invalidateSlice(message = "Slice required") {
  state.gcode = "";
  state.sliceReady = false;
  state.sliceSignature = "";
  state.sliceConfirmed = false;
  state.motionPlan = null;
  state.preview = null;
  state.stats = null;
  hideTaskProgress("slice");
  const gcodeText = maybe("gcodeText");
  if (gcodeText) {
    gcodeText.value = "";
  }
  $("previewSubtitle").textContent = message;
  updateStats(null);
  renderSendButtons();
  scheduleDraw();
}

function markSliceDirty(message = "Slice required") {
  state.gcode = "";
  state.preview = null;
  state.stats = null;
  state.sliceReady = false;
  state.sliceSignature = "";
  state.sliceConfirmed = false;
  state.motionPlan = null;
  hideTaskProgress("slice");
  const gcodeText = maybe("gcodeText");
  if (gcodeText) {
    gcodeText.value = "";
  }
  $("previewSubtitle").textContent = message;
  renderSendButtons();
  scheduleDraw();
}

function resetPrepareTransform() {
  for (const artwork of state.artworks) {
    artwork.transform = null;
    artwork.preview = null;
    artwork.stats = null;
    artwork.warnings = [];
  }
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
}

function hasCurrentSlice() {
  return Boolean(state.sliceReady && state.gcode && state.sliceSignature === currentSliceSignature());
}

function confirmedSliceReady() {
  return Boolean(hasCurrentSlice() && state.sliceConfirmed);
}

function sliceBlockedByBounds() {
  return Boolean(state.artworks.length && state.prepareStats && state.prepareStats.within_bounds === false);
}

function sliceBlockLabel() {
  if (!state.prepareStats || state.prepareStats.within_bounds !== false) {
    return "";
  }
  if (state.prepareStats.within_paper === false && currentPaperArea().mode !== "full") {
    return "Off Paper";
  }
  return "Off Plate";
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function snapAngle(angle) {
  const normalized = normalizeAngle(angle);
  const snapped = Math.round(normalized / ROTATION_SNAP_INCREMENT) * ROTATION_SNAP_INCREMENT;
  const wrappedSnap = snapped % 360;
  const delta = Math.min(
    Math.abs(normalized - wrappedSnap),
    Math.abs(normalized - wrappedSnap + 360),
    Math.abs(normalized - wrappedSnap - 360),
  );
  return delta <= ROTATION_SNAP_THRESHOLD ? wrappedSnap : angle;
}

function cleanGcodeLines(gcode) {
  return String(gcode || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";") && !line.startsWith("("));
}

function stripInlineComment(line) {
  return line.replace(/\([^)]*\)/g, "").split(";")[0].trim();
}

function parseWords(line) {
  const words = {};
  const clean = stripInlineComment(line).toUpperCase();
  for (const match of clean.matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/g)) {
    words[match[1]] = Number(match[2]);
  }
  return words;
}

function normalizeMotionCommand(line) {
  const clean = stripInlineComment(line).toUpperCase();
  if (clean.startsWith("G5") || clean.startsWith("G05")) return "G5";
  if (clean.startsWith("G1") || clean.startsWith("G01")) return "G1";
  if (clean.startsWith("G0") || clean.startsWith("G00")) return "G0";
  return "";
}

function motionKey(line) {
  const command = normalizeMotionCommand(line);
  if (!command) return "";
  const words = parseWords(line);
  const parts = [command];
  for (const letter of ["X", "Y", "I", "J", "P", "Q"]) {
    if (Number.isFinite(words[letter])) {
      parts.push(`${letter}${words[letter].toFixed(3)}`);
    }
  }
  return parts.join(" ");
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointsLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function pointAlongPoints(points, fraction) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1 || fraction <= 0) return points[0];
  if (fraction >= 1) return points[points.length - 1];

  const target = pointsLength(points) * fraction;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const span = distance(a, b);
    if (walked + span >= target) {
      const t = span ? (target - walked) / span : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += span;
  }
  return points[points.length - 1];
}

function coreXYStepCount(from, to) {
  const fromDx = Math.round(-from.x * STEPS_PER_MM);
  const fromDy = Math.round(-from.y * STEPS_PER_MM);
  const toDx = Math.round(-to.x * STEPS_PER_MM);
  const toDy = Math.round(-to.y * STEPS_PER_MM);
  const fromA = fromDx + fromDy;
  const fromB = fromDx - fromDy;
  const toA = toDx + toDy;
  const toB = toDx - toDy;
  return Math.max(Math.abs(toA - fromA), Math.abs(toB - fromB));
}

function profileStepsForPoints(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += coreXYStepCount(points[i - 1], points[i]);
  }
  return total;
}

function feedFromDelayUs(delayUs) {
  const delay = Math.max(1, Number(delayUs || 50));
  return 60000000 / (delay * STEPS_PER_MM * 2);
}

function delayUsFromFeed(feed) {
  const value = Number(feed);
  if (!Number.isFinite(value) || value <= 0) {
    return 50;
  }
  return Math.max(1, 60000000 / (value * STEPS_PER_MM * 2));
}

function estimateMoveProfile(segment, line, settings = {}) {
  const distanceUnits = Math.max(Number(segment.length || 0), 0);
  const profileSteps = Math.max(Number(segment.profileSteps || 0), 0);
  if (!distanceUnits || !profileSteps) {
    return {
      distanceUnits,
      durationMs: 0,
      fractionAt: () => 1,
    };
  }

  const words = parseWords(line || segment.line || "");
  const feed = Number.isFinite(words.F)
    ? words.F
    : Number.isFinite(segment.feed)
      ? segment.feed
      : feedFromDelayUs(settings.speed_delay);
  const accelSteps = Number.isFinite(segment.accel)
    ? segment.accel
    : Math.max(8000, Number(settings.accel || 10000));

  const delayUs = delayUsFromFeed(feed);
  const stepDensity = profileSteps / distanceUnits;
  const startStepRate = 1000000 / (2 * START_STEP_DELAY);
  const maxStepRate = 1000000 / (2 * delayUs);
  const startSpeed = Math.min(startStepRate / stepDensity, maxStepRate / stepDensity);
  const maxSpeed = Math.max(maxStepRate / stepDensity, 0.001);
  const accelUnits = Math.max(accelSteps / stepDensity, 0.001);
  const accelDistance = Math.max((maxSpeed * maxSpeed - startSpeed * startSpeed) / (2 * accelUnits), 0);

  let peakSpeed = maxSpeed;
  let rampTime = 0;
  let cruiseTime = 0;
  let cruiseDistance = 0;

  if (accelDistance * 2 >= distanceUnits) {
    peakSpeed = Math.sqrt(startSpeed * startSpeed + accelUnits * distanceUnits);
    rampTime = Math.max((peakSpeed - startSpeed) / accelUnits, 0);
  } else {
    rampTime = Math.max((maxSpeed - startSpeed) / accelUnits, 0);
    cruiseDistance = distanceUnits - accelDistance * 2;
    cruiseTime = cruiseDistance / maxSpeed;
  }

  const durationS = rampTime * 2 + cruiseTime;

  return {
    distanceUnits,
    durationMs: durationS * 1000,
    feed,
    delayUs,
    stepDensity,
    accelUnits,
    startSpeed,
    maxSpeed,
    peakSpeed,
    accelDistance: cruiseTime ? accelDistance : distanceUnits / 2,
    cruiseDistance,
    cruiseTime,
    rampTime,
    fractionAt(elapsedMs) {
      const elapsedS = Math.max(0, Number(elapsedMs || 0) / 1000);
      if (elapsedS >= durationS || durationS <= 0) {
        return 1;
      }

      let traveled = 0;
      if (elapsedS <= rampTime) {
        traveled = startSpeed * elapsedS + 0.5 * accelUnits * elapsedS * elapsedS;
      } else if (elapsedS <= rampTime + cruiseTime) {
        traveled = this.accelDistance + maxSpeed * (elapsedS - rampTime);
      } else {
        const remainingS = durationS - elapsedS;
        traveled = distanceUnits - (startSpeed * remainingS + 0.5 * accelUnits * remainingS * remainingS);
      }

      return Math.max(0, Math.min(1, traveled / distanceUnits));
    },
  };
}

function buildMotionPlan(gcode) {
  const lines = cleanGcodeLines(gcode);
  const segments = [];
  let penDown = false;
  let position = { x: 0, y: 0 };
  let modalFeed = feedFromDelayUs(Number($("liveSpeedDelayInput")?.value || 50));
  let modalAccel = Number($("liveAccelInput")?.value || 10000);

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = stripInlineComment(raw).toUpperCase();
    const command = normalizeMotionCommand(line);
    const words = parseWords(line);

    if (line.startsWith("M204") && Number.isFinite(words.S)) {
      modalAccel = words.S;
      return;
    }
    if (Number.isFinite(words.F)) {
      modalFeed = words.F;
    }
    if (line.startsWith("M3")) {
      penDown = true;
      return;
    }
    if (line.startsWith("M5") || line.startsWith("M2") || line.startsWith("M30")) {
      penDown = false;
      return;
    }

    if (command === "G5") {
      const end = { x: words.X, y: words.Y };
      const c1 = { x: words.I, y: words.J };
      const c2 = { x: words.P, y: words.Q };
      if (![end.x, end.y, c1.x, c1.y, c2.x, c2.y].every(Number.isFinite)) {
        return;
      }
      const controlLength = distance(position, c1) + distance(c1, c2) + distance(c2, end);
      const samples = Math.max(8, Math.min(80, Math.ceil(controlLength / 4)));
      const points = [];
      for (let i = 0; i <= samples; i += 1) {
        const t = i / samples;
        points.push({
          x: cubicPoint(position.x, c1.x, c2.x, end.x, t),
          y: cubicPoint(position.y, c1.y, c2.y, end.y, t),
        });
      }
      segments.push({
        lineNumber,
        line,
        key: motionKey(line),
        draw: penDown,
        points,
        length: pointsLength(points),
        profileSteps: profileStepsForPoints(points),
        feed: modalFeed,
        accel: modalAccel,
      });
      position = end;
      return;
    }

    if (command === "G0" || command === "G1") {
      const end = {
        x: Number.isFinite(words.X) ? words.X : position.x,
        y: Number.isFinite(words.Y) ? words.Y : position.y,
      };
      const points = [position, end];
      segments.push({
        lineNumber,
        line,
        key: motionKey(line),
        draw: penDown && command === "G1",
        points,
        length: pointsLength(points),
        profileSteps: profileStepsForPoints(points),
        feed: modalFeed,
        accel: modalAccel,
      });
      position = end;
    }
  });

  return { lines, segments };
}

function positionAfterLine(lineNumber) {
  const plan = state.motionPlan;
  if (!plan) return { x: 0, y: 0 };
  let position = { x: 0, y: 0 };
  for (const segment of plan.segments) {
    if (segment.lineNumber > lineNumber) break;
    position = segment.points[segment.points.length - 1];
  }
  return position;
}

function currentMotionEstimate(job) {
  const plan = state.motionPlan;
  if (!plan || !plan.segments.length) {
    state.jobSim.fraction = 0;
    return state.status?.position || { x: 0, y: 0 };
  }

  if (!job?.running) {
    state.jobSim.activeLine = "";
    state.jobSim.segment = null;
    state.jobSim.profile = null;
    state.jobSim.fraction = job?.message === "Complete" ? 1 : 0;
    if (job?.message === "Complete") {
      return positionAfterLine(Number(job.current_line || 0));
    }
    return state.status?.position || positionAfterLine(Number(job?.current_line || 0));
  }

  const message = stripInlineComment(job.message || "").toUpperCase();
  const activeKey = motionKey(message);
  const segment = plan.segments.find((candidate) => (
    candidate.lineNumber > Number(job.current_line || 0) && candidate.key === activeKey
  ));

  if (!segment) {
    state.jobSim.activeLine = "";
    state.jobSim.segment = null;
    state.jobSim.profile = null;
    state.jobSim.fraction = 0;
    return state.status?.position || positionAfterLine(Number(job.current_line || 0));
  }

  const lineStartedAtMs = Number(job.line_started_at_ms || 0);
  const activeToken = `${segment.lineNumber}:${segment.line}:${lineStartedAtMs}`;
  if (state.jobSim.activeLine !== activeToken) {
    const serverTimeMs = Number(state.status?.server_time_ms || 0);
    const elapsedBeforePoll = lineStartedAtMs && serverTimeMs
      ? Math.max(0, serverTimeMs - lineStartedAtMs)
      : 0;
    const settings = state.status?.settings || {};
    const profile = estimateMoveProfile(segment, message, settings);
    state.jobSim = {
      activeLine: activeToken,
      startedAt: performance.now() - elapsedBeforePoll,
      segment,
      durationMs: profile.durationMs,
      profile,
      fraction: 0,
    };
  }

  const elapsedMs = performance.now() - state.jobSim.startedAt;
  const fraction = state.jobSim.profile
    ? state.jobSim.profile.fractionAt(elapsedMs)
    : Math.max(0, Math.min(1, elapsedMs / Math.max(state.jobSim.durationMs, 1)));
  state.jobSim.fraction = fraction;
  return pointAlongPoints(segment.points, fraction);
}

function updateRangeLabels() {
  $("liveSpeedDelayValue").textContent = `${$("liveSpeedDelayInput").value} us`;
  $("liveAccelValue").textContent = $("liveAccelInput").value;
  $("livePenUpDelayValue").textContent = `${$("livePenUpDelayInput").value} ms`;
  $("livePenUpLiftValue").textContent = `${$("livePenUpLiftInput").value}%`;
  $("livePenDownDelayValue").textContent = `${$("livePenDownDelayInput").value} ms`;
}

function renderSettings(settings = {}) {
  if (settings.speed_delay !== undefined) {
    $("liveSpeedDelayInput").value = settings.speed_delay;
  }
  if (settings.accel !== undefined) {
    $("liveAccelInput").value = settings.accel;
  }
  if (settings.pen_up_delay !== undefined) {
    $("livePenUpDelayInput").value = settings.pen_up_delay;
  }
  if (settings.pen_up_lift_percent !== undefined) {
    $("livePenUpLiftInput").value = settings.pen_up_lift_percent;
  }
  if (settings.pen_down_delay !== undefined) {
    $("livePenDownDelayInput").value = settings.pen_down_delay;
  }
  updateRangeLabels();
}

function updateStats(result) {
  const stats = result?.stats || {};
  const bounds = result?.preview?.bounds;
  $("statLines").textContent = stats.line_count ?? 0;
  $("statDrawMoves").textContent = stats.draw_moves ?? 0;
  $("statCurveMoves").textContent = stats.curve_moves ?? 0;
  $("statTravelMoves").textContent = stats.travel_moves ?? 0;
  $("statTravelSaved").textContent = stats.travel_distance_saved !== undefined
    ? `${Number(stats.travel_distance_saved).toFixed(1)}`
    : "0";
  const paper = result?.preview?.paper || stats.paper || currentPaperArea();
  $("statPaper").textContent = paper.mode === "letter"
    ? `${paper.label} ${Number(paper.width).toFixed(1)} x ${Number(paper.height).toFixed(1)}`
    : paper.label;
  $("statBounds").textContent = bounds
    ? `X${bounds.min_x}..${bounds.max_x}, Y${bounds.min_y}..${bounds.max_y}`
    : "--";

  const warningBox = $("warningBox");
  const warnings = result?.warnings || [];
  warningBox.textContent = warnings.join(" ");
  warningBox.classList.toggle("hidden", warnings.length === 0);
}

async function loadExample(kind = "square", options = {}) {
  const safeKind = kind === "circle" ? "circle" : "square";
  const response = await fetch(`/examples/${safeKind}.svg`);
  pushUndo();
  addArtwork(`${safeKind}.svg`, await response.text());
  invalidateSlice(`${safeKind === "circle" ? "Circle" : "Square"} loaded. Slice plate to preview.`);
  await refreshPreparePreview();
  if (options.goPrepare) {
    setActiveTab("prepare");
  }
}

async function refreshArtworkPreview(artwork) {
  const result = await api("/api/preview", {
    method: "POST",
    body: JSON.stringify({
      filename: artwork.fileName || "drawing.svg",
      svg_text: artwork.svgText,
      settings: settingsForArtwork(artwork),
    }),
  });

  artwork.preview = result.preview;
  artwork.stats = result.stats;
  artwork.warnings = result.warnings || [];
  if (!artwork.transform && result.stats?.transform) {
    artwork.transform = {
      scaleX: result.stats.transform.scale_x,
      scaleY: result.stats.transform.scale_y,
      offsetX: result.stats.transform.offset_x,
      offsetY: result.stats.transform.offset_y,
      rotation: result.stats.transform.rotation,
    };
  }
  return result;
}

async function refreshPreparePreview() {
  if (!state.artworks.length) {
    state.preparePreview = null;
    state.prepareStats = null;
    state.preparePreviewPending = false;
    syncLegacyArtworkFields();
    updateStats(null);
    renderSendButtons();
    scheduleDraw();
    return;
  }

  const sequence = ++state.preparePreviewSeq;
  state.preparePreviewPending = true;
  renderSendButtons();
  try {
    for (const artwork of state.artworks) {
      await refreshArtworkPreview(artwork);
    }

    if (sequence !== state.preparePreviewSeq) {
      return;
    }

    syncLegacyArtworkFields();
    rebuildPreparePreviewFromArtworks();
  } finally {
    if (sequence === state.preparePreviewSeq) {
      state.preparePreviewPending = false;
      renderSendButtons();
      scheduleDraw();
    }
  }
}

let preparePreviewTimer = 0;

function queuePreparePreview() {
  window.clearTimeout(preparePreviewTimer);
  if (state.artworks.length) {
    state.preparePreviewPending = true;
    renderSendButtons();
  }
  preparePreviewTimer = window.setTimeout(() => {
    refreshPreparePreview().catch((error) => showToast(error.message, true));
  }, 40);
}

async function slicePlate(options = {}) {
  if (!state.artworks.length) {
    await loadExample("square", { goPrepare: true });
    return;
  }

  $("sliceBtn").disabled = true;
  setTaskProgress("slice", 5, "Refreshing preview", true);

  try {
    await refreshPreparePreview();
    setTaskProgress("slice", 24, "Checking bounds", true);
    if (sliceBlockedByBounds()) {
      const message = sliceBlockLabel() === "Off Paper"
        ? "Move or scale the drawing inside the selected paper before slicing"
        : "Move or scale the drawing inside the plate before slicing";
      showToast(message, true);
      renderSendButtons();
      setActiveTab("prepare");
      hideTaskProgress("slice");
      return;
    }

    const results = [];
    const total = state.artworks.length;
    for (const [index, artwork] of state.artworks.entries()) {
      const startPercent = 30 + (index / total) * 55;
      setTaskProgress("slice", startPercent, `Slicing artwork ${index + 1} of ${total}`, true);
      results.push(await api("/api/slice", {
        method: "POST",
        body: JSON.stringify({
          filename: artwork.fileName || "drawing.svg",
          svg_text: artwork.svgText,
          settings: settingsForArtwork(artwork),
        }),
      }));
      setTaskProgress("slice", 30 + ((index + 1) / total) * 55, `Sliced artwork ${index + 1} of ${total}`, true);
    }

    setTaskProgress("slice", 90, "Building gcode", true);
    const combinedGcode = results.map((result, index) => [
      `; Artwork ${index + 1}: ${state.artworks[index].fileName}`,
      result.gcode.trim(),
    ].join("\n")).join("\n\n") + "\n";

    state.gcode = combinedGcode;
    state.preview = state.preparePreview;
    state.stats = state.prepareStats;
    state.sliceReady = true;
    state.sliceSignature = currentSliceSignature();
    state.sliceConfirmed = false;
    state.motionPlan = buildMotionPlan(state.gcode);
    state.tuningDirty = false;
    const gcodeText = maybe("gcodeText");
    if (gcodeText) {
      gcodeText.value = state.gcode;
    }
    $("previewSubtitle").textContent = `${state.stats?.line_count || 0} lines`;
    rebuildPreparePreviewFromArtworks();
    renderSendButtons();
    scheduleDraw();
    setTaskProgress("slice", 100, "Slice ready", true);
    window.setTimeout(() => {
      if (state.sliceReady) {
        hideTaskProgress("slice");
      }
    }, 1200);
    showToast("Plate sliced");
    if (options.goDevice) {
      setActiveTab("preview");
    }
  } catch (error) {
    hideTaskProgress("slice");
    throw error;
  } finally {
    renderSendButtons();
  }
}

async function connectPlotter() {
  const selected = $("portSelect").value || null;
  const data = await api("/api/connect", {
    method: "POST",
    body: JSON.stringify({ port: selected, baud: 115200 }),
  });
  state.status = data;
  renderStatus();
  showToast("Connected");
}

async function disconnectPlotter() {
  const data = await api("/api/disconnect", { method: "POST" });
  state.status = data;
  renderStatus();
  showToast("Disconnected");
}

async function ensureConnected() {
  if (state.status?.connected) {
    return;
  }
  await connectPlotter();
}

async function sendJob() {
  if (!hasCurrentSlice()) {
    showToast("Slice the plate before sending", true);
    renderSendButtons();
    return;
  }
  if (!state.sliceConfirmed) {
    setActiveTab("preview");
    showToast("Confirm the slice before sending", true);
    renderSendButtons();
    return;
  }

  setSendBusy(true);
  try {
    setActiveTab("device");
    await ensureConnected();

    if (!state.status?.home_confirmed) {
      setDeviceNotice("Move the toolhead to bottom-left X0 Y0, then press Confirm X0 Y0.", "warning");
      showToast("Confirm home before sending", true);
      return;
    }

    await api("/api/job/start", {
      method: "POST",
      body: JSON.stringify({
        gcode: state.gcode,
        confirm_home: false,
        name: state.artworks.length === 1 && state.fileName ? state.fileName.replace(/\.svg$/i, ".gcode") : "plate.gcode",
      }),
    });
    showToast("Job started");
    await pollStatus();
  } finally {
    setSendBusy(false);
  }
}

function confirmSlice() {
  if (!hasCurrentSlice()) {
    showToast("Slice the plate first", true);
    renderSendButtons();
    return;
  }
  state.sliceConfirmed = true;
  renderSendButtons();
  setActiveTab("device");
  showToast("Slice confirmed");
}

async function applyTune() {
  updateRangeLabels();
  const tune = tuneFromInputs();
  const data = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(tune),
  });
  state.status = data;
  state.tuningDirty = false;
  renderStatus();
  showToast("Motion settings applied");
}

async function sendManual(command) {
  await ensureConnected();
  await api("/api/manual", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  await pollStatus();
}

async function confirmHome() {
  const button = $("confirmHomeBtn");
  state.homeBusy = true;
  button.disabled = true;
  button.textContent = "Confirming...";
  setDeviceNotice("Connecting to firmware...", "working");
  try {
    await ensureConnected();
    setDeviceNotice("Confirming home with firmware...", "working");
    const data = await api("/api/home/confirm", { method: "POST" });
    state.status = data;
    renderStatus();
    setDeviceNotice("Home confirmed. Jogging and sending are unlocked.", "success");
    showToast("Home confirmed");
  } catch (error) {
    setDeviceNotice(error.message || "Home confirmation failed.", "error");
    throw error;
  } finally {
    state.homeBusy = false;
    button.disabled = false;
    button.textContent = "Confirm X0 Y0";
  }
}

async function jog(dx, dy) {
  await ensureConnected();
  const step = Number($("jogStepInput").value);
  const data = await api("/api/jog", {
    method: "POST",
    body: JSON.stringify({ dx: dx * step, dy: dy * step }),
  });
  state.status = data;
  renderStatus();
  scheduleDraw();
}

async function jogHome() {
  await ensureConnected();
  await api("/api/manual", {
    method: "POST",
    body: JSON.stringify({ command: "G0 X0 Y0" }),
  });
  await pollStatus();
}

async function jobAction(action) {
  if (action === "stop" && state.status?.job) {
    state.status = {
      ...state.status,
      job: {
        ...state.status.job,
        stopping: true,
        current_line: 0,
        message: "Stopping and returning home",
      },
    };
    state.jobSim.activeLine = "";
    state.jobSim.segment = null;
    state.jobSim.profile = null;
    state.jobSim.fraction = 0;
    renderStatus();
  }

  const data = await api(`/api/job/${action}`, { method: "POST" });
  state.status = data;
  if (action === "stop" && !data.job?.running && !data.job?.total_lines) {
    state.sliceConfirmed = false;
    state.jobSim.activeLine = "";
  }
  renderStatus();
}

function renderPorts(ports) {
  const select = $("portSelect");
  const current = select.value;
  select.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Auto-detect Arduino";
  select.appendChild(auto);

  for (const port of ports || []) {
    const option = document.createElement("option");
    option.value = port.device;
    option.textContent = port.description ? `${port.device} - ${port.description}` : port.device;
    select.appendChild(option);
  }

  if (current && [...select.options].some((option) => option.value === current)) {
    select.value = current;
  } else if (state.status?.port) {
    select.value = state.status.port;
  } else {
    select.value = "";
  }
}

function renderStatus() {
  const status = state.status || {};
  const connected = Boolean(status.connected);
  $("statusDot").classList.toggle("connected", connected);
  $("connectionText").textContent = connected ? "Connected" : "Disconnected";
  $("connectBtn").textContent = connected ? "Disconnect" : "Connect";
  $("devicePort").textContent = status.port || "--";
  $("deviceHome").textContent = status.home_confirmed ? "Yes" : "No";
  $("deviceX").textContent = Number(status.position?.x || 0).toFixed(2);
  $("deviceY").textContent = Number(status.position?.y || 0).toFixed(2);
  $("deviceXMax").textContent = MACHINE_X_MAX.toFixed(2);
  $("deviceYMax").textContent = MACHINE_Y_MAX.toFixed(2);
  renderHomeNotice(status);
  if (!state.tuningDirty) {
    renderSettings(status.settings || {});
  }

  renderPorts(status.ports || []);
  renderJob(status.job || {});
  renderPenState(status.pen_state || "off");
  renderControlLocks(status.job || {});
  renderLogs(status.logs || []);
  scheduleDraw();
}

function renderJob(job) {
  if (!job.running && !Number(job.total_lines || 0) && job.message === "Stopped and reset") {
    state.sliceConfirmed = false;
    state.jobSim.activeLine = "";
  }

  const total = Number(job.total_lines || 0);
  const current = Number(job.current_line || 0);
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  $("jobProgress").style.width = `${percent}%`;
  $("deviceJobProgress").style.width = `${percent}%`;
  $("jobName").textContent = job.running ? job.name || "Running" : job.message || "Idle";
  $("deviceJobName").textContent = job.running ? job.name || "Running" : job.message || "Idle";
  $("jobMessage").textContent = job.running ? `${current}/${total} ${job.message || ""}` : "";
  $("deviceJobMessage").textContent = job.running ? `${current}/${total} ${job.message || ""}` : "";
  renderSendButtons();
}

function renderPenState(penState) {
  document.querySelectorAll("[data-pen-state]").forEach((button) => {
    const active = button.dataset.penState === penState;
    button.classList.toggle("active", active);
  });
}

function setDeviceNotice(message, type = "warning") {
  const notice = $("deviceNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.className = `device-notice ${type}`;
}

function renderHomeNotice(status) {
  const notice = $("deviceNotice");
  if (!notice) return;
  if (state.homeBusy) {
    return;
  }
  if (!status.connected) {
    setDeviceNotice("Connect to the Arduino before homing.", "warning");
  } else if (status.home_confirmed) {
    setDeviceNotice("Home confirmed. Jogging and sending are unlocked.", "success");
  } else {
    setDeviceNotice("Move to X0 Y0, then confirm home.", "warning");
  }
}

function setSendBusy(isBusy) {
  state.sendBusy = isBusy;
  renderSendButtons();
}

function renderSendButtons() {
  const isRunning = Boolean(state.status?.job?.running);
  const hasSlice = hasCurrentSlice();
  const canSend = confirmedSliceReady();
  const sliceButton = maybe("sliceBtn");
  if (sliceButton) {
    const offPlate = sliceBlockedByBounds();
    sliceButton.disabled = isRunning || !state.artworks.length || offPlate || state.preparePreviewPending;
    sliceButton.textContent = state.preparePreviewPending
      ? "Checking..."
      : offPlate
        ? sliceBlockLabel()
        : "Slice Plate";
    sliceButton.title = offPlate
      ? "Move or scale the drawing inside the selected paper/canvas before slicing."
      : "";
  }

  const confirmButton = maybe("confirmSliceBtn");
  if (confirmButton) {
    confirmButton.disabled = state.sendBusy || isRunning || !hasSlice;
    confirmButton.textContent = state.sliceConfirmed && hasSlice ? "Slice Confirmed" : "Confirm Slice";
  }

  for (const id of ["deviceSendBtn"]) {
    const button = $(id);
    if (!button) continue;
    button.disabled = state.sendBusy || isRunning || !canSend;
    button.textContent = state.sendBusy ? "Sending..." : isRunning ? "Running..." : !hasSlice ? "Slice First" : !state.sliceConfirmed ? "Confirm Slice First" : "Send To Plotter";
  }
}

function renderControlLocks(job) {
  const controlsLocked = Boolean(job.running && !job.paused);
  document.querySelectorAll(".jog-button, .jog-home, .manual-cmd, #manualSendBtn, #confirmHomeBtn").forEach((control) => {
    control.disabled = controlsLocked || state.homeBusy;
  });
  const manualInput = $("manualCommandInput");
  if (manualInput) {
    manualInput.disabled = controlsLocked;
  }
}

function renderLogs(logs) {
  const view = $("logView");
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 24;
  view.innerHTML = "";

  for (const line of logs) {
    const row = document.createElement("div");
    row.className = "log-line";
    row.innerHTML = `
      <span class="time">${line.time}</span>
      <span class="dir ${line.direction}">${line.direction}</span>
      <span>${escapeHtml(line.text)}</span>
    `;
    view.appendChild(row);
  }

  if (atBottom) {
    view.scrollTop = view.scrollHeight;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let drawQueued = false;

function scheduleDraw() {
  if (drawQueued) {
    return;
  }
  drawQueued = true;
  window.requestAnimationFrame(() => {
    drawQueued = false;
    drawAllCanvases();
  });
}

function drawAllCanvases() {
  drawPlate($("plateCanvas"), { source: "prepare", showPosition: false, showMargin: true, showSelection: true });
  drawPlate($("previewCanvas"), { source: "slice", showPosition: false, showMargin: true });
  drawJobMiniMap();
}

function plateMetrics(canvas) {
  const rect = canvas.getBoundingClientRect();
  const xMax = MACHINE_X_MAX;
  const yMax = MACHINE_Y_MAX;
  const pad = 42;
  const scale = Math.min((rect.width - pad * 2) / xMax, (rect.height - pad * 2) / yMax);
  const bedW = xMax * scale;
  const bedH = yMax * scale;
  const ox = (rect.width - bedW) / 2;
  const oy = (rect.height - bedH) / 2;
  return { rect, xMax, yMax, pad, scale, bedW, bedH, ox, oy };
}

function machineToCanvas(metrics, x, y) {
  return [metrics.ox + x * metrics.scale, metrics.oy + metrics.bedH - y * metrics.scale];
}

function canvasToMachine(canvas, clientX, clientY) {
  const metrics = plateMetrics(canvas);
  const x = (clientX - metrics.rect.left - metrics.ox) / metrics.scale;
  const y = (metrics.oy + metrics.bedH - (clientY - metrics.rect.top)) / metrics.scale;
  return { x, y };
}

function paperForPreview(preview) {
  return preview?.paper || currentPaperArea();
}

function paperMarginForPreview(preview) {
  return Number(preview?.margin ?? $("marginInput").value);
}

function paperRectToCanvas(metrics, paper) {
  const x = metrics.ox + paper.x_min * metrics.scale;
  const y = metrics.oy + metrics.bedH - paper.y_max * metrics.scale;
  const width = (paper.x_max - paper.x_min) * metrics.scale;
  const height = (paper.y_max - paper.y_min) * metrics.scale;
  return { x, y, width, height };
}

function drawPaperOverlay(ctx, metrics, paper, margin, showMargin) {
  const rect = paperRectToCanvas(metrics, paper);
  const bedRight = metrics.ox + metrics.bedW;
  const bedBottom = metrics.oy + metrics.bedH;

  if (paper.mode !== "full") {
    ctx.fillStyle = "rgba(31, 41, 51, 0.16)";
    ctx.fillRect(metrics.ox, metrics.oy, metrics.bedW, Math.max(0, rect.y - metrics.oy));
    ctx.fillRect(metrics.ox, rect.y + rect.height, metrics.bedW, Math.max(0, bedBottom - (rect.y + rect.height)));
    ctx.fillRect(metrics.ox, rect.y, Math.max(0, rect.x - metrics.ox), rect.height);
    ctx.fillRect(rect.x + rect.width, rect.y, Math.max(0, bedRight - (rect.x + rect.width)), rect.height);
  }

  if (showMargin && margin > 0) {
    const marginPx = Math.min(margin * metrics.scale, rect.width / 2, rect.height / 2);
    ctx.fillStyle = "rgba(31, 41, 51, 0.10)";
    ctx.fillRect(rect.x, rect.y, rect.width, marginPx);
    ctx.fillRect(rect.x, rect.y + rect.height - marginPx, rect.width, marginPx);
    ctx.fillRect(rect.x, rect.y + marginPx, marginPx, Math.max(0, rect.height - marginPx * 2));
    ctx.fillRect(rect.x + rect.width - marginPx, rect.y + marginPx, marginPx, Math.max(0, rect.height - marginPx * 2));

    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#8793a0";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      rect.x + marginPx,
      rect.y + marginPx,
      Math.max(0, rect.width - marginPx * 2),
      Math.max(0, rect.height - marginPx * 2),
    );
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = paper.mode === "full" ? "#cfd6dd" : "#26313d";
  ctx.lineWidth = paper.mode === "full" ? 1 : 1.4;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawPlate(canvas, options = {}) {
  if (!canvas || canvas.offsetParent === null) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
  const targetHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const metrics = plateMetrics(canvas);
  const { xMax, yMax, scale, bedW, bedH, ox, oy } = metrics;
  const preview = options.source === "prepare" ? state.preparePreview : state.preview;
  const paper = paperForPreview(preview);
  const margin = paperMarginForPreview(preview);
  if (canvas.id === "plateCanvas") {
    $("plateSubtitle").textContent = paper.mode === "letter"
      ? `${paper.label} ${Number(paper.width).toFixed(1)} x ${Number(paper.height).toFixed(1)} centered on ${xMax} x ${yMax}`
      : `${xMax} x ${yMax} full canvas`;
  }
  const toCanvas = (x, y) => machineToCanvas(metrics, x, y);

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cfd6dd";
  ctx.lineWidth = 1;
  roundRect(ctx, ox, oy, bedW, bedH, 8);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, bedW, bedH);
  ctx.clip();

  ctx.strokeStyle = "#e3e7eb";
  ctx.lineWidth = 1;
  for (let x = 50; x < xMax; x += 50) {
    const [cx] = toCanvas(x, 0);
    ctx.beginPath();
    ctx.moveTo(cx, oy);
    ctx.lineTo(cx, oy + bedH);
    ctx.stroke();
  }
  for (let y = 50; y < yMax; y += 50) {
    const [, cy] = toCanvas(0, y);
    ctx.beginPath();
    ctx.moveTo(ox, cy);
    ctx.lineTo(ox + bedW, cy);
    ctx.stroke();
  }

  drawPaperOverlay(ctx, metrics, paper, margin, options.showMargin);

  const paths = preview?.paths || [];
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const path of paths) {
    if (path.length < 2) continue;
    ctx.beginPath();
    const [startX, startY] = toCanvas(path[0][0], path[0][1]);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < path.length; i += 1) {
      const [px, py] = toCanvas(path[i][0], path[i][1]);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const pos = options.showPosition ? state.status?.position : null;
  if (pos) {
    const [px, py] = toCanvas(Number(pos.x || 0), Number(pos.y || 0));
    ctx.fillStyle = "#b76e00";
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (options.showSelection && preview?.selection) {
    drawPrepareSelection(ctx, toCanvas, preview.selection);
  }

  const [hx, hy] = toCanvas(0, 0);
  const [cx, cy] = toCanvas(xMax / 2, yMax / 2);
  ctx.fillStyle = "#26313d";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText("X0 Y0", hx + 8, hy - 8);
  ctx.fillText("Center", cx + 8, cy - 8);
}

function drawPrepareSelection(ctx, toCanvas, selection) {
  ctx.save();
  ctx.strokeStyle = "#2463eb";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  selection.corners.forEach((corner, index) => {
    const [x, y] = toCanvas(corner.x, corner.y);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  for (const handle of selection.handles) {
    const [cx, cy] = toCanvas(handle.x, handle.y);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2463eb";
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - 4, cy - 4, 8, 8);
    ctx.strokeRect(cx - 4, cy - 4, 8, 8);
  }

  const topHandle = selection.handles.find((handle) => handle.name === "n");
  const rotateHandle = selection.rotate_handle;
  const [rx, ry] = toCanvas(rotateHandle.x, rotateHandle.y);
  ctx.beginPath();
  if (topHandle) {
    const [tx, ty] = toCanvas(topHandle.x, topHandle.y);
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rx, ry, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.stroke();

  if (state.prepareInteraction?.type === "rotate") {
    const label = `${Math.round(normalizeAngle(selectedArtwork()?.transform?.rotation || selection.rotation || 0))} deg`;
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = "#174ea6";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.strokeText(label, rx + 10, ry - 10);
    ctx.fillText(label, rx + 10, ry - 10);
  }
  ctx.restore();
}

function selectionPolygonForCanvas(metrics, selection) {
  return selection.corners.map((corner) => {
    const [x, y] = machineToCanvas(metrics, corner.x, corner.y);
    return { x, y };
  });
}

function prepareHitTest(canvas, event) {
  const metrics = plateMetrics(canvas);
  const localX = event.clientX - metrics.rect.left;
  const localY = event.clientY - metrics.rect.top;
  const hitSize = 12;
  const selected = selectedArtwork();
  const selection = selected?.preview?.selection || null;

  if (selection) {
    for (const handle of selection.handles) {
      const [cx, cy] = machineToCanvas(metrics, handle.x, handle.y);
      if (Math.abs(localX - cx) <= hitSize && Math.abs(localY - cy) <= hitSize) {
        return { type: "resize", handle: handle.name, artworkId: selected.id };
      }
    }

    const [rotateX, rotateY] = machineToCanvas(metrics, selection.rotate_handle.x, selection.rotate_handle.y);
    if (Math.hypot(localX - rotateX, localY - rotateY) <= 12) {
      return { type: "rotate", artworkId: selected.id };
    }

    if (pointInPolygon({ x: localX, y: localY }, selectionPolygonForCanvas(metrics, selection))) {
      return { type: "move", artworkId: selected.id };
    }
  }

  for (let i = state.artworks.length - 1; i >= 0; i -= 1) {
    const artwork = state.artworks[i];
    const candidate = artwork.preview?.selection;
    if (!candidate) continue;
    if (pointInPolygon({ x: localX, y: localY }, selectionPolygonForCanvas(metrics, candidate))) {
      return { type: "move", artworkId: artwork.id };
    }
  }

  return { type: "clear" };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.0001) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function selectionLocalPoint(selection, point) {
  const angle = -((selection.rotation || 0) * Math.PI) / 180;
  const dx = point.x - selection.center.x;
  const dy = point.y - selection.center.y;
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function worldPointFromSelectionLocal(selection, local) {
  const angle = ((selection.rotation || 0) * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return {
    x: selection.center.x + local.x * cosA - local.y * sinA,
    y: selection.center.y + local.x * sinA + local.y * cosA,
  };
}

function resizeTransformFromHandle(interaction, mouse, keepRatio) {
  const handle = interaction.handle;
  const snappedMouse = snapResizeMouseToPaperEdges(interaction, mouse);
  const local = selectionLocalPoint(interaction.selection, snappedMouse);
  const width = Math.max(0.001, interaction.selection.width);
  const height = Math.max(0.001, interaction.selection.height);
  const halfW = width / 2;
  const halfH = height / 2;
  const affectsX = handle.includes("e") || handle.includes("w");
  const affectsY = handle.includes("n") || handle.includes("s");
  const minW = width * 0.05;
  const minH = height * 0.05;
  let left = -halfW;
  let right = halfW;
  let bottom = -halfH;
  let top = halfH;

  if (handle.includes("e")) {
    right = Math.max(local.x, left + minW);
  } else if (handle.includes("w")) {
    left = Math.min(local.x, right - minW);
  }

  if (handle.includes("n")) {
    top = Math.max(local.y, bottom + minH);
  } else if (handle.includes("s")) {
    bottom = Math.min(local.y, top - minH);
  }

  if (keepRatio) {
    const ratio = width / height;
    let newW = right - left;
    let newH = top - bottom;
    if (affectsX && affectsY) {
      const scale = Math.max(newW / width, newH / height);
      newW = width * scale;
      newH = height * scale;
    } else if (affectsX) {
      newH = newW / ratio;
    } else if (affectsY) {
      newW = newH * ratio;
    }

    if (handle.includes("e")) right = left + newW;
    if (handle.includes("w")) left = right - newW;
    if (handle.includes("n")) top = bottom + newH;
    if (handle.includes("s")) bottom = top - newH;
    if (!affectsY) {
      bottom = -newH / 2;
      top = newH / 2;
    }
    if (!affectsX) {
      left = -newW / 2;
      right = newW / 2;
    }
  }

  const newWidth = Math.max(0.001, right - left);
  const newHeight = Math.max(0.001, top - bottom);
  const localCenter = {
    x: (left + right) / 2,
    y: (bottom + top) / 2,
  };
  const center = worldPointFromSelectionLocal(interaction.selection, localCenter);
  return {
    ...interaction.transform,
    scaleX: Math.max(0.001, interaction.transform.scaleX * (newWidth / width)),
    scaleY: Math.max(0.001, interaction.transform.scaleY * (newHeight / height)),
    offsetX: center.x,
    offsetY: center.y,
  };
}

function makeSelectionFromTransform(baseSelection, baseTransform, transform) {
  const sourceWidth = baseSelection.width / Math.max(baseTransform.scaleX, 0.0001);
  const sourceHeight = baseSelection.height / Math.max(baseTransform.scaleY, 0.0001);
  const width = sourceWidth * transform.scaleX;
  const height = sourceHeight * transform.scaleY;
  const angle = (transform.rotation * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const center = { x: transform.offsetX, y: transform.offsetY };

  const rotate = (localX, localY) => ({
    x: center.x + localX * cosA - localY * sinA,
    y: center.y + localX * sinA + localY * cosA,
  });

  const halfW = width / 2;
  const halfH = height / 2;
  const handleDefs = [
    ["nw", -halfW, halfH],
    ["n", 0, halfH],
    ["ne", halfW, halfH],
    ["e", halfW, 0],
    ["se", halfW, -halfH],
    ["s", 0, -halfH],
    ["sw", -halfW, -halfH],
    ["w", -halfW, 0],
  ];

  return {
    center,
    width,
    height,
    rotation: transform.rotation,
    corners: [
      rotate(-halfW, halfH),
      rotate(halfW, halfH),
      rotate(halfW, -halfH),
      rotate(-halfW, -halfH),
    ],
    handles: handleDefs.map(([name, x, y]) => ({ name, ...rotate(x, y) })),
    rotate_handle: rotate(0, halfH + 30),
  };
}

function selectionBounds(selection) {
  const xs = selection.corners.map((corner) => corner.x);
  const ys = selection.corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function snapTransformToPaperEdges(baseSelection, baseTransform, transform) {
  const paper = currentPaperArea();
  const margin = Math.max(0, Number($("marginInput").value || 0));
  const usable = {
    xMin: paper.x_min + margin,
    xMax: paper.x_max - margin,
    yMin: paper.y_min + margin,
    yMax: paper.y_max - margin,
  };
  const targetsX = [
    paper.x_min,
    paper.x_max,
    ...(usable.xMin <= usable.xMax ? [usable.xMin, usable.xMax] : []),
  ];
  const targetsY = [
    paper.y_min,
    paper.y_max,
    ...(usable.yMin <= usable.yMax ? [usable.yMin, usable.yMax] : []),
  ];

  const selection = makeSelectionFromTransform(baseSelection, baseTransform, transform);
  const bounds = selectionBounds(selection);
  let snapDx = 0;
  let snapDy = 0;
  let bestX = EDGE_SNAP_THRESHOLD;
  let bestY = EDGE_SNAP_THRESHOLD;

  for (const edge of [bounds.minX, bounds.maxX]) {
    for (const target of targetsX) {
      const delta = target - edge;
      if (Math.abs(delta) < Math.abs(bestX)) {
        bestX = delta;
        snapDx = delta;
      }
    }
  }

  for (const edge of [bounds.minY, bounds.maxY]) {
    for (const target of targetsY) {
      const delta = target - edge;
      if (Math.abs(delta) < Math.abs(bestY)) {
        bestY = delta;
        snapDy = delta;
      }
    }
  }

  return {
    ...transform,
    offsetX: transform.offsetX + snapDx,
    offsetY: transform.offsetY + snapDy,
  };
}

function snapResizeMouseToPaperEdges(interaction, mouse) {
  const paper = currentPaperArea();
  const margin = Math.max(0, Number($("marginInput").value || 0));
  const usable = {
    xMin: paper.x_min + margin,
    xMax: paper.x_max - margin,
    yMin: paper.y_min + margin,
    yMax: paper.y_max - margin,
  };
  const targetsX = [
    paper.x_min,
    paper.x_max,
    ...(usable.xMin <= usable.xMax ? [usable.xMin, usable.xMax] : []),
  ];
  const targetsY = [
    paper.y_min,
    paper.y_max,
    ...(usable.yMin <= usable.yMax ? [usable.yMin, usable.yMax] : []),
  ];
  const snapped = { ...mouse };

  if (interaction.handle.includes("e") || interaction.handle.includes("w")) {
    for (const target of targetsX) {
      if (Math.abs(mouse.x - target) <= EDGE_SNAP_THRESHOLD) {
        snapped.x = target;
        break;
      }
    }
  }

  if (interaction.handle.includes("n") || interaction.handle.includes("s")) {
    for (const target of targetsY) {
      if (Math.abs(mouse.y - target) <= EDGE_SNAP_THRESHOLD) {
        snapped.y = target;
        break;
      }
    }
  }

  return snapped;
}

function beginPrepareInteraction(event) {
  const canvas = $("plateCanvas");
  const hit = prepareHitTest(canvas, event);
  if (!hit) {
    return;
  }

  if (hit.type === "clear") {
    if (state.selectedArtworkId !== null) {
      setSelectedArtwork(null);
    }
    return;
  }

  if (hit.artworkId !== state.selectedArtworkId) {
    setSelectedArtwork(hit.artworkId);
  }

  const artwork = selectedArtwork();
  const selection = artwork?.preview?.selection || null;
  if (!artwork || !artwork.transform || !selection) {
    return;
  }

  event.preventDefault();
  pushUndo();
  canvas.setPointerCapture(event.pointerId);
  const mouse = canvasToMachine(canvas, event.clientX, event.clientY);
  const center = selection.center;

  state.prepareInteraction = {
    pointerId: event.pointerId,
    artworkId: artwork.id,
    type: hit.type,
    handle: hit.handle || "",
    mouse,
    center,
    selection: JSON.parse(JSON.stringify(selection)),
    transform: { ...artwork.transform },
    angle: Math.atan2(mouse.y - center.y, mouse.x - center.x),
  };
}

function updatePrepareInteraction(event) {
  const interaction = state.prepareInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const canvas = $("plateCanvas");
  const mouse = canvasToMachine(canvas, event.clientX, event.clientY);
  const next = { ...interaction.transform };
  const artwork = artworkById(interaction.artworkId);
  if (!artwork) {
    return;
  }

  if (interaction.type === "move") {
    next.offsetX = interaction.transform.offsetX + (mouse.x - interaction.mouse.x);
    next.offsetY = interaction.transform.offsetY + (mouse.y - interaction.mouse.y);
  }

  if (interaction.type === "resize") {
    Object.assign(next, resizeTransformFromHandle(interaction, mouse, event.shiftKey));
  }

  if (interaction.type === "rotate") {
    const angle = Math.atan2(mouse.y - interaction.center.y, mouse.x - interaction.center.x);
    const rawRotation = interaction.transform.rotation + ((angle - interaction.angle) * 180) / Math.PI;
    next.rotation = snapAngle(rawRotation);
  }

  const snapped = interaction.type === "move"
    ? snapTransformToPaperEdges(interaction.selection, interaction.transform, next)
    : next;

  artwork.transform = snapped;
  artwork.preview.selection = makeSelectionFromTransform(
    interaction.selection,
    interaction.transform,
    snapped,
  );
  syncLegacyArtworkFields();
  rebuildPreparePreviewFromArtworks();
  $("fitToBed").checked = false;
  markSliceDirty("Placement changed. Slice plate again.");
  queuePreparePreview();
}

function endPrepareInteraction(event) {
  const interaction = state.prepareInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }
  state.prepareInteraction = null;
  refreshPreparePreview().catch((error) => showToast(error.message, true));
}

function drawJobMiniMap() {
  const wrap = maybe("jobMiniMapWrap");
  const canvas = maybe("jobMiniMap");
  const job = state.status?.job || {};
  const visible = Boolean(state.motionPlan && state.motionPlan.segments.length && (state.sliceConfirmed || job.running || job.total_lines));

  if (!wrap || !canvas) {
    return;
  }

  wrap.classList.toggle("hidden", !visible);
  if (!visible || canvas.offsetParent === null) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
  const targetHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = 16;
  const scale = Math.min((rect.width - pad * 2) / MACHINE_X_MAX, (rect.height - pad * 2) / MACHINE_Y_MAX);
  const bedW = MACHINE_X_MAX * scale;
  const bedH = MACHINE_Y_MAX * scale;
  const ox = (rect.width - bedW) / 2;
  const oy = (rect.height - bedH) / 2;
  const metrics = { ox, oy, bedW, bedH, scale };
  const toCanvas = (point) => [ox + point.x * scale, oy + bedH - point.y * scale];

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d6dbe0";
  ctx.lineWidth = 1;
  roundRect(ctx, ox, oy, bedW, bedH, 6);
  ctx.fill();
  ctx.stroke();

  drawPaperOverlay(ctx, metrics, paperForPreview(state.preview), paperMarginForPreview(state.preview), true);

  const completedLine = job.message === "Complete"
    ? Number(job.total_lines || job.current_line || 0)
    : Number(job.current_line || 0);
  const activePosition = currentMotionEstimate(job);
  const activeKey = state.jobSim.segment ? `${state.jobSim.segment.lineNumber}:${state.jobSim.segment.line}` : "";
  const activeFraction = state.jobSim.fraction || 0;

  drawMinimapSegments(ctx, toCanvas, completedLine, activeKey, activeFraction, false);
  drawMinimapSegments(ctx, toCanvas, completedLine, activeKey, activeFraction, true);

  const [hx, hy] = toCanvas(activePosition);
  ctx.fillStyle = "#b76e00";
  ctx.beginPath();
  ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (job.running) {
    ensureJobMapAnimation();
  }
}

function drawMinimapSegments(ctx, toCanvas, completedLine, activeKey, activeFraction, drawnPass) {
  const plan = state.motionPlan;
  if (!plan) return;

  ctx.lineWidth = drawnPass ? 2.2 : 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = drawnPass ? "#0f766e" : "#c9d1d8";

  for (const segment of plan.segments) {
    if (!segment.draw) continue;
    const segmentKey = `${segment.lineNumber}:${segment.line}`;
    const isDone = segment.lineNumber <= completedLine || state.status?.job?.message === "Complete";
    const isActive = segmentKey === activeKey;

    let points = segment.points;
    if (drawnPass) {
      if (!isDone && !isActive) continue;
      if (isActive && !isDone) {
        points = pointsUntilFraction(segment.points, activeFraction);
      }
    } else if (isDone) {
      continue;
    }

    if (points.length < 2) continue;
    ctx.beginPath();
    const [startX, startY] = toCanvas(points[0]);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < points.length; i += 1) {
      const [x, y] = toCanvas(points[i]);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function pointsUntilFraction(points, fraction) {
  if (points.length < 2) return points;
  const targetLength = pointsLength(points) * Math.max(0, Math.min(1, fraction));
  const partial = [points[0]];
  let walked = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const span = distance(a, b);
    if (walked + span >= targetLength) {
      const t = span ? (targetLength - walked) / span : 0;
      partial.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return partial;
    }
    partial.push(b);
    walked += span;
  }
  return partial;
}

let jobMapAnimationQueued = false;

function ensureJobMapAnimation() {
  if (jobMapAnimationQueued) return;
  jobMapAnimationQueued = true;
  window.requestAnimationFrame(() => {
    jobMapAnimationQueued = false;
    if (state.status?.job?.running) {
      drawJobMiniMap();
      ensureJobMapAnimation();
    }
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function pollStatus() {
  try {
    state.status = await api("/api/status");
    renderStatus();
  } catch (error) {
    console.warn(error);
  }
}

function setActiveTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${name}Panel`);
  });
  scheduleDraw();
}

function readFileForPlotter(file) {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read file")));
    reader.readAsDataURL(file);
  });
}

function isSvgFile(file) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function traceSettingsFromInputs() {
  return {
    trace_mode: $("traceModeInput").value,
    threshold: Number($("traceThresholdInput").value),
    simplify_px: Number($("traceSpacingInput").value),
    max_side: Number($("traceSizeInput").value),
    min_path_px: Number($("traceMinPathInput").value),
    link_gap_px: Number($("traceLinkGapInput").value),
  };
}

function updateTraceLabels() {
  $("traceThresholdValue").textContent = $("traceThresholdInput").value;
  $("traceSpacingValue").textContent = `${$("traceSpacingInput").value} px`;
  $("traceSizeValue").textContent = `${$("traceSizeInput").value} px`;
  $("traceMinPathValue").textContent = `${$("traceMinPathInput").value} px`;
  $("traceLinkGapValue").textContent = `${$("traceLinkGapInput").value} px`;
}

function resetTraceControls() {
  $("traceModeInput").value = TRACE_DEFAULTS.mode;
  $("traceThresholdInput").value = TRACE_DEFAULTS.threshold;
  $("traceSpacingInput").value = TRACE_DEFAULTS.simplify;
  $("traceSizeInput").value = TRACE_DEFAULTS.size;
  $("traceMinPathInput").value = TRACE_DEFAULTS.minPath;
  $("traceLinkGapInput").value = TRACE_DEFAULTS.linkGap;
  updateTraceLabels();
}

function abortActiveRasterTrace() {
  if (state.import.abortController) {
    state.import.abortController.abort();
    state.import.abortController = null;
  }
}

function setImportStatus(message, isError = false) {
  const status = $("importStatus");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setTaskProgress(prefix, percent, label, visible = true) {
  const wrap = maybe(`${prefix}ProgressWrap`);
  const fill = maybe(`${prefix}ProgressFill`);
  const labelEl = maybe(`${prefix}ProgressLabel`);
  const valueEl = maybe(`${prefix}ProgressValue`);
  if (!wrap || !fill || !labelEl || !valueEl) return;

  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  wrap.classList.toggle("hidden", !visible);
  fill.style.width = `${clamped.toFixed(0)}%`;
  labelEl.textContent = label;
  valueEl.textContent = `${clamped.toFixed(0)}%`;
}

function hideTaskProgress(prefix) {
  setTaskProgress(prefix, 0, "", false);
}

function startTraceProgress() {
  window.clearInterval(state.import.progressTimer);
  state.import.progressStartedAt = performance.now();
  const stages = [
    { at: 0, label: "Loading image" },
    { at: 12, label: "Normalizing contrast" },
    { at: 28, label: "Detecting edges" },
    { at: 48, label: "Finding contours" },
    { at: 68, label: "Cleaning paths" },
    { at: 84, label: "Building svg" },
  ];

  const tick = () => {
    const elapsed = performance.now() - state.import.progressStartedAt;
    const eased = 92 * (1 - Math.exp(-elapsed / 3800));
    const stage = stages.reduce((best, item) => (item.at <= eased ? item : best), stages[0]);
    setTaskProgress("trace", eased, stage.label, true);
  };

  tick();
  state.import.progressTimer = window.setInterval(tick, 140);
}

function stopTraceProgress(percent = 0, label = "", visible = false) {
  window.clearInterval(state.import.progressTimer);
  state.import.progressTimer = 0;
  setTaskProgress("trace", percent, label, visible);
}

function setTracePreview(svgText) {
  if (state.import.tracePreviewUrl) {
    URL.revokeObjectURL(state.import.tracePreviewUrl);
  }
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  state.import.tracePreviewUrl = URL.createObjectURL(blob);
  $("importTracePreview").src = state.import.tracePreviewUrl;
}

async function updateRasterTracePreview() {
  if (!state.import.open || !state.import.imageData) {
    return;
  }

  const sequence = ++state.import.seq;
  abortActiveRasterTrace();
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), TRACE_REQUEST_TIMEOUT_MS);
  state.import.abortController = abortController;
  state.import.pending = true;
  $("importConfirmBtn").disabled = true;
  setImportStatus("Tracing...");
  startTraceProgress();

  try {
    const result = await api("/api/raster/trace", {
      method: "POST",
      body: JSON.stringify({
        filename: state.import.fileName,
        image_data: state.import.imageData,
        ...traceSettingsFromInputs(),
      }),
      signal: abortController.signal,
    });

    if (sequence !== state.import.seq) {
      return;
    }

    state.import.traceSvg = result.svg_text;
    state.import.traceFileName = result.filename;
    setTracePreview(result.svg_text);
    setImportStatus(`${result.path_count} paths traced`);
    stopTraceProgress(100, "Trace ready", true);
  } catch (error) {
    if (error.name === "AbortError") {
      if (sequence === state.import.seq) {
        state.import.traceSvg = "";
        state.import.traceFileName = "";
        $("importTracePreview").removeAttribute("src");
        setImportStatus("Trace stopped. Lower Trace size, raise threshold, or increase Min stroke.", true);
        stopTraceProgress(0, "Trace stopped", false);
      }
      return;
    }
    if (sequence === state.import.seq) {
      state.import.traceSvg = "";
      state.import.traceFileName = "";
      $("importTracePreview").removeAttribute("src");
      setImportStatus(error.message || "Trace failed", true);
      stopTraceProgress(0, "Trace failed", false);
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (state.import.abortController === abortController) {
      state.import.abortController = null;
    }
    if (sequence === state.import.seq) {
      state.import.pending = false;
      $("importConfirmBtn").disabled = !state.import.traceSvg;
    }
  }
}

let rasterTraceTimer = 0;

function queueRasterTracePreview() {
  updateTraceLabels();
  state.import.seq += 1;
  abortActiveRasterTrace();
  stopTraceProgress(0, "Tracing...", state.import.open);
  state.import.traceSvg = "";
  state.import.traceFileName = "";
  $("importConfirmBtn").disabled = true;
  if (state.import.open) {
    setImportStatus("Tracing...");
  }
  window.clearTimeout(rasterTraceTimer);
  rasterTraceTimer = window.setTimeout(() => {
    updateRasterTracePreview().catch((error) => setImportStatus(error.message, true));
  }, 120);
}

function openRasterImportModal(file, imageData) {
  abortActiveRasterTrace();
  resetTraceControls();
  state.import = {
    open: true,
    fileName: file.name,
    imageData,
    traceSvg: "",
    traceFileName: "",
    tracePreviewUrl: state.import.tracePreviewUrl,
    abortController: null,
    seq: state.import.seq,
    pending: false,
  };
  $("importSubtitle").textContent = file.name;
  $("importOriginalPreview").src = imageData;
  $("importTracePreview").removeAttribute("src");
  $("importConfirmBtn").disabled = true;
  updateTraceLabels();
  setImportStatus("Tracing...");
  $("importModal").classList.remove("hidden");
  $("importModal").setAttribute("aria-hidden", "false");
  queueRasterTracePreview();
}

function closeRasterImportModal() {
  abortActiveRasterTrace();
  window.clearTimeout(rasterTraceTimer);
  stopTraceProgress();
  state.import.open = false;
  state.import.seq += 1;
  if (state.import.tracePreviewUrl) {
    URL.revokeObjectURL(state.import.tracePreviewUrl);
  }
  state.import.tracePreviewUrl = "";
  state.import.traceSvg = "";
  state.import.traceFileName = "";
  state.import.pending = false;
  $("importModal").classList.add("hidden");
  $("importModal").setAttribute("aria-hidden", "true");
  $("importOriginalPreview").removeAttribute("src");
  $("importTracePreview").removeAttribute("src");
}

async function confirmRasterImport() {
  if (!state.import.traceSvg && !state.import.pending) {
    await updateRasterTracePreview();
  }
  if (!state.import.traceSvg) {
    showToast("Trace the image before importing", true);
    return;
  }

  state.svgText = state.import.traceSvg;
  state.fileName = state.import.traceFileName || `${state.import.fileName.replace(/\.[^.]+$/, "")}_trace.svg`;
  pushUndo();
  addArtwork(state.fileName, state.svgText);
  invalidateSlice("Image imported. Slice plate to preview.");
  closeRasterImportModal();
  await refreshPreparePreview().catch((error) => showToast(error.message, true));
}

function isEditingText(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function handleGlobalKeys(event) {
  if (state.import.open || isEditingText(event)) {
    return;
  }

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (mod && key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }

  if (mod && key === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if ((event.key === "Backspace" || event.key === "Delete") && state.selectedArtworkId !== null) {
    event.preventDefault();
    deleteSelectedArtwork();
  }
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  $("openFileBtn").addEventListener("click", () => $("svgInput").click());

  $("svgInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const content = await readFileForPlotter(file);
      if (!isSvgFile(file)) {
        openRasterImportModal(file, content);
        return;
      }

      pushUndo();
      addArtwork(file.name, content);
      invalidateSlice("File loaded. Slice plate to preview.");
      await refreshPreparePreview().catch((error) => showToast(error.message, true));
    } finally {
      event.target.value = "";
    }
  });

  $("importCloseBtn").addEventListener("click", closeRasterImportModal);
  $("importCancelBtn").addEventListener("click", closeRasterImportModal);
  $("importConfirmBtn").addEventListener("click", () => confirmRasterImport().catch((error) => showToast(error.message, true)));
  $("importModal").addEventListener("click", (event) => {
    if (event.target === $("importModal")) {
      closeRasterImportModal();
    }
  });
  for (const id of ["traceModeInput", "traceThresholdInput", "traceSpacingInput", "traceSizeInput", "traceMinPathInput", "traceLinkGapInput"]) {
    $(id).addEventListener("input", queueRasterTracePreview);
  }

  $("loadSquareBtn").addEventListener("click", () => loadExample("square", { goPrepare: true }).catch((error) => showToast(error.message, true)));
  $("loadCircleBtn").addEventListener("click", () => loadExample("circle", { goPrepare: true }).catch((error) => showToast(error.message, true)));

  $("sliceBtn").addEventListener("click", () => slicePlate({ goDevice: true }).catch((error) => showToast(error.message, true)));
  $("confirmSliceBtn").addEventListener("click", () => confirmSlice());
  $("deviceSendBtn").addEventListener("click", () => sendJob().catch((error) => showToast(error.message, true)));

  $("connectBtn").addEventListener("click", () => {
    const action = state.status?.connected ? disconnectPlotter : connectPlotter;
    action().catch((error) => showToast(error.message, true));
  });
  $("refreshPortsBtn").addEventListener("click", pollStatus);
  for (const id of ["liveSpeedDelayInput", "liveAccelInput", "livePenUpDelayInput", "livePenDownDelayInput", "livePenUpLiftInput"]) {
    $(id).addEventListener("input", () => {
      state.tuningDirty = true;
      updateRangeLabels();
      renderSendButtons();
    });
  }
  $("fitToBed").addEventListener("change", () => {
    pushUndo();
    resetPrepareTransform();
    invalidateSlice("Process changed. Slice plate again.");
    queuePreparePreview();
  });
  $("paperModeInput").addEventListener("change", () => {
    pushUndo();
    resetPrepareTransform();
    invalidateSlice("Paper changed. Slice plate again.");
    queuePreparePreview();
  });
  $("marginInput").addEventListener("input", () => {
    pushUndo();
    resetPrepareTransform();
    invalidateSlice("Process changed. Slice plate again.");
    queuePreparePreview();
  });

  const plateCanvas = $("plateCanvas");
  plateCanvas.addEventListener("pointerdown", beginPrepareInteraction);
  plateCanvas.addEventListener("pointermove", updatePrepareInteraction);
  plateCanvas.addEventListener("pointerup", endPrepareInteraction);
  plateCanvas.addEventListener("pointercancel", endPrepareInteraction);
  $("applyLiveBtn").addEventListener("click", () => applyTune().catch((error) => showToast(error.message, true)));

  $("pauseBtn").addEventListener("click", () => jobAction("pause").catch((error) => showToast(error.message, true)));
  $("resumeBtn").addEventListener("click", () => jobAction("resume").catch((error) => showToast(error.message, true)));
  $("stopBtn").addEventListener("click", () => jobAction("stop").catch((error) => showToast(error.message, true)));
  $("devicePauseBtn").addEventListener("click", () => jobAction("pause").catch((error) => showToast(error.message, true)));
  $("deviceResumeBtn").addEventListener("click", () => jobAction("resume").catch((error) => showToast(error.message, true)));
  $("deviceStopBtn").addEventListener("click", () => jobAction("stop").catch((error) => showToast(error.message, true)));

  $("confirmHomeBtn").addEventListener("click", () => confirmHome().catch((error) => showToast(error.message, true)));
  $("jogHomeBtn").addEventListener("click", () => jogHome().catch((error) => showToast(error.message, true)));
  document.querySelectorAll(".jog-button").forEach((button) => {
    button.addEventListener("click", () => {
      jog(Number(button.dataset.dx), Number(button.dataset.dy)).catch((error) => showToast(error.message, true));
    });
  });

  document.querySelectorAll(".manual-cmd").forEach((button) => {
    button.addEventListener("click", () => sendManual(button.dataset.command).catch((error) => showToast(error.message, true)));
  });
  $("manualSendBtn").addEventListener("click", () => {
    const input = $("manualCommandInput");
    const command = input.value.trim();
    if (!command) return;
    sendManual(command).then(() => {
      input.value = "";
    }).catch((error) => showToast(error.message, true));
  });
  $("manualCommandInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      $("manualSendBtn").click();
    }
  });

  $("clearLogBtn").addEventListener("click", () => {
    $("logView").innerHTML = "";
  });

  window.addEventListener("resize", scheduleDraw);
  window.addEventListener("keydown", handleGlobalKeys);
}

async function init() {
  bindEvents();
  updateRangeLabels();
  await pollStatus();
  await loadExample("square").catch((error) => showToast(error.message, true));
  renderSendButtons();
  window.setInterval(pollStatus, 900);
}

init();
