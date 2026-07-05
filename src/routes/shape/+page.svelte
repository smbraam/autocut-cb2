<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { emergencyStopState } from '$lib/emergency-stop-state';
  import { machineApi } from '$lib/machine-api';
  import { DEFAULT_CUT_FEED_RATE, MAX_CUT_FEED_RATE, MIN_CUT_FEED_RATE, clampCutFeedRate } from '$lib/cut-speed';
  import { DEFAULT_CUT_HEIGHT, MAX_CUT_HEIGHT, MIN_CUT_HEIGHT, clampCutHeight, DEFAULT_PIERCE_DELAY, DEFAULT_APPROACH_SPEED } from '$lib/cut-height';
  import { uiSettings } from '$lib/ui-settings';

  const XY_DEFAULT_MAX = 100; // fallback mm slag in X en Y
  const CIRCLE_SEGMENTS = 64; // smooth genoeg

  type ShapeId = "circle" | "slot" | "rect" | "hex";
  type Status = "idle" | "ready" | "waiting" | "busy" | "success" | "error";

  type CircleCfg = { diameter: number };
  type RectCfg = { length: number; width: number };
  type SlotCfg = { length: number; width: number }; // radius = width/2
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

  const shapes: { id: ShapeId; title: string; subtitle: string }[] = [
    { id: "circle", title: "Cirkel", subtitle: "Ø diameter" },
    { id: "slot", title: "Sleufgat", subtitle: "L, B (R=B/2)" },
    { id: "rect", title: "Rechthoek", subtitle: "L, B" },
    { id: "hex", title: "Zeskant", subtitle: "S (steekmaat)" }
  ];

  let selected: ShapeId | null = "circle";

  // Config defaults (mm)
  let circle: CircleCfg = { diameter: 20 };
  let rect: RectCfg = { length: 40, width: 20 };
  let slot: SlotCfg = { length: 60, width: 12 };
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
  let feedDefault = DEFAULT_CUT_FEED_RATE;
  let cutHeight = DEFAULT_CUT_HEIGHT;
  let developerMode = true;
  let hasConfiguredShape = false;
  let configuredFields: string[] = [];
  let xTravel = XY_DEFAULT_MAX;
  let yTravel = XY_DEFAULT_MAX;

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

  // --- Helpers ---
  function setError(msg: string) {
    lastError = msg;
    console.error(msg);
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

  function xMax() {
    return xTravel;
  }

  function yMax() {
    return yTravel;
  }

  function xyFitMax() {
    return Math.min(xTravel, yTravel);
  }

  function isHomedXY() {
    return homedAxes.includes("x") && homedAxes.includes("y");
  }

  async function sendGcode(script: string) {
    lastError = "";
    await machineApi.sendGcode(script);
  }

  async function emergencyStopMachine() {
    try {
      await machineApi.emergencyStop();
      emergencyStopState.activate();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  // --- Poll machine status ---
  async function refreshMachine() {
    try {
      const r = await machineApi.getStatus(true);
      const st = r?.result?.status ?? {};
      const ps = st.print_stats?.state ?? "";
      const wh = st.webhooks?.state ?? "";
      const message = st.display_status?.message ?? st.webhooks?.state_message ?? st.print_stats?.message ?? '';
      const toolhead = st.toolhead ?? {};
      const cfg = st.configfile?.settings ?? {};

      homedAxes = toolhead.homed_axes ?? '';

      const sx = cfg['carriage x'] ?? cfg['stepper_x'] ?? {};
      const sy = cfg['carriage y'] ?? cfg['stepper_y'] ?? {};
      const xMin = Number(sx.position_min ?? 0);
      const xLimit = Number(sx.position_max ?? XY_DEFAULT_MAX);
      const yMin = Number(sy.position_min ?? 0);
      const yLimit = Number(sy.position_max ?? XY_DEFAULT_MAX);
      xTravel = Math.max(0.1, xLimit - xMin);
      yTravel = Math.max(0.1, yLimit - yMin);
      normalizeAll();

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
    }
  }

  // --- Validation per shape (clamp op actuele X/Y-slag) ---
  function normalizeCircle() {
    circle = { diameter: clamp(circle.diameter, 0.1, xyFitMax()) };
  }

  function normalizeRect() {
    rect = {
      length: clamp(rect.length, 0.1, yMax()),
      width: clamp(rect.width, 0.1, xMax())
    };
  }

  function normalizeHex() {
    hex = { acrossFlats: clamp(hex.acrossFlats, 0.1, xyFitMax()) };
  }

  function normalizeSlot() {
    const maxWidth = Math.min(xMax(), yMax());
    let w = clamp(slot.width, 0.1, maxWidth);
    let l = clamp(slot.length, w, xMax());
    slot = { length: l, width: w };
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

  function persistFeedRate() {
    if (!browser) return;
    localStorage.setItem(SHAPE_FEED_RATE_STORAGE_KEY, String(feedDefault));
  }

  function persistCutHeight() {
    if (!browser) return;
    localStorage.setItem(SHAPE_CUT_HEIGHT_STORAGE_KEY, String(cutHeight));
  }

  function loadFeedRate() {
    if (!browser) return;
    const stored = localStorage.getItem(SHAPE_FEED_RATE_STORAGE_KEY);
    feedDefault = stored === null ? DEFAULT_CUT_FEED_RATE : clampCutFeedRate(Number(stored), DEFAULT_CUT_FEED_RATE);
  }

  function loadCutHeight() {
    if (!browser) return;
    const stored = localStorage.getItem(SHAPE_CUT_HEIGHT_STORAGE_KEY);
    cutHeight = stored === null ? DEFAULT_CUT_HEIGHT : clampCutHeight(Number(stored), DEFAULT_CUT_HEIGHT);
  }

  function setFeedRate(value: number) {
    feedDefault = clampCutFeedRate(value, feedDefault);
    persistFeedRate();
    resetPrepared();
  }

  function setCutHeight(value: number) {
    cutHeight = clampCutHeight(value, cutHeight);
    persistCutHeight();
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
        width: Number(parsed.rect?.width ?? rect.width) || rect.width
      };
      slot = {
        length: Number(parsed.slot?.length ?? slot.length) || slot.length,
        width: Number(parsed.slot?.width ?? slot.width) || slot.width
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

  function canPrepareCut() {
    return selected !== null && hasConfiguredShape && mrState !== "error" && isHomedXY();
  }

  function idleStatusMessage() {
    if (!selected) return "Kies eerst een vorm om de snijflow te activeren.";
    if (!isHomedXY()) return "Zorg dat de machine eerst volledig gehomed is.";
    return "Controleer de preview en bereid de snijtaak voor.";
  }

  // --- G-code generation (XY only, relative for safety) ---
  function gcodeHeader() {
    return [
      "; AutoCut shape cut (XY only)",
      "M400",
      "G90",
      "G21",
      `G91 ; relative moves`,
      `G1 F${feedDefault}`
    ];
  }

  function gcodeContactStart(cutHeightMm: number) {
    // Contact start procedure:
    // 1. Toorts bekrachtigen
    // 2. Langzaam naar beneden bewegen (approach)
    // 3. Materiaal raken (Z=0 assumed after touch)
    // 4. Omhoog naar snijhoogte
    // 5. Pierce delay
    const approachSpeed = DEFAULT_APPROACH_SPEED; // mm/min
    const pierceDelay = DEFAULT_PIERCE_DELAY; // seconds
    
    return [
      "; Contact start procedure",
      "TORCH_ON",
      `G1 Z-10 F${approachSpeed} ; langzaam naar beneden tot materiaal contact`,
      "G4 P0.1 ; korte pauze na contact",
      `G1 Z${cutHeightMm.toFixed(3)} F${approachSpeed * 2} ; omhoog naar snijhoogte`,
      `G4 P${pierceDelay.toFixed(2)} ; pierce delay`,
      "; Start snijden"
    ];
  }

  function gcodeFooter() {
    return [
      "; Einde snijden",
      "TORCH_OFF",
      "M400",
      `G1 Z10 F${DEFAULT_APPROACH_SPEED * 2} ; omhoog na snijden`,
      "G90 ; back to absolute",
      "; end"
    ];
  }

  function genRect(L: number, B: number) {
    // X is breedte, Y is lengte. Teken gecentreerd rond de huidige positie.
    const halfL = L / 2;
    const halfB = B / 2;

    const lines = [
      `G1 X${(-halfB).toFixed(3)} Y${(-halfL).toFixed(3)}`,
      `G1 X${(B).toFixed(3)} Y0`,
      `G1 X0 Y${(L).toFixed(3)}`,
      `G1 X${(-B).toFixed(3)} Y0`,
      `G1 X0 Y${(-L).toFixed(3)}`,
      `G1 X${(halfB).toFixed(3)} Y${(halfL).toFixed(3)} ; back to center`
    ];
    return { lines, summary: `Rechthoek L=${fmt(L)} B=${fmt(B)}` };
  }

  function genHex(S: number) {
    // Regular hexagon centered. Across flats S.
    // apothem a = S/2. circumradius R = a / cos(30) = (S/2)/0.8660254
    const a = S / 2;
    const R = a / 0.866025403784;
    // 6 vertices at angles -90, -30, 30, 90, 150, 210 (deg)
    const ang = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
    const pts = ang.map((t) => ({ x: R * Math.cos(t), y: R * Math.sin(t) }));

    // Move to first vertex relative from center, then draw edges by delta between consecutive points, then back to center.
    const first = pts[0];
    const moves: string[] = [];
    moves.push(`G1 X${first.x.toFixed(3)} Y${first.y.toFixed(3)}`);
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      moves.push(`G1 X${dx.toFixed(3)} Y${dy.toFixed(3)}`);
    }
    // close back to first
    const dx0 = pts[0].x - pts[pts.length - 1].x;
    const dy0 = pts[0].y - pts[pts.length - 1].y;
    moves.push(`G1 X${dx0.toFixed(3)} Y${dy0.toFixed(3)}`);
    // return to center
    moves.push(`G1 X${(-first.x).toFixed(3)} Y${(-first.y).toFixed(3)} ; back to center`);

    return { lines: moves, summary: `Zeskant S=${fmt(S)}` };
  }

  function genCircle(d: number) {
    const r = d / 2;
    // polygon approximation around center
    const N = CIRCLE_SEGMENTS;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }

    const moves: string[] = [];
    // move from center to first point
    moves.push(`G1 X${pts[0].x.toFixed(3)} Y${pts[0].y.toFixed(3)}`);
    for (let i = 1; i < pts.length; i++) {
      moves.push(`G1 X${(pts[i].x - pts[i - 1].x).toFixed(3)} Y${(pts[i].y - pts[i - 1].y).toFixed(3)}`);
    }
    // close
    moves.push(`G1 X${(pts[0].x - pts[pts.length - 1].x).toFixed(3)} Y${(pts[0].y - pts[pts.length - 1].y).toFixed(3)}`);
    // return to center
    moves.push(`G1 X${(-pts[0].x).toFixed(3)} Y${(-pts[0].y).toFixed(3)} ; back to center`);

    return { lines: moves, summary: `Cirkel Ø=${fmt(d)}` };
  }

  function genSlot(L: number, B: number) {
    // Slot: rectangle with semicircle ends.
    // We approximate arcs with segments too.
    const R = B / 2;
    const straight = L - 2 * R;
    // If straight is 0, it's a circle (but normalizeSlot ensures L>=B so straight>=0)
    const seg = 24; // arc segments per half circle

    // We build the path centered. Start at left-middle of slot, go to left-top arc, across, right arc, back.
    // Strategy (relative):
    // Move to start point: (-L/2, 0) + (0, +R) ? Let's start at left-top point.
    // left-top point relative from center: x = -straight/2, y = +R
    const x0 = -straight / 2;
    const y0 = R;

    const moves: string[] = [];
    moves.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} ; to start (left-top)`);

    // top straight to right-top
    moves.push(`G1 X${straight.toFixed(3)} Y0`);

    // right half circle (top to bottom) around right end, center at (+straight/2, 0)
    // param from 90deg to -90deg
    let prev = { x: 0, y: 0 };
    for (let i = 0; i <= seg; i++) {
      const t = (90 - (180 * i) / seg) * (Math.PI / 180);
      const x = R * Math.cos(t);
      const y = R * Math.sin(t);
      if (i === 0) prev = { x, y };
      else {
        moves.push(`G1 X${(x - prev.x).toFixed(3)} Y${(y - prev.y).toFixed(3)}`);
        prev = { x, y };
      }
    }

    // bottom straight back to left-bottom
    moves.push(`G1 X${(-straight).toFixed(3)} Y0`);

    // left half circle (bottom to top) around left end, center at (-straight/2,0)
    // param from -90deg to 90deg
    prev = { x: 0, y: 0 };
    for (let i = 0; i <= seg; i++) {
      const t = (-90 + (180 * i) / seg) * (Math.PI / 180);
      const x = R * Math.cos(t);
      const y = R * Math.sin(t);
      if (i === 0) prev = { x, y };
      else {
        moves.push(`G1 X${(x - prev.x).toFixed(3)} Y${(y - prev.y).toFixed(3)}`);
        prev = { x, y };
      }
    }

    // Now we are back at left-top. Return to center: from left-top to center is (+straight/2, -R)
    moves.push(`G1 X${(straight / 2).toFixed(3)} Y${(-R).toFixed(3)} ; back to center`);

    return { lines: moves, summary: `Sleufgat L=${fmt(L)} B=${fmt(B)} (R=${fmt(R)})` };
  }

  function buildGcodeForSelection() {
    normalizeAll();

    if (!selected) {
      throw new Error("Geen vorm geselecteerd.");
    }

    let body: { lines: string[]; summary: string };

    if (selected === "circle") body = genCircle(circle.diameter);
    else if (selected === "rect") body = genRect(rect.length, rect.width);
    else if (selected === "slot") body = genSlot(slot.length, slot.width);
    else body = genHex(hex.acrossFlats);

    const gcode = [...gcodeHeader(), ...gcodeContactStart(cutHeight), ...body.lines, ...gcodeFooter()].join("\n");
    return { gcode, summary: body.summary };
  }

  // --- Flow: prepare then wait for physical START ---
  async function prepareCut() {
    lastError = "";

    if (mrState === "error") {
      status = "error";
      statusMsg = "Machine in alarm. Los eerst op in Klipper/Mainsail.";
      return;
    }

    if (!isHomedXY()) {
      status = "error";
      statusMsg = "Zorg dat de machine eerst volledig gehomed is.";
      return;
    }

    const { gcode, summary } = buildGcodeForSelection();
    preparedGcode = gcode;
    preparedSummary = summary;

    try {
      await sendGcode('M117 Klaar om te snijden');
    } catch {
      // voorbereiding mag zichtbaar blijven zonder display-update
    }

    status = "waiting";
    statusMsg = "Klaar om te snijden. Machine wacht op de fysieke triggerknop.";
    doAutoScroll(cutPanel);
  }

  async function abortPreparedCut() {
    resetPrepared();
    try {
      await sendGcode('M117 Voorbereiding afgebroken');
    } catch {
      // ignore display update failure
    }
  }

  // This will be replaced later by GPIO trigger.
  async function startCutNow() {
    lastError = "";

    if (!preparedGcode) {
      status = "error";
      statusMsg = "Geen G-code voorbereid.";
      return;
    }

    try {
      status = "busy";
      statusMsg = "Bezig met snijden…";

      try {
        await sendGcode('M117 Snijden bezig');
      } catch {
        // ignore display update failure
      }

      // send as one script
      await sendGcode(preparedGcode);

      status = "success";
      statusMsg = "Snijden succesvol ✅";
    } catch (e: any) {
      status = "error";
      statusMsg = "Fout bij snijden";
      setError(e?.message ?? String(e));
      alert(`Fout bij snijden:\n${e?.message ?? e}`);
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

  function hexPointsForPreview(S: number) {
    const px = 76;
    const cx = VB / 2;
    const cy = VB / 2;
    const a = px / 2;
    const R = a / 0.866025403784; // circumradius
    const ang = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
    return ang
      .map((t) => `${(cx + R * Math.cos(t)).toFixed(2)},${(cy + R * Math.sin(t)).toFixed(2)}`)
      .join(" ");
  }

  function workflowPill() {
    if (status === "idle") return { txt: "Idle", cls: "pill idle" };
    if (status === "ready") return { txt: "Klaar", cls: "pill ready" };
    if (status === "waiting") return { txt: "Wacht", cls: "pill waiting" };
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
    loadShapeConfig();
    loadFeedRate();
    loadCutHeight();
    hasConfiguredShape = selected !== null;
    void refreshMachine();
    const poll = setInterval(refreshMachine, 1000);
    const unsubscribe = uiSettings.subscribe((value) => {
      developerMode = value.developerMode;
      autoScroll = value.autoScroll ?? true;
    });

    return () => {
      clearInterval(poll);
      unsubscribe();
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
  .pill.waiting { color: #a9ffcf; border-color: #1f6a49; }
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

  .cutSetupGrid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 10px;
    align-items: stretch;
    margin-bottom: 12px;
  }

  .flowMessage {
    width: 100%;
  }

  /* Numpad modal */
  .modalBack {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    display: grid;
    place-items: center;
    z-index: 999;
    padding: 12px;
  }

  .modal {
    width: min(100%, 400px);
    background: #0f1522;
    border: 1px solid #1e2a40;
    border-radius: 20px;
    padding: 14px;
  }

  .modalHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .modalTitle { font-weight: 950; font-size: 16px; }
  .modalTitle { font-weight: 950; font-size: 17px; }
  .modalValue {
    font-size: 30px;
    font-weight: 980;
    background: #0b101b;
    border: 1px solid #1e2a40;
    border-radius: 16px;
    padding: 10px 12px;
    min-height: 58px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
    margin-bottom: 8px;
  }

  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .pad button {
    padding: 16px 0;
    font-size: 18px;
    border-radius: 16px;
  }
  .pad .wide { grid-column: span 2; }

  @media (max-width: 760px) {
    .shapeGrid,
    .fieldGrid,
    .cutSetupGrid,
    .actionBar,
    .actionBar.three,
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
                    <rect x="24" y="38" width="72" height="44" rx="6" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {:else if s.id === "slot"}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <rect x="24" y="44" width="72" height="32" rx="16" ry="16" fill="none" stroke="#6aa7ff" stroke-width="6" />
                  </svg>
                {:else}
                  <svg width="60" height="60" viewBox="0 0 120 120">
                    <polygon points="60,26 90,43 90,77 60,94 30,77 30,43" fill="none" stroke="#6aa7ff" stroke-width="6" />
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
                    max: yMax(),
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
                    max: xMax(),
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
                    max: xMax(),
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
                    max: Math.min(xMax(), yMax()),
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
            {@const box = fitPreview(rect.width, rect.length)}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="6" fill="none" stroke="#6aa7ff" stroke-width="5" />
            </svg>
          {:else if selected === "slot"}
            {@const box = fitPreview(slot.length, slot.width)}
            <svg class="bigSvg" viewBox="0 0 120 120">
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={box.h / 2} ry={box.h / 2} fill="none" stroke="#6aa7ff" stroke-width="5" />
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

      <div class="cutSetupGrid">
        <div class="field">
          <div class="label">Snijsnelheid</div>
          <button
            type="button"
            class="valueBox"
            on:click={() =>
              openNumpad({
                title: 'Snijsnelheid (mm/min)',
                value: feedDefault,
                min: MIN_CUT_FEED_RATE,
                max: MAX_CUT_FEED_RATE,
                unit: 'mm/min',
                apply: setFeedRate
              })}
          >
            {feedDefault} mm/min
          </button>
        </div>

        <div class="field">
          <div class="label">Snijhoogte</div>
          <button
            type="button"
            class="valueBox"
            on:click={() =>
              openNumpad({
                title: 'Snijhoogte (mm)',
                value: cutHeight,
                min: MIN_CUT_HEIGHT,
                max: MAX_CUT_HEIGHT,
                unit: 'mm',
                apply: setCutHeight
              })}
          >
            {cutHeight.toFixed(1)} mm
          </button>
        </div>
      </div>

      <div class="helperBox" style="margin-bottom: 12px;">
        <strong>Snij parameters</strong>
        Snijsnelheid en snijhoogte worden meegenomen in de gegenereerde G-code. De snijhoogte wordt aangehouden tijdens het snijproces na de contactstart.
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

      {#if preparedSummary}
        <div class="helperBox" style="margin-top: 10px;">
          <strong>Voorbereid</strong>
          {preparedSummary}
        </div>
      {/if}

      <div class="actionBar three" style="margin-top: 12px;">
        <button class="primary" disabled={!canPrepareCut() || status === "busy"} on:click={prepareCut}>Snijden voorbereiden</button>
        {#if status === "waiting"}
          <button class="secondary" on:click={abortPreparedCut}>Afbreken</button>
        {:else}
          <div></div>
        {/if}
        {#if status === "waiting" && developerMode}
          <button class="secondary" on:click={startCutNow}>START test</button>
        {:else}
          <div></div>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if padOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="modalBack"
    role="button"
    tabindex="0"
    aria-label="Sluit keypad"
    on:click|self={padCancel}
    on:keydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') padCancel();
    }}
  >
    <div class="modal">
      <div class="modalHead">
        <div class="modalTitle">{padTitle}</div>
        <button class="ghost" on:click={padCancel}>Sluiten</button>
      </div>

      <div class="modalValue">{padValue || '\u00A0'}</div>
      <div class="submsg" style="margin-bottom: 12px;">Huidig: {fmt(padCurrent)} {padUnit} · Toegestaan: {fmtLimit(padMin)} – {fmtLimit(padMax)} {padUnit}</div>

      {#if padError}
        <div class="errorBox">{padError}</div>
      {/if}

      <div class="pad">
        <button on:click={() => padAppend("1")}>1</button>
        <button on:click={() => padAppend("2")}>2</button>
        <button on:click={() => padAppend("3")}>3</button>

        <button on:click={() => padAppend("4")}>4</button>
        <button on:click={() => padAppend("5")}>5</button>
        <button on:click={() => padAppend("6")}>6</button>

        <button on:click={() => padAppend("7")}>7</button>
        <button on:click={() => padAppend("8")}>8</button>
        <button on:click={() => padAppend("9")}>9</button>

        <button on:click={() => padAppend(".")}>.</button>
        <button on:click={() => padAppend("0")}>0</button>
        <button on:click={padBackspace}>⌫</button>

        <button class="danger" on:click={padClear}>Clear</button>
        <button class="wide primary" on:click={padOk}>Enter</button>
      </div>
    </div>
  </div>
{/if}