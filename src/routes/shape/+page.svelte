<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { emergencyStopState } from '$lib/emergency-stop-state';
  import { machineApi } from '$lib/machine-api';
  import { DEFAULT_CUT_FEED_RATE, clampCutFeedRate } from '$lib/cut-speed';
  import { DEFAULT_CUT_HEIGHT, clampCutHeight } from '$lib/cut-height';
  import {
    CUT_PROCESS_LIMITS,
    defaultCutProcessSettings,
    sanitizeCutProcessSettings,
    type CutProcessSettings
  } from '$lib/cut-process';
  import { uiSettings } from '$lib/ui-settings';
  import NumberPad from '$lib/NumberPad.svelte';
  import { autocutMachineState } from '$lib/autocut-machine-state';

  const XY_DEFAULT_MAX = 100; // fallback mm slag in X en Y
  const CIRCLE_SEGMENTS = 64; // smooth genoeg

  type ShapeId = "circle" | "slot" | "rect" | "hex";
  type Status = "idle" | "ready" | "busy" | "success" | "error";

  type ShapeOrientation = 'lengthX' | 'widthX';
  type CircleCfg = { diameter: number };
  type RectCfg = { length: number; width: number; orientation: ShapeOrientation; cornerRadiusEnabled: boolean; cornerRadius: number };
  type SlotCfg = { length: number; width: number; orientation: ShapeOrientation }; // radius = width/2
  type HexCfg = { acrossFlats: number }; // steekmaat / across flats
  type StoredShapeConfig = {
    selected?: ShapeId;
    circle?: Partial<CircleCfg>;
    rect?: Partial<RectCfg>;
    slot?: Partial<SlotCfg>;
    hex?: Partial<HexCfg>;
  };

  const SHAPE_CONFIG_STORAGE_KEY = 'autocut-shape-config';
  const SHAPE_FEED_RATE_STORAGE_KEY = 'autocut-shape-cut-feed-rate';
  const SHAPE_CUT_HEIGHT_STORAGE_KEY = 'autocut-shape-cut-height';
  const SHAPE_CUT_PROCESS_STORAGE_KEY = 'autocut-shape-cut-process';

  const shapes: { id: ShapeId; title: string; subtitle: string }[] = [
    { id: "circle", title: "Cirkel", subtitle: "Ø diameter" },
    { id: "slot", title: "Sleufgat", subtitle: "L, B (R=B/2)" },
    { id: "rect", title: "Rechthoek", subtitle: "L, B" },
    { id: "hex", title: "Zeskant", subtitle: "S (steekmaat)" }
  ];

  let selected: ShapeId | null = "circle";

  // Config defaults (mm)
  let circle: CircleCfg = { diameter: 20 };
  let rect: RectCfg = { length: 40, width: 20, orientation: 'lengthX', cornerRadiusEnabled: false, cornerRadius: 3 };
  let slot: SlotCfg = { length: 60, width: 12, orientation: 'lengthX' };
  let hex: HexCfg = { acrossFlats: 30 };

  // Machine status from Moonraker
  let mrState = "connecting";
  let machineState = 'Connecting';
  let mrMessage = "";
  let homedAxes = ""; // e.g. "xy", "xyz"
  let lastError = "";

  // Shape flow status
  let status: Status = "idle";
  let statusMsg = "";
  let preparedGcode = ""; // buffer
  let preparedSummary = "";
  let showCutConfirm = false;
  let cutProcess: CutProcessSettings = defaultCutProcessSettings;
  let hasConfiguredShape = false;
  let configuredFields: string[] = [];
  let xTravel = XY_DEFAULT_MAX;
  let yTravel = XY_DEFAULT_MAX;
  let configLoaded = false;
  let lastConfigRefresh = 0;
  let machineRefreshInFlight = false;

  // Auto-scroll settings & panel refs
  let autoScroll = true;
  let selectionPanel: HTMLElement | null = null;
  let configPanel: HTMLElement | null = null;
  let previewPanel: HTMLElement | null = null;
  let cutPanel: HTMLElement | null = null;

  function doAutoScroll(el: HTMLElement | null) {
    if (!autoScroll || !el) return;
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function pageHidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  // --- Helpers ---
  function setError(msg: string) {
    lastError = msg;
    console.error(msg);
  }

  function normalizeHomedAxes(value: unknown) {
    if (typeof value === 'string') return value.toLowerCase();
    if (Array.isArray(value)) return value.join('').toLowerCase();
    return '';
  }

  function clamp(n: number, min: number, max: number) {
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function fmt(n: number) {
    const rounded = Math.round(n * 10) / 10;
    return rounded.toFixed(1);
  }

  function fmtLimit(n: number) {
    const rounded = Math.round(n * 10) / 10;
    return rounded.toFixed(1).replace(/\.0$/, "");
  }

  function fmtClean(n: number, decimals = 2) {
    const factor = 10 ** decimals;
    const rounded = Math.round(n * factor) / factor;
    return rounded.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, "");
  }

  function xMax() {
    return xTravel;
  }

  function yMax() {
    return yTravel;
  }

  function xyFitMax() {
    return Math.min(xTravel, yTravel);
  }

  function normalizeOrientation(value: unknown): ShapeOrientation {
    return value === 'widthX' ? 'widthX' : 'lengthX';
  }

  function orientationLabel(value: ShapeOrientation) {
    return value === 'lengthX' ? 'Lengte over X' : 'Breedte over X';
  }

  function rectLengthMax() {
    return rect.orientation === 'lengthX' ? xMax() : yMax();
  }

  function rectWidthMax() {
    return rect.orientation === 'lengthX' ? yMax() : xMax();
  }

  function rectXSize() {
    return rect.orientation === 'lengthX' ? rect.length : rect.width;
  }

  function rectYSize() {
    return rect.orientation === 'lengthX' ? rect.width : rect.length;
  }

  function slotLengthMax() {
    return slot.orientation === 'lengthX' ? xMax() : yMax();
  }

  function slotWidthMax() {
    return slot.orientation === 'lengthX' ? yMax() : xMax();
  }

  function slotXSize() {
    return slot.orientation === 'lengthX' ? slot.length : slot.width;
  }

  function slotYSize() {
    return slot.orientation === 'lengthX' ? slot.width : slot.length;
  }

  function isHomedXYZ() {
    return homedAxes.includes("x") && homedAxes.includes("y") && homedAxes.includes("z");
  }

  async function sendGcode(script: string) {
    lastError = "";
    await machineApi.sendGcode(script);
  }

  async function emergencyStopMachine() {
    try {
      await machineApi.emergencyStop();
      autocutMachineState.clear();
      emergencyStopState.activate();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  // --- Poll machine status ---
  async function refreshMachine(includeConfig = false) {
    if (machineRefreshInFlight || pageHidden()) return;

    machineRefreshInFlight = true;
    try {
      const shouldLoadConfig = includeConfig || !configLoaded || Date.now() - lastConfigRefresh > 10000;
      const r = await machineApi.getStatus(shouldLoadConfig);
      const st = r?.result?.status ?? {};
      const ps = st.print_stats?.state ?? "";
      const wh = st.webhooks?.state ?? "";
      const message = st.display_status?.message ?? st.webhooks?.state_message ?? st.print_stats?.message ?? '';
      const toolhead = st.toolhead ?? {};
      const cfg = st.configfile?.settings ?? {};

      const klipperHomedAxes = normalizeHomedAxes(toolhead.homed_axes);
      if (klipperHomedAxes) autocutMachineState.mergeKlipper(klipperHomedAxes, null);

      if (shouldLoadConfig) {
        const sx = cfg['carriage x'] ?? cfg['stepper_x'] ?? {};
        const sy = cfg['carriage y'] ?? cfg['stepper_y'] ?? {};
        const xMin = Number(sx.position_min ?? 0);
        const xLimit = Number(sx.position_max ?? XY_DEFAULT_MAX);
        const yMin = Number(sy.position_min ?? 0);
        const yLimit = Number(sy.position_max ?? XY_DEFAULT_MAX);
        xTravel = Math.max(0.1, xLimit - xMin);
        yTravel = Math.max(0.1, yLimit - yMin);
        normalizeAll();
        configLoaded = true;
        lastConfigRefresh = Date.now();
      }

      if (wh === "ready") {
        mrState = ps === "printing" ? "printing" : "ready";
        machineState = ps === 'printing' ? 'Busy' : 'Ready';
      } else if (wh === "error") {
        mrState = "error";
        machineState = 'Error';
      } else if (wh) {
        mrState = wh;
        machineState = wh.charAt(0).toUpperCase() + wh.slice(1);
      } else {
        mrState = ps || "unknown";
        machineState = ps ? ps.charAt(0).toUpperCase() + ps.slice(1) : 'Unknown';
      }

      mrMessage = message || '';
      lastError = '';
    } catch (e: any) {
      mrState = "disconnected";
      machineState = 'Disconnected';
      mrMessage = "Moonraker not reachable";
      setError(e?.message ?? String(e));
    } finally {
      machineRefreshInFlight = false;
    }
  }

  // --- Validation per shape (clamp op actuele X/Y-slag) ---
  function normalizeCircle() {
    circle = { diameter: clamp(circle.diameter, 0.1, xyFitMax()) };
  }

  function rectMaxRadius(length = rect.length, width = rect.width) {
    return Math.max(0, Math.min(length, width) / 2);
  }

  function normalizeRect() {
    const orientation = normalizeOrientation(rect.orientation);
    const lengthLimit = orientation === 'lengthX' ? xMax() : yMax();
    const widthLimit = orientation === 'lengthX' ? yMax() : xMax();
    const length = clamp(rect.length, 0.1, lengthLimit);
    const width = clamp(rect.width, 0.1, widthLimit);
    const maxRadius = rectMaxRadius(length, width);
    const cornerRadiusEnabled = Boolean(rect.cornerRadiusEnabled) && maxRadius >= 0.1;
    const fallbackRadius = Math.min(3, maxRadius);
    let cornerRadius = clamp(Number(rect.cornerRadius), 0, maxRadius);

    if (!Number.isFinite(cornerRadius) || cornerRadius === 0) {
      cornerRadius = cornerRadiusEnabled ? Math.max(0.1, fallbackRadius) : fallbackRadius;
    }

    if (cornerRadiusEnabled) {
      cornerRadius = clamp(cornerRadius, 0.1, maxRadius);
    } else {
      cornerRadius = clamp(cornerRadius, 0, maxRadius);
    }

    rect = { length, width, orientation, cornerRadiusEnabled, cornerRadius };
  }

  function normalizeHex() {
    hex = { acrossFlats: clamp(hex.acrossFlats, 0.1, xyFitMax()) };
  }

  function normalizeSlot() {
    const orientation = normalizeOrientation(slot.orientation);
    const lengthLimit = orientation === 'lengthX' ? xMax() : yMax();
    const widthLimit = orientation === 'lengthX' ? yMax() : xMax();
    const w = clamp(slot.width, 0.1, Math.min(widthLimit, lengthLimit));
    const l = clamp(slot.length, w, lengthLimit);
    slot = { length: l, width: w, orientation };
  }

  function normalizeAll() {
    normalizeCircle();
    normalizeRect();
    normalizeHex();
    normalizeSlot();
  }
  normalizeAll();

  function persistShapeConfig() {
    if (!browser) return;

    const payload: StoredShapeConfig = {
      selected: selected ?? 'circle',
      circle,
      rect,
      slot,
      hex
    };

    localStorage.setItem(SHAPE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
  }

  function persistCutProcess() {
    if (!browser) return;
    localStorage.setItem(SHAPE_CUT_PROCESS_STORAGE_KEY, JSON.stringify(cutProcess));
  }

  function loadCutProcess() {
    if (!browser) return;

    const legacyFeed = localStorage.getItem(SHAPE_FEED_RATE_STORAGE_KEY);
    const legacyHeight = localStorage.getItem(SHAPE_CUT_HEIGHT_STORAGE_KEY);
    const legacy: Partial<CutProcessSettings> = {
      straightFeedRate: legacyFeed === null ? DEFAULT_CUT_FEED_RATE : clampCutFeedRate(Number(legacyFeed), DEFAULT_CUT_FEED_RATE),
      curveFeedRate: legacyFeed === null ? defaultCutProcessSettings.curveFeedRate : clampCutFeedRate(Number(legacyFeed), DEFAULT_CUT_FEED_RATE),
      cutHeight: legacyHeight === null ? DEFAULT_CUT_HEIGHT : clampCutHeight(Number(legacyHeight), DEFAULT_CUT_HEIGHT)
    };

    try {
      const raw = localStorage.getItem(SHAPE_CUT_PROCESS_STORAGE_KEY);
      cutProcess = sanitizeCutProcessSettings(raw ? { ...legacy, ...JSON.parse(raw) } : legacy);
    } catch {
      cutProcess = sanitizeCutProcessSettings(legacy);
    }

    persistCutProcess();
  }

  function setCutProcessValue(key: keyof CutProcessSettings, value: number) {
    cutProcess = sanitizeCutProcessSettings({ ...cutProcess, [key]: value });
    persistCutProcess();
    resetPrepared();
  }

  function openCutProcessPad(title: string, key: keyof CutProcessSettings, unit: string) {
    const limits = CUT_PROCESS_LIMITS[key];
    openNumpad({
      title,
      value: cutProcess[key],
      min: limits.min,
      max: limits.max,
      unit,
      apply: (v) => setCutProcessValue(key, v)
    });
  }

  function toggleRectCornerRadius() {
    rect = { ...rect, cornerRadiusEnabled: !rect.cornerRadiusEnabled };
    normalizeRect();
    persistShapeConfig();
    markShapeFieldConfigured('cornerRadius');
    resetPrepared();
  }

  function setRectCornerRadius(value: number) {
    rect = { ...rect, cornerRadius: value, cornerRadiusEnabled: true };
    normalizeRect();
    markShapeFieldConfigured('cornerRadius');
  }

  function nextOrientation(value: ShapeOrientation): ShapeOrientation {
    return value === 'lengthX' ? 'widthX' : 'lengthX';
  }

  function toggleRectOrientation() {
    rect = { ...rect, orientation: nextOrientation(rect.orientation) };
    normalizeRect();
    persistShapeConfig();
    resetPrepared();
  }

  function toggleSlotOrientation() {
    slot = { ...slot, orientation: nextOrientation(slot.orientation) };
    normalizeSlot();
    persistShapeConfig();
    resetPrepared();
  }

  function loadShapeConfig() {
    if (!browser) return;

    try {
      const raw = localStorage.getItem(SHAPE_CONFIG_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as StoredShapeConfig;
      selected = parsed.selected ?? 'circle';
      circle = { diameter: Number(parsed.circle?.diameter ?? circle.diameter) || circle.diameter };
      rect = {
        length: Number(parsed.rect?.length ?? rect.length) || rect.length,
        width: Number(parsed.rect?.width ?? rect.width) || rect.width,
        orientation: normalizeOrientation(parsed.rect?.orientation ?? rect.orientation),
        cornerRadiusEnabled: Boolean(parsed.rect?.cornerRadiusEnabled ?? rect.cornerRadiusEnabled),
        cornerRadius: Number(parsed.rect?.cornerRadius ?? rect.cornerRadius) || rect.cornerRadius
      };
      slot = {
        length: Number(parsed.slot?.length ?? slot.length) || slot.length,
        width: Number(parsed.slot?.width ?? slot.width) || slot.width,
        orientation: normalizeOrientation(parsed.slot?.orientation ?? slot.orientation)
      };
      hex = { acrossFlats: Number(parsed.hex?.acrossFlats ?? hex.acrossFlats) || hex.acrossFlats };
      normalizeAll();
    } catch {
      normalizeAll();
    }
  }

  function requiredFieldsForShape(id: ShapeId | null) {
    if (id === 'circle') return ['diameter'];
    if (id === 'hex') return ['acrossFlats'];
    if (id === 'rect' || id === 'slot') return ['length', 'width'];
    return [];
  }

  function selectedShapeIsComplete() {
    const required = requiredFieldsForShape(selected);
    return required.length > 0 && required.every((field) => configuredFields.includes(field));
  }

  // --- Numpad modal ---
  let padOpen = false;
  let padTitle = "";
  let padValue = "";
  let padMin = 0;
  let padMax = XY_DEFAULT_MAX;
  let padCurrent = 0;
  let padUnit = 'mm';
  let padError = "";
  let padApply: ((v: number) => void) | null = null;

  function openNumpad(opts: {
    title: string;
    value: number;
    min?: number;
    max?: number;
    unit?: string;
    apply: (v: number) => void;
  }) {
    padTitle = opts.title;
    padMin = opts.min ?? 0;
    padMax = opts.max ?? XY_DEFAULT_MAX;
    padCurrent = opts.value;
    padUnit = opts.unit ?? 'mm';
    padValue = "";
    padError = "";
    padApply = opts.apply;
    padOpen = true;
  }

  function padAppend(ch: string) {
    if (ch === "." && padValue.includes(".")) return;
    if (padValue === "" && ch === ".") {
      padValue = "0.";
      return;
    }
    padValue += ch;
  }

  function padBackspace() {
    padValue = padValue.slice(0, -1);
  }

  function padClear() {
    padValue = "";
  }

  function padCancel() {
    padOpen = false;
    padApply = null;
    padError = "";
  }

  function padOk() {
    if (!padValue.trim()) {
      padError = "Voer eerst een waarde in.";
      return;
    }

    const raw = parseFloat(padValue.replace(",", "."));
    if (Number.isNaN(raw)) {
      padError = "Voer een geldig getal in.";
      return;
    }

    const v = clamp(raw, padMin, padMax);
    padApply?.(v);
    padOpen = false;
    padApply = null;
    padError = "";
  }

  // --- Navigation actions ---
  function openConfig(id: ShapeId) {
    selected = id;
    configuredFields = [];
    hasConfiguredShape = false;
    status = "idle";
    statusMsg = "";
    preparedGcode = "";
    preparedSummary = "";
    persistShapeConfig();
    doAutoScroll(configPanel);
  }

  function resetPrepared() {
    status = "idle";
    statusMsg = "";
    preparedGcode = "";
    preparedSummary = "";
  }

  function markShapeFieldConfigured(field: string) {
    if (!configuredFields.includes(field)) {
      configuredFields = [...configuredFields, field];
    }

    hasConfiguredShape = selectedShapeIsComplete();
    persistShapeConfig();
    resetPrepared();

    if (hasConfiguredShape) {
      doAutoScroll(previewPanel);
    }
  }

  function idleStatusMessage() {
    if (!selected) return "Kies eerst een vorm om de snijflow te activeren.";
    if (!isHomedXYZ()) return "Druk op Snijden nadat X, Y en Z zijn gehomed.";
    return "Controleer de preview en start de snijtaak.";
  }

  // --- G-code generation (XY only, relative for safety) ---
  type FeedKind = 'straight' | 'curve';
  type Point = { x: number; y: number };

  function moveFeed(kind: FeedKind) {
    return kind === 'curve' ? cutProcess.curveFeedRate : cutProcess.straightFeedRate;
  }

  function g1xy(dx: number, dy: number, kind: FeedKind = 'straight', comment = '') {
    const suffix = comment ? ` ; ${comment}` : '';
    return `G1 X${dx.toFixed(3)} Y${dy.toFixed(3)} F${moveFeed(kind)}${suffix}`;
  }

  function pushAbsMove(moves: string[], from: Point, to: Point, kind: FeedKind, comment = '') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return from;

    moves.push(g1xy(dx, dy, kind, comment));
    return to;
  }

  function addArcSegments(
    moves: string[],
    current: Point,
    center: Point,
    radius: number,
    startDeg: number,
    endDeg: number,
    segments: number
  ) {
    let prev = current;

    for (let i = 1; i <= segments; i++) {
      const deg = startDeg + ((endDeg - startDeg) * i) / segments;
      const t = (deg * Math.PI) / 180;
      const next = {
        x: center.x + radius * Math.cos(t),
        y: center.y + radius * Math.sin(t)
      };
      prev = pushAbsMove(moves, prev, next, 'curve');
    }

    return prev;
  }

  function dwellSeconds(seconds: number, comment: string) {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    return ms > 0 ? [`G4 P${ms} ; ${comment}`] : [];
  }

  function gcodeHeader() {
    return [
      '; AutoCut shape cut (XY only)',
      'M400',
      'G90',
      'G21'
    ];
  }

  function gcodeContactStart() {
    return [
      '; Contact start procedure',
      'TORCH_ON',
      ...dwellSeconds(cutProcess.torchLeadTime, 'voorlooptijd toorts'),
      `G1 Z${cutProcess.contactOffset.toFixed(3)} F${cutProcess.contactDownSpeed} ; naar contact-offset`,
      ...dwellSeconds(cutProcess.contactSettleTime, 'pauze na contact'),
      `G1 Z${cutProcess.cutHeight.toFixed(3)} F${cutProcess.contactLiftSpeed} ; omhoog naar snijhoogte`,
      ...dwellSeconds(cutProcess.pierceDelay, 'pierce delay'),
      'G91 ; relative contour moves',
      `G1 F${cutProcess.straightFeedRate} ; snijfeed herstellen`,
      '; Start snijden'
    ];
  }

  function gcodeFooter() {
    return [
      '; Einde snijden',
      'TORCH_OFF',
      'M400',
      `G1 Z${cutProcess.finishLiftHeight.toFixed(3)} F${cutProcess.finishLiftSpeed} ; omhoog na snijden`,
      'G90 ; back to absolute',
      '; end'
    ];
  }

  function genRect(L: number, B: number) {
    const xSize = rect.orientation === 'lengthX' ? L : B;
    const ySize = rect.orientation === 'lengthX' ? B : L;
    const radius = rect.cornerRadiusEnabled ? clamp(rect.cornerRadius, 0.1, Math.min(xSize, ySize) / 2) : 0;
    const halfX = xSize / 2;
    const halfY = ySize / 2;

    if (radius <= 0) {
      const lines = [
        g1xy(-halfX, -halfY, 'straight', 'to start'),
        g1xy(xSize, 0, 'straight'),
        g1xy(0, ySize, 'straight'),
        g1xy(-xSize, 0, 'straight'),
        g1xy(0, -ySize, 'straight'),
        g1xy(halfX, halfY, 'straight', 'back to center')
      ];
      return { lines, summary: `Rechthoek L=${fmt(L)} B=${fmt(B)} (${orientationLabel(rect.orientation)})` };
    }

    const seg = Math.max(4, Math.ceil(radius * 1.5));
    const moves: string[] = [];
    let current: Point = { x: 0, y: 0 };
    const startPoint = { x: -halfX + radius, y: -halfY };

    current = pushAbsMove(moves, current, startPoint, 'straight', 'to start');
    current = pushAbsMove(moves, current, { x: halfX - radius, y: -halfY }, 'straight');
    current = addArcSegments(moves, current, { x: halfX - radius, y: -halfY + radius }, radius, -90, 0, seg);
    current = pushAbsMove(moves, current, { x: halfX, y: halfY - radius }, 'straight');
    current = addArcSegments(moves, current, { x: halfX - radius, y: halfY - radius }, radius, 0, 90, seg);
    current = pushAbsMove(moves, current, { x: -halfX + radius, y: halfY }, 'straight');
    current = addArcSegments(moves, current, { x: -halfX + radius, y: halfY - radius }, radius, 90, 180, seg);
    current = pushAbsMove(moves, current, { x: -halfX, y: -halfY + radius }, 'straight');
    current = addArcSegments(moves, current, { x: -halfX + radius, y: -halfY + radius }, radius, 180, 270, seg);
    pushAbsMove(moves, current, { x: 0, y: 0 }, 'straight', 'back to center');

    return { lines: moves, summary: `Rechthoek L=${fmt(L)} B=${fmt(B)} R=${fmt(radius)} (${orientationLabel(rect.orientation)})` };
  }

  function genHex(S: number) {
    const a = S / 2;
    const R = a / 0.866025403784;
    const ang = [-60, 0, 60, 120, 180, 240].map((d) => (d * Math.PI) / 180);
    const pts = ang.map((t) => ({ x: R * Math.cos(t), y: R * Math.sin(t) }));

    let current: Point = { x: 0, y: 0 };
    const moves: string[] = [];
    current = pushAbsMove(moves, current, pts[0], 'straight', 'to start');
    for (let i = 1; i < pts.length; i++) {
      current = pushAbsMove(moves, current, pts[i], 'straight');
    }
    current = pushAbsMove(moves, current, pts[0], 'straight');
    pushAbsMove(moves, current, { x: 0, y: 0 }, 'straight', 'back to center');

    return { lines: moves, summary: `Zeskant S=${fmt(S)}` };
  }

  function genCircle(d: number) {
    const r = d / 2;
    const N = CIRCLE_SEGMENTS;
    const pts: Point[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }

    let current: Point = { x: 0, y: 0 };
    const moves: string[] = [];
    current = pushAbsMove(moves, current, pts[0], 'straight', 'to start');
    for (let i = 1; i < pts.length; i++) {
      current = pushAbsMove(moves, current, pts[i], 'curve');
    }
    current = pushAbsMove(moves, current, pts[0], 'curve');
    pushAbsMove(moves, current, { x: 0, y: 0 }, 'straight', 'back to center');

    return { lines: moves, summary: `Cirkel Ø=${fmt(d)}` };
  }

  function genSlot(L: number, B: number) {
    const R = B / 2;
    const straight = L - 2 * R;
    const seg = 24;
    const moves: string[] = [];
    let current: Point = { x: 0, y: 0 };

    function orientPoint(x: number, y: number): Point {
      return slot.orientation === 'lengthX' ? { x, y } : { x: y, y: x };
    }

    function pushSlotPoint(x: number, y: number, kind: FeedKind, comment = '') {
      current = pushAbsMove(moves, current, orientPoint(x, y), kind, comment);
    }

    pushSlotPoint(-straight / 2, R, 'straight', 'to start');
    pushSlotPoint(straight / 2, R, 'straight');

    for (let i = 1; i <= seg; i++) {
      const t = (90 - (180 * i) / seg) * (Math.PI / 180);
      pushSlotPoint(straight / 2 + R * Math.cos(t), R * Math.sin(t), 'curve');
    }

    pushSlotPoint(-straight / 2, -R, 'straight');

    for (let i = 1; i <= seg; i++) {
      const t = (-90 + (180 * i) / seg) * (Math.PI / 180);
      pushSlotPoint(-straight / 2 + R * Math.cos(t), R * Math.sin(t), 'curve');
    }

    pushAbsMove(moves, current, { x: 0, y: 0 }, 'straight', 'back to center');

    return { lines: moves, summary: `Sleufgat L=${fmt(L)} B=${fmt(B)} (R=${fmt(R)}, ${orientationLabel(slot.orientation)})` };
  }

  function buildGcodeForSelection() {
    normalizeAll();
    cutProcess = sanitizeCutProcessSettings(cutProcess);

    if (!selected) {
      throw new Error('Geen vorm geselecteerd.');
    }

    let body: { lines: string[]; summary: string };

    if (selected === 'circle') body = genCircle(circle.diameter);
    else if (selected === 'rect') body = genRect(rect.length, rect.width);
    else if (selected === 'slot') body = genSlot(slot.length, slot.width);
    else body = genHex(hex.acrossFlats);

    const gcode = [...gcodeHeader(), ...gcodeContactStart(), ...body.lines, ...gcodeFooter()].join('\n');
    return { gcode, summary: body.summary };
  }

  // --- Flow: direct cut with confirmation ---
  function requestCut() {
    lastError = '';

    if (status === 'busy') {
      statusMsg = 'Snijtaak is al bezig.';
      return;
    }

    if (mrState === 'error') {
      status = 'error';
      statusMsg = 'Machine in alarm. Los eerst op in Klipper/Mainsail.';
      doAutoScroll(cutPanel);
      return;
    }

    if (!isHomedXYZ()) {
      status = 'error';
      statusMsg = 'Machine moet eerst volledig worden gehomed: X, Y en Z.';
      doAutoScroll(cutPanel);
      return;
    }

    if (!selected || !hasConfiguredShape) {
      status = 'error';
      statusMsg = 'Kies eerst een vorm en vul de maat in.';
      doAutoScroll(cutPanel);
      return;
    }

    try {
      const { gcode, summary } = buildGcodeForSelection();
      preparedGcode = gcode;
      preparedSummary = summary;
      status = 'ready';
      statusMsg = 'Controleer de machine en bevestig om te snijden.';
      showCutConfirm = true;
      doAutoScroll(cutPanel);
    } catch (e: any) {
      status = 'error';
      statusMsg = e?.message ?? String(e);
      setError(statusMsg);
    }
  }

  function cancelCutConfirm() {
    showCutConfirm = false;
  }

  async function confirmCut() {
    if (!preparedGcode || status === 'busy') return;

    showCutConfirm = false;

    try {
      status = 'busy';
      statusMsg = 'Bezig met snijden...';

      try {
        await sendGcode('M117 Snijden bezig');
      } catch {
        // ignore display update failure
      }

      await sendGcode(preparedGcode);

      status = 'success';
      statusMsg = 'Snijden succesvol.';
    } catch (e: any) {
      status = 'error';
      statusMsg = 'Fout bij snijden';
      setError(e?.message ?? String(e));
      alert(`Fout bij snijden:
${e?.message ?? e}`);
    }
  }

  // --- SVG helpers (we tekenen in een 120x120 viewbox) ---
  const VB = 120;

  function fitPreview(widthMm: number, heightMm: number) {
    const usable = 76;
    const longest = Math.max(widthMm, heightMm, 0.1);
    const scale = usable / longest;
    const w = widthMm * scale;
    const h = heightMm * scale;
    const cx = VB / 2;
    const cy = VB / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  }

  function circlePreviewRadius() {
    return 38;
  }

  function rectPreviewRadius(box: { w: number; h: number }) {
    if (!rect.cornerRadiusEnabled) return 0;
    const scale = box.w / Math.max(rectXSize(), 0.1);
    return Math.min(box.w / 2, box.h / 2, rect.cornerRadius * scale);
  }

  function slotPreviewRadius(box: { w: number; h: number }) {
    return Math.min(box.w, box.h) / 2;
  }

  function hexPointsForPreview(S: number) {
    const px = 76;
    const cx = VB / 2;
    const cy = VB / 2;
    const a = px / 2;
    const R = a / 0.866025403784; // circumradius
    const ang = [-60, 0, 60, 120, 180, 240].map((d) => (d * Math.PI) / 180);
    return ang
      .map((t) => `${(cx + R * Math.cos(t)).toFixed(2)},${(cy + R * Math.sin(t)).toFixed(2)}`)
      .join(" ");
  }

  function workflowPill() {
    if (status === "idle") return { txt: "Idle", cls: "pill idle" };
    if (status === "ready") return { txt: "Klaar", cls: "pill ready" };
    if (status === "busy") return { txt: "Bezig", cls: "pill busy" };
    if (status === "success") return { txt: "Succes", cls: "pill success" };
    return { txt: "Fout", cls: "pill error" };
  }

  function selectedShapeTitle() {
    if (selected === "circle") return "Cirkel";
    if (selected === "slot") return "Sleufgat";
    if (selected === "rect") return "Rechthoek";
    if (selected === "hex") return "Zeskant";
    return "";
  }

  function statusClass() {
    if (machineState === 'Ready') return 'ok';
    if (machineState === 'Busy') return 'warn';
    if (['Error', 'Disconnected', 'Shutdown', 'Emergency'].includes(machineState)) return 'err';
    return "";
  }

  onMount(() => {
    uiSettings.load();
    autocutMachineState.load();
    loadShapeConfig();
    loadCutProcess();
    hasConfiguredShape = selected !== null;
    void refreshMachine(true);
    const poll = setInterval(() => void refreshMachine(false), 1500);
    const unsubscribe = uiSettings.subscribe((value) => {
      autoScroll = value.autoScroll ?? true;
    });
    const unsubscribeMachineState = autocutMachineState.subscribe((value) => {
      homedAxes = value.homedAxes;
    });

    return () => {
      clearInterval(poll);
      unsubscribe();
      unsubscribeMachineState();
    };
  });
</script>

<style>
  .page {
    display: grid;
    gap: 12px;
  }

  .headerActions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    justify-content: flex-end;
  }

  .statusPill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 56px;
    padding: 0 16px;
    border-radius: 18px;
    border: 1px solid rgba(124, 199, 255, 0.16);
    background: rgba(12, 22, 41, 0.88);
    font-size: 17px;
    font-weight: 850;
    color: #c6d3ff;
  }

  .statusPill.ok { color: #a9ffcf; border-color: #1f6a49; }
  .statusPill.warn { color: #ffe2a8; border-color: #6a5320; }
  .statusPill.err { color: #ffb5b5; border-color: #7a1f1f; }

  .submsg {
    color: #b7c6ea;
    font-size: 17px;
    opacity: 0.95;
    white-space: pre-wrap;
  }

  .topStopButton {
    min-width: 136px;
    min-height: 56px;
    flex: 0 0 auto;
  }

  .dangerButton {
    background: linear-gradient(180deg, rgba(150, 32, 40, 0.98), rgba(104, 18, 26, 0.98));
    border: 1px solid rgba(255, 154, 154, 0.24);
    color: #fff3f3;
  }

  .emergencyNotice {
    padding: 12px 14px;
    border-radius: 18px;
    border: 1px solid rgba(186, 63, 75, 0.34);
    background: linear-gradient(180deg, rgba(44, 15, 21, 0.96), rgba(25, 9, 13, 0.96));
    color: #ffe8e8;
    font-size: 16px;
    line-height: 1.45;
    font-weight: 700;
  }

  .pill {
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid rgba(124, 199, 255, 0.16);
    background: rgba(12, 22, 41, 0.88);
    font-weight: 850;
    font-size: 17px;
  }
  .pill.idle { color: #c6d3ff; }
  .pill.ready { color: #a9ffcf; border-color: #1f6a49; }
  .pill.busy { color: #ffe2a8; border-color: #6a5320; }
  .pill.success { color: #a9ffcf; border-color: #1f6a49; }
  .pill.error { color: #ffb5b5; border-color: #7a1f1f; }

  .sequence {
    display: grid;
    gap: 12px;
  }

  .sectionHead {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }

  .sectionHead.withActions {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;
  }

  .sectionHeadMain {
    display: grid;
    gap: 6px;
  }

  .sectionHint {
    color: #b7c6ea;
    font-size: 16px;
    line-height: 1.45;
  }

  .errorBox {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 14px;
    white-space: pre-wrap;
    max-height: 140px;
    overflow: auto;
  }

  /* Swipe row */
  .swipeRow {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(200px, 1fr);
    gap: 12px;

    overflow-x: auto;
    padding-bottom: 8px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }
  .swipeRow::-webkit-scrollbar { height: 6px; }
  .swipeRow::-webkit-scrollbar-thumb { background: #1a2640; border-radius: 999px; }

  .shapeCard {
    scroll-snap-align: start;
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.16);
    border-radius: 22px;
    padding: 16px;
    cursor: pointer;
    user-select: none;
    transition: transform 0.08s ease;
    min-height: 0;
    height: 100%;
    width: 100%;
    text-align: left;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }
  .shapeCard:hover {
    border-color: rgba(124, 199, 255, 0.24);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 14px 24px rgba(0, 0, 0, 0.18);
  }
  .shapeCard:active { transform: scale(0.99); }
  .shapeCard.selected {
    border-color: #6aa7ff;
    background:
      radial-gradient(circle at top right, rgba(124, 199, 255, 0.12), transparent 36%),
      linear-gradient(180deg, rgba(18, 30, 52, 0.98), rgba(9, 17, 31, 0.98));
    box-shadow:
      0 0 0 2px rgba(106, 167, 255, 0.18) inset,
      0 16px 28px rgba(0, 0, 0, 0.22);
  }

  .cardTop {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    min-height: 96px;
  }
  .cardTitle { font-weight: 900; font-size: 22px; }
  .cardSub { color: #b7c6ea; font-size: 17px; margin-top: 4px; }

  .shapeGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    min-height: 320px;
    grid-auto-rows: minmax(0, 1fr);
  }

  .shapeMeta {
    margin-top: 8px;
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 800;
  }

  .shapeCard.selected .shapeMeta {
    color: #d9e8ff;
  }

  .miniSvg {
    width: 104px;
    height: 104px;
    border-radius: 18px;
    background: #0b101b;
    border: 1px solid #1e2a40;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }

  /* Config view layout */
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 0;
  }

  button {
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    color: #eaf0ff;
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 16px;
    padding: 12px 14px;
    font-weight: 900;
    font-size: 17px;
    cursor: pointer;
    min-height: 48px;
  }
  button:hover { background: #1b2a4a; }
  button:focus { outline: 2px solid #6aa7ff; outline-offset: 2px; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }

  .primary { background: #1a2b55; border-color: #3558a8; }
  .primary:hover { background: #22376a; }

  .ghost { background: transparent; }
  .danger { background: #2a0f14; border-color: #7a1f1f; color: #ffb5b5; }
  .danger:hover { background: #3a141a; }

  .fieldGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .singleFieldGrid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .panel {
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.16);
    border-radius: 22px;
    padding: 16px;
    box-shadow: 0 18px 28px rgba(0, 0, 0, 0.16);
  }
  .panelTitle { font-weight: 900; font-size: 24px; margin-bottom: 12px; }

  .pageTitle {
    font-weight: 900;
    font-size: 26px;
    line-height: 1;
    margin-bottom: 12px;
  }

  .stagePanel {
    min-height: 0;
  }

  .previewWrap {
    display: grid;
    place-items: center;
    padding: 8px 0 2px;
    min-height: 280px;
  }

  .previewButton {
    width: 100%;
    background: transparent;
    border: 0;
    border-radius: 18px;
    cursor: pointer;
  }

  .previewButton:hover {
    background: rgba(124, 199, 255, 0.05);
  }

  .bigSvg {
    width: 100%;
    max-width: 420px;
    height: auto;
    border-radius: 18px;
    background: #0b101b;
    border: 1px solid #1e2a40;
  }

  .fields { display: grid; gap: 12px; }
  .field { display: grid; gap: 6px; }
  .label { color: #b7c6ea; font-size: 16px; font-weight: 800; }

  .valueBox {
    background: #0b101b;
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 18px;
    padding: 14px;
    font-weight: 950;
    font-size: 20px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }

  .toggleValue {
    color: #b7c6ea;
  }

  .toggleValue.active {
    border-color: rgba(74, 222, 128, 0.5);
    background: rgba(22, 80, 52, 0.38);
    color: #bcffd1;
  }

  .hintRow {
    margin-top: 4px;
    color: #b7c6ea;
    font-size: 16px;
    opacity: 0.95;
  }

  .helperBox {
    padding: 12px 14px;
    border-radius: 18px;
    background: rgba(8, 16, 30, 0.88);
    border: 1px solid rgba(124, 199, 255, 0.1);
    color: #c6d3ff;
    font-size: 16px;
    line-height: 1.45;
  }

  .helperBox strong {
    display: block;
    margin-bottom: 4px;
    font-size: 17px;
    color: #f0f6ff;
  }

  .actionBar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .actionBar.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .previewInfo {
    margin-top: 10px;
    display: grid;
    gap: 6px;
    color: #b7c6ea;
    font-size: 15px;
  }

  .flowStatusRow {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .processGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    align-items: stretch;
    margin-bottom: 12px;
  }

  .flowMessage {
    width: 100%;
  }

  .cutButton {
    min-height: 64px;
    font-size: 22px;
  }

  .modalBack {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: 12px;
    background: rgba(0, 0, 0, 0.58);
  }

  .modal {
    width: min(100%, 520px);
    border-radius: 22px;
    border: 1px solid rgba(109, 146, 219, 0.18);
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    padding: 18px;
    box-shadow: 0 24px 36px rgba(0, 0, 0, 0.28);
  }

  .modalTitle {
    margin: 0 0 10px;
    font-size: 22px;
    font-weight: 900;
  }

  .modalText {
    color: #c9d8ee;
    font-size: 17px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .modalActions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 16px;
  }


  @media (max-width: 760px) {
    .shapeGrid,
    .fieldGrid,
    .processGrid,
    .actionBar,
    .actionBar.three,
    .modalActions,
    .singleFieldGrid { grid-template-columns: 1fr; }
    .sectionHead.withActions { grid-template-columns: 1fr; }
    .shapeGrid {
      grid-template-columns: 1fr;
      min-height: auto;
    }
    .swipeRow { grid-auto-columns: minmax(180px, 1fr); }
  }
</style>

<div class="page">
  {#if $emergencyStopState.active}
    <div class="emergencyNotice">{$emergencyStopState.message}</div>
  {/if}

  <div class="sequence">
    <div class="panel stagePanel" bind:this={selectionPanel}>
      <div class="sectionHead withActions">
        <div class="sectionHeadMain">
          <div class="pageTitle">Vorm snijden</div>
          <div class="sectionHint">Selecteer een vorm.</div>
        </div>
        <div class="headerActions">
          <div class={`statusPill ${statusClass()}`}>{machineState}</div>
          <button class="dangerButton topStopButton" on:click={emergencyStopMachine}>Emergency stop</button>
        </div>
      </div>

      <div class="shapeGrid">
        {#each shapes as s}
          <button
            type="button"
            class={"shapeCard " + (selected === s.id ? "selected" : "")}
            on:click={() => openConfig(s.id)}
          >
            <div class="cardTop">
              <div>
                <div class="cardTitle">{s.title}</div>
                <div class="cardSub">{s.subtitle}</div>
              </div>

              <div class="miniSvg" aria-hidden="true">
                {#if s.id === "circle"}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="32" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {:else if s.id === "rect"}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <rect x="24" y="38" width="72" height="44" rx="0" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {:else if s.id === "slot"}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <rect x="24" y="44" width="72" height="32" rx="16" ry="16" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {:else}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <polygon points="80,26 99,60 80,94 40,94 21,60 40,26" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {/if}
              </div>
            </div>

            <div class="shapeMeta">
              {#if s.id === "circle"}
                Ø diameter
              {:else if s.id === "rect"}
                Lengte en breedte
              {:else if s.id === "slot"}
                Lengte, breedte en radius
              {:else}
                Steekmaat S
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>

    <div class="panel stagePanel" bind:this={configPanel}>
      <div class="sectionHead">
        <div class="panelTitle">Maat invoeren</div>
        <div class="sectionHint">
          {#if selected}
            {selectedShapeTitle()} geselecteerd. Tik op een waarde om deze in te voeren.
          {:else}
            Selecteer eerst hierboven een vorm.
          {/if}
        </div>
      </div>

      {#if selected}
        <div class={selected === "circle" || selected === "hex" ? "singleFieldGrid" : "fieldGrid"}>
          {#if selected === "circle"}
            <div class="field">
              <div class="label">Diameter Ø (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Diameter Ø (mm)",
                    value: circle.diameter,
                    min: 0.1,
                    max: xyFitMax(),
                    apply: (v) => {
                      circle = { diameter: v };
                      normalizeCircle();
                      markShapeFieldConfigured('diameter');
                    }
                  })}
              >
                {circle.diameter.toFixed(1)} mm
              </button>
            </div>
          {:else if selected === "rect"}
            <div class="field">
              <div class="label">Lengte L (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Lengte L (mm)",
                    value: rect.length,
                    min: 0.1,
                    max: rectLengthMax(),
                    apply: (v) => {
                      rect = { ...rect, length: v };
                      normalizeRect();
                      markShapeFieldConfigured('length');
                    }
                  })}
              >
                {rect.length.toFixed(1)} mm
              </button>
            </div>

            <div class="field">
              <div class="label">Breedte B (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Breedte B (mm)",
                    value: rect.width,
                    min: 0.1,
                    max: rectWidthMax(),
                    apply: (v) => {
                      rect = { ...rect, width: v };
                      normalizeRect();
                      markShapeFieldConfigured('width');
                    }
                  })}
              >
                {rect.width.toFixed(1)} mm
              </button>
            </div>

            <div class="field">
              <div class="label">Hoekradius toepassen</div>
              <button
                type="button"
                class={`valueBox toggleValue ${rect.cornerRadiusEnabled ? 'active' : ''}`}
                on:click={toggleRectCornerRadius}
              >
                {rect.cornerRadiusEnabled ? 'Aan' : 'Uit'}
              </button>
            </div>

            {#if rect.cornerRadiusEnabled}
              <div class="field">
                <div class="label">Hoekradius R (mm)</div>
                <button
                  type="button"
                  class="valueBox"
                  on:click={() =>
                    openNumpad({
                      title: "Hoekradius R (mm)",
                      value: rect.cornerRadius,
                      min: 0.1,
                      max: rectMaxRadius(),
                      apply: setRectCornerRadius
                    })}
                >
                  {rect.cornerRadius.toFixed(1)} mm
                </button>
              </div>
            {/if}

            <div class="field">
              <div class="label">Oriëntatie</div>
              <button
                type="button"
                class="valueBox"
                on:click={toggleRectOrientation}
              >
                {orientationLabel(rect.orientation)}
              </button>
            </div>
          {:else if selected === "slot"}
            <div class="field">
              <div class="label">Lengte L (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Lengte L (mm)",
                    value: slot.length,
                    min: slot.width,
                    max: slotLengthMax(),
                    apply: (v) => {
                      slot = { ...slot, length: v };
                      normalizeSlot();
                      markShapeFieldConfigured('length');
                    }
                  })}
              >
                {slot.length.toFixed(1)} mm
              </button>
            </div>

            <div class="field">
              <div class="label">Breedte B (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Breedte B (mm)",
                    value: slot.width,
                    min: 0.1,
                    max: Math.min(slotWidthMax(), slot.length),
                    apply: (v) => {
                      slot = { ...slot, width: v };
                      normalizeSlot();
                      markShapeFieldConfigured('width');
                    }
                  })}
              >
                {slot.width.toFixed(1)} mm
              </button>
            </div>

            <div class="field">
              <div class="label">Oriëntatie</div>
              <button
                type="button"
                class="valueBox"
                on:click={toggleSlotOrientation}
              >
                {orientationLabel(slot.orientation)}
              </button>
            </div>
          {:else}
            <div class="field">
              <div class="label">Steekmaat S (mm)</div>
              <button
                type="button"
                class="valueBox"
                on:click={() =>
                  openNumpad({
                    title: "Steekmaat S (mm)",
                    value: hex.acrossFlats,
                    min: 0.1,
                    max: xyFitMax(),
                    apply: (v) => {
                      hex = { acrossFlats: v };
                      normalizeHex();
                      markShapeFieldConfigured('acrossFlats');
                    }
                  })}
              >
                {hex.acrossFlats.toFixed(1)} mm
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="helperBox">
          <strong>Nog geen vorm gekozen</strong>
          Kies eerst een van de vier vormen hierboven. Daarna verschijnen hier direct de juiste invoervelden.
        </div>
      {/if}

      <div class="helperBox" style="margin-top: 12px;">
        <strong>Werkgebied</strong>
        Werkgebied X: {fmtLimit(xTravel)} mm, Y: {fmtLimit(yTravel)} mm. Te hoge of te lage invoer wordt bij bevestigen automatisch naar de veilige grens gezet.
      </div>
    </div>

    <div class="panel stagePanel" bind:this={previewPanel}>
      <div class="sectionHead">
        <div class="panelTitle">Preview</div>
        <div class="sectionHint">
          {#if selected}
            Controleer de vorm visueel voordat je de snijtaak voorbereidt.
          {:else}
            Hier verschijnt de preview zodra een vorm is gekozen.
          {/if}
        </div>
      </div>

      {#if selected}
        <button type="button" class="previewWrap previewButton" on:click={() => doAutoScroll(cutPanel)} aria-label="Ga naar snijproces">
          {#if selected === "circle"}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={circlePreviewRadius()} fill="none" stroke="#6aa7ff" stroke-width="5" />
            </svg>
          {:else if selected === "rect"}
            {@const box = fitPreview(rectXSize(), rectYSize())}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={rectPreviewRadius(box)} ry={rectPreviewRadius(box)} fill="none" stroke="#6aa7ff" stroke-width="5" />
            </svg>
          {:else if selected === "slot"}
            {@const box = fitPreview(slotXSize(), slotYSize())}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={slotPreviewRadius(box)} ry={slotPreviewRadius(box)} fill="none" stroke="#6aa7ff" stroke-width="5" />
            </svg>
          {:else}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <polygon points={hexPointsForPreview(hex.acrossFlats)} fill="none" stroke="#6aa7ff" stroke-width="5" />
            </svg>
          {/if}
        </button>

        <div class="previewInfo">
          <div>De preview blijft visueel op vaste grootte zodat vormen makkelijker te vergelijken zijn.</div>
          <div>Tik op de preview om naar het snijproces te gaan.</div>
        </div>
      {:else}
        <div class="helperBox">
          <strong>Geen preview beschikbaar</strong>
          Kies een vorm om hier direct de contour te zien.
        </div>
      {/if}
    </div>

    <div class="panel stagePanel" bind:this={cutPanel}>
      <div class="sectionHead">
        <div class="panelTitle">Snijden</div>
      </div>

      <div class="helperBox" style="margin-bottom: 12px;">
        <strong>Snijparameters</strong>
        Rechte contouren gebruiken de rechte snijsnelheid. Cirkels, sleufbogen en afgeronde rechthoekhoeken gebruiken de bochtsnelheid. Tijden worden als echte seconden naar Klipper vertaald.
      </div>

      <div class="processGrid">
        <div class="field">
          <div class="label">Recht snijden</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Recht snijden (mm/min)', 'straightFeedRate', 'mm/min')}
          >
            {cutProcess.straightFeedRate} mm/min
          </button>
        </div>

        <div class="field">
          <div class="label">Bochten</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Bochten (mm/min)', 'curveFeedRate', 'mm/min')}
          >
            {cutProcess.curveFeedRate} mm/min
          </button>
        </div>

        <div class="field">
          <div class="label">Snijhoogte</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Snijhoogte (mm)', 'cutHeight', 'mm')}
          >
            {fmtClean(cutProcess.cutHeight)} mm
          </button>
        </div>

        <div class="field">
          <div class="label">Contact-offset</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Contact-offset (mm)', 'contactOffset', 'mm')}
          >
            {fmtClean(cutProcess.contactOffset)} mm
          </button>
        </div>

        <div class="field">
          <div class="label">Z omlaag contact</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Z omlaag contact (mm/min)', 'contactDownSpeed', 'mm/min')}
          >
            {cutProcess.contactDownSpeed} mm/min
          </button>
        </div>

        <div class="field">
          <div class="label">Z omhoog contact</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Z omhoog contact (mm/min)', 'contactLiftSpeed', 'mm/min')}
          >
            {cutProcess.contactLiftSpeed} mm/min
          </button>
        </div>

        <div class="field">
          <div class="label">Voorlooptijd toorts</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Voorlooptijd toorts (s)', 'torchLeadTime', 's')}
          >
            {fmtClean(cutProcess.torchLeadTime)} s
          </button>
        </div>

        <div class="field">
          <div class="label">Pauze na contact</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Pauze na contact (s)', 'contactSettleTime', 's')}
          >
            {fmtClean(cutProcess.contactSettleTime)} s
          </button>
        </div>

        <div class="field">
          <div class="label">Pierce delay</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Pierce delay (s)', 'pierceDelay', 's')}
          >
            {fmtClean(cutProcess.pierceDelay)} s
          </button>
        </div>

        <div class="field">
          <div class="label">Eind-lift hoogte</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Eind-lift hoogte (mm)', 'finishLiftHeight', 'mm')}
          >
            {fmtClean(cutProcess.finishLiftHeight)} mm
          </button>
        </div>

        <div class="field">
          <div class="label">Eind-lift snelheid</div>
          <button
            type="button"
            class="valueBox"
            on:click={() => openCutProcessPad('Eind-lift snelheid (mm/min)', 'finishLiftSpeed', 'mm/min')}
          >
            {cutProcess.finishLiftSpeed} mm/min
          </button>
        </div>
      </div>

      <div class="flowStatusRow">
        {#if status !== "idle"}
          <div class={workflowPill().cls}>{workflowPill().txt}</div>
        {/if}
        <div class="helperBox flowMessage">
          <strong>Status</strong>
          {#if status === "idle"}
            {idleStatusMessage()}
          {:else if selected}
            {statusMsg}
          {:else}
            Kies eerst een vorm om de snijflow te activeren.
          {/if}
        </div>
      </div>

      {#if preparedSummary && status === "success"}
        <div class="helperBox" style="margin-top: 10px;">
          <strong>Laatst gesneden</strong>
          {preparedSummary}
        </div>
      {/if}

      <div class="actionBar" style="margin-top: 12px;">
        <button class="primary cutButton" on:click={requestCut}>Snijden</button>
      </div>
    </div>
  </div>
</div>

{#if showCutConfirm}
  <div class="modalBack">
    <div class="modal" role="dialog" aria-modal="true">
      <h2 class="modalTitle">Snijden bevestigen</h2>
      <div class="modalText">
        Start snijden van {preparedSummary}.

        Houd vingers vrij van bewegende delen. Controleer of de toorts vrij kan bewegen en de noodstop bereikbaar is.
      </div>
      <div class="modalActions">
        <button class="secondary" on:click={cancelCutConfirm}>Annuleren</button>
        <button class="primary" on:click={confirmCut}>Snijden</button>
      </div>
    </div>
  </div>
{/if}

<NumberPad
  open={padOpen}
  title={padTitle}
  value={padValue}
  subtitle={`Huidig: ${fmtClean(padCurrent)} ${padUnit} · Toegestaan: ${fmtClean(padMin)} – ${fmtClean(padMax)} ${padUnit}`}
  error={padError}
  onClose={padCancel}
  onAppend={padAppend}
  onBackspace={padBackspace}
  onClear={padClear}
  onConfirm={padOk}
/>
