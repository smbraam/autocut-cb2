<!-- ASSISTANT QUESTION: I cannot run `git status` from here. Do you want me to (A) prepare edits now, (B) have you paste the output of `git status`, or (C) run git commands if you paste results? Reply with A, B, or C. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { uploadShapeFile, setReadyToCutState } from '$lib';

  const XY_MAX = 100; // mm slag in X en Y
  const FEED_DEFAULT = 1200; // mm/min (later instelbaar)
  const CIRCLE_SEGMENTS = 64; // smooth genoeg

  type ShapeId = "circle" | "slot" | "rect" | "hex";
  type Status = "idle" | "ready" | "waiting" | "busy" | "success" | "error";

  type CircleCfg = { diameter: number };
  type RectCfg = { length: number; width: number };
  type SlotCfg = { length: number; width: number }; // radius = width/2
  type HexCfg = { acrossFlats: number }; // steekmaat / across flats

  const shapes: { id: ShapeId; title: string; subtitle: string }[] = [
    { id: "circle", title: "Cirkel", subtitle: "Ø diameter" },
    { id: "slot", title: "Sleufgat", subtitle: "L, B (R=B/2)" },
    { id: "rect", title: "Rechthoek", subtitle: "L, B" },
    { id: "hex", title: "Zeskant", subtitle: "S (steekmaat)" }
  ];

  type StageState = "complete" | "active" | "upcoming";
  type WorkflowStage = {
    id: number;
    label: string;
    description: string;
    state: StageState;
  };

  let selected: ShapeId = "circle";
  let shapeFile: File | null = null;

  // Config defaults (mm)
  let circle: CircleCfg = { diameter: 20 };
  let rect: RectCfg = { length: 40, width: 20 };
  let slot: SlotCfg = { length: 60, width: 12 };
  let hex: HexCfg = { acrossFlats: 30 };

  // Machine status from Moonraker
  let mrState = "Connecting…";
  let mrMessage = "";
  let homedAxes = ""; // e.g. "xy", "xyz"
  let connected = false;
  let lastError = "";

  // Shape flow status
  let status: Status = "idle";
  let statusMsg = "Selecteer een vorm en stel de maten in.";
  let preparedGcode = ""; // buffer
  let preparedSummary = "";

  $: hasPrepared = Boolean(preparedGcode);
  $: workflowStages = ((): WorkflowStage[] => {
    const stage2Complete =
      status === "ready" || status === "waiting" || status === "busy" || status === "success";
    const stage1State: StageState = hasPrepared || stage2Complete ? "complete" : "active";
    const stage2State: StageState = stage2Complete ? "complete" : hasPrepared ? "active" : "upcoming";
    const stage3State: StageState =
      status === "success"
        ? "complete"
        : status === "waiting" || status === "busy"
          ? "active"
          : "upcoming";

    return [
      {
        id: 1,
        label: "Configureer vorm",
        description: "Kies vorm en maten",
        state: stage1State
      },
      {
        id: 2,
        label: "Bereid job voor",
        description: stage2Complete
          ? "Geüpload naar Moonraker"
          : hasPrepared
            ? "Upload naar Moonraker"
            : "Genereer G-code",
        state: stage2State
      },
      {
        id: 3,
        label: "Start snede",
        description:
          status === "waiting"
            ? "Wacht op fysieke startknop"
            : status === "busy"
              ? "Snede bezig"
              : "Druk op de fysieke startknop",
        state: stage3State
      }
    ];
  })();

  $: canPrepareShape = connected && isHomedXY();
  $: canStartTest = status === "waiting" && Boolean(preparedGcode);
  $: selectedFileName = shapeFile ? shapeFile.name : "";

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
    return n.toFixed(1);
  }

  function isHomedXY() {
    return homedAxes.includes("x") && homedAxes.includes("y");
  }

  // --- Moonraker client (via nginx proxy /moonraker -> 7125) ---
  async function mrGet<T>(path: string): Promise<T> {
    const res = await fetch(`/moonraker${path}`);
    const txt = await res.text();

    try {
      const json = JSON.parse(txt);
      if (!res.ok || json?.error) throw new Error(json?.error?.message ?? txt);
      return json as T;
    } catch (e: any) {
      throw new Error(`Moonraker parse/error: ${e?.message ?? e}\nRaw: ${txt.slice(0, 300)}`);
    }
  }

  async function mrPost<T>(path: string, body?: any): Promise<T> {
    const res = await fetch(`/moonraker${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}"
    });

    const txt = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(txt);
    } catch (e: any) {
      throw new Error(`Moonraker returned non-JSON: ${txt.slice(0, 300)}`);
    }
    if (!res.ok || json?.error) throw new Error(json?.error?.message ?? txt);
    return json as T;
  }

  async function sendGcode(script: string) {
    lastError = "";
    await mrPost(`/printer/gcode/script`, { script });
  }

  // --- Poll machine status ---
  type ObjectsQuery = {
    result?: {
      status?: any;
    };
    error?: any;
  };

  async function refreshMachine() {
    try {
      const r = await mrGet<ObjectsQuery>(
        `/printer/objects/query?toolhead=homed_axes&print_stats=state&print_stats=message&webhooks=state&webhooks=state_message`
      );

      const st = r?.result?.status ?? {};
      connected = true;
      // Prefer print_stats for "printing/standby", webhooks for Klipper-level "ready/error"
      const ps = st.print_stats?.state ?? "";
      const wh = st.webhooks?.state ?? "";
      const msg = st.webhooks?.state_message ?? st.print_stats?.message ?? "";

      homedAxes = st.toolhead?.homed_axes ?? "";

      // Map to UI
      if (wh === "ready") {
        mrState = ps === "printing" ? "printing" : "ready";
        mrMessage = "";
      } else if (wh === "error") {
        mrState = "error";
        mrMessage = msg || "Unknown error";
      } else if (wh) {
        mrState = wh;
        mrMessage = msg || "";
      } else {
        mrState = ps || "unknown";
        mrMessage = msg || "";
      }
    } catch (e: any) {
      connected = false;
      mrState = "disconnected";
      mrMessage = "Moonraker not reachable";
      setError(e?.message ?? String(e));
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  function startPolling() {
    refreshMachine();
    timer = setInterval(refreshMachine, 1000);
  }

  onMount(() => {
    startPolling();

    return () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
  });

  // SvelteKit cleanup (dev hot reload)
  // @ts-ignore
  if (import.meta.hot) {
    // @ts-ignore
    import.meta.hot.dispose(() => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
  }

  // --- Validation per shape (clamp op XY_MAX) ---
  function normalizeCircle() {
    circle = { diameter: clamp(circle.diameter, 0.1, XY_MAX) };
  }

  function normalizeRect() {
    rect = {
      length: clamp(rect.length, 0.1, XY_MAX),
      width: clamp(rect.width, 0.1, XY_MAX)
    };
  }

  function normalizeHex() {
    hex = { acrossFlats: clamp(hex.acrossFlats, 0.1, XY_MAX) };
  }

  function normalizeSlot() {
    let w = clamp(slot.width, 0.1, XY_MAX);
    let l = clamp(slot.length, w, XY_MAX);
    slot = { length: l, width: w };
  }

  function normalizeAll() {
    normalizeCircle();
    normalizeRect();
    normalizeHex();
    normalizeSlot();
  }
  normalizeAll();

  function resetPreparationState(message = "Configureer je vorm") {
    status = "idle";
    statusMsg = message;
    preparedGcode = "";
    preparedSummary = "";
  }

  function markShapeDirty() {
    if (
      preparedGcode ||
      status === "ready" ||
      status === "waiting" ||
      status === "busy" ||
      status === "success" ||
      status === "error"
    ) {
      resetPreparationState("Vorm gewijzigd — bereid opnieuw voor.");
    }
  }

  function selectShape(id: ShapeId) {
    if (selected === id) return;
    selected = id;
    resetPreparationState("Configureer je vorm");
  }

  // --- Numpad modal ---
  let padOpen = false;
  let padTitle = "";
  let keypadInput = ""; // typed string (temporary, does not update original value)
  let padMin = 0;
  let padMax = XY_MAX;
  let padTarget: { apply: ((v: number) => void) | null; min: number; max: number; decimals: number } = {
    apply: null,
    min: 0,
    max: XY_MAX,
    decimals: 2
  };

  function openNumpad(opts: {
    title: string;
    value: number;
    min?: number;
    max?: number;
    decimals?: number;
    apply: (v: number) => void;
  }) {
    padTitle = opts.title;
    padMin = opts.min ?? 0;
    padMax = opts.max ?? XY_MAX;
    keypadInput = ""; // always start empty
    padTarget = {
      apply: opts.apply,
      min: padMin,
      max: padMax,
      decimals: opts.decimals ?? 2
    };
    padOpen = true;
  }

  function padAppend(ch: string) {
    // allow only digits and one dot
    if (!/^[0-9.]$/.test(ch)) return;

    // decimal point handling
    if (ch === ".") {
      if (keypadInput.includes(".")) return; // already have one
      if (keypadInput === "") {
        keypadInput = "0.";
      } else {
        keypadInput += ".";
      }
      return;
    }

    // digit handling, enforce max decimals if there's a dot
    if (keypadInput.includes(".")) {
      const parts = keypadInput.split(".");
      const decimals = parts[1].length;
      if (decimals >= padTarget.decimals) return;
      keypadInput += ch;
      return;
    }

    // leading zero behavior: replace "0" with new digit unless user intentionally types "0"
    if (keypadInput === "0" && ch !== ".") {
      keypadInput = ch;
      return;
    }

    keypadInput += ch;
  }

  function padBackspace() {
    if (!keypadInput) return;
    keypadInput = keypadInput.slice(0, -1);
  }

  function padClear() {
    keypadInput = ""; // Clear the input completely
  }

  function padCancel() {
    padOpen = false;
    padTarget = { apply: null, min: 0, max: XY_MAX, decimals: 2 };
    keypadInput = "";
  }

  function handlePadBackdropKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      padCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      padOk();
    }
  }

  function handlePadBackdropKeyUp(event: KeyboardEvent) {
    if (event.key === " " || event.key === "Space" || event.key === "Spacebar") {
      event.preventDefault();
      padCancel();
    }
  }

  function padOk() {
    // If nothing typed, do not change the original field
    if (!keypadInput || keypadInput.trim() === "") {
      padOpen = false;
      padTarget = { apply: null, min: 0, max: XY_MAX, decimals: 2 };
      keypadInput = "";
      return;
    }

    const raw = parseFloat(keypadInput.replace(",", "."));
    if (Number.isNaN(raw)) {
      // invalid number typed, just close without applying
      padOpen = false;
      padTarget = { apply: null, min: 0, max: XY_MAX, decimals: 2 };
      keypadInput = "";
      return;
    }

    // clamp to min/max
    const clamped = clamp(raw, padTarget.min, padTarget.max);
    // round to allowed decimals
    const factor = Math.pow(10, padTarget.decimals);
    const rounded = Math.round(clamped * factor) / factor;

    padTarget.apply?.(Number(rounded.toFixed(padTarget.decimals)));
    padOpen = false;
    padTarget = { apply: null, min: 0, max: XY_MAX, decimals: 2 };
    keypadInput = "";
  }

  // --- File upload ---
  function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      shapeFile = input.files[0];
    }
  }

  async function uploadFile() {
    if (!shapeFile) {
      setError('No file selected');
      return;
    }

    try {
      await uploadShapeFile(shapeFile);
      await setReadyToCutState();
      preparedGcode = "";
      preparedSummary = "";
      status = "ready";
      statusMsg = "G-code geüpload. Start via de machine of de START-knop.";
      shapeFile = null;

      if (typeof document !== "undefined") {
        const inputEl = document.getElementById("job-upload-input") as HTMLInputElement | null;
        if (inputEl) {
          inputEl.value = "";
        }
      }
    } catch (error: any) {
      setError(error.message);
      status = "error";
      statusMsg = "Failed to upload file";
    }
  }

  // --- G-code generation (XY only, relative for safety) ---
  function gcodeHeader() {
    return [
      "; AutoCut shape cut (XY only)",
      "M400",
      "G90",
      "G21",
      `G91 ; relative moves`,
      `G1 F${FEED_DEFAULT}`
    ];
  }

  function gcodeFooter() {
    return [
      "M400",
      "G90 ; back to absolute",
      "; end"
    ];
  }

  function genRect(L: number, B: number) {
    // Draw centered rectangle around current position.
    // Start by moving to bottom-left corner: (-L/2, -B/2), then loop.
    const halfL = L / 2;
    const halfB = B / 2;

    const lines = [
      `G1 X${(-halfL).toFixed(3)} Y${(-halfB).toFixed(3)}`,
      `G1 X${(L).toFixed(3)} Y0`,
      `G1 X0 Y${(B).toFixed(3)}`,
      `G1 X${(-L).toFixed(3)} Y0`,
      `G1 X0 Y${(-B).toFixed(3)}`,
      `G1 X${(halfL).toFixed(3)} Y${(halfB).toFixed(3)} ; back to center`
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

    let body: { lines: string[]; summary: string };

    if (selected === "circle") body = genCircle(circle.diameter);
    else if (selected === "rect") body = genRect(rect.length, rect.width);
    else if (selected === "slot") body = genSlot(slot.length, slot.width);
    else body = genHex(hex.acrossFlats);

    const gcode = [...gcodeHeader(), ...body.lines, ...gcodeFooter()].join("\n");
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
      statusMsg = "Machine moet eerst X en Y gehomed hebben (Home scherm).";
      return;
    }

    const { gcode, summary } = buildGcodeForSelection();
    preparedGcode = gcode;
    preparedSummary = summary;

    status = "waiting";
    statusMsg = "G-code voorbereid. Start wanneer de machine gereed is.";
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
  function mmToPx(mm: number) {
    const usable = 90;
    return (mm / XY_MAX) * usable;
  }

  function centerBoxSize(mmX: number, mmY: number) {
    const w = mmToPx(mmX);
    const h = mmToPx(mmY);
    const cx = VB / 2;
    const cy = VB / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  }

  function hexPointsForPreview(S: number) {
    // Across flats S, preview only
    const px = mmToPx(S);
    const cx = VB / 2;
    const cy = VB / 2;
    const a = px / 2;
    const R = a / 0.866025403784; // circumradius
    const ang = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
    return ang
      .map((t) => `${(cx + R * Math.cos(t)).toFixed(2)},${(cy + R * Math.sin(t)).toFixed(2)}`)
      .join(" ");
  }

  function statusPill() {
    if (status === "idle") return { txt: "Idle", cls: "statusPill" };
    if (status === "ready" || status === "success") {
      return { txt: status === "ready" ? "Klaar" : "Succes", cls: "statusPill ok" };
    }
    if (status === "waiting" || status === "busy") {
      return { txt: status === "waiting" ? "Wacht" : "Bezig", cls: "statusPill warn" };
    }
    return { txt: "Fout", cls: "statusPill err" };
  }

  function machinePill() {
    if (mrState === "ready") return { txt: "Ready", cls: "statusPill ok" };
    if (mrState === "printing") return { txt: "Printing", cls: "statusPill warn" };
    if (mrState === "error") return { txt: "Alarm", cls: "statusPill err" };
    if (mrState === "disconnected") return { txt: "Offline", cls: "statusPill err" };
    return { txt: mrState, cls: "statusPill" };
  }
</script>

<style>
  .shapePage {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .heroCard {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .heroContent {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
    align-items: flex-start;
  }

  .pillRow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .heroStats {
    display: grid;
    gap: var(--space-2);
    min-width: clamp(240px, 32vw, 320px);
  }

  .statCard {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .statLabel {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .statValue {
    font-size: clamp(18px, 3.6vw, 22px);
    font-weight: 800;
    color: var(--text-strong);
  }

  .statMeta {
    font-size: var(--font-size-xs);
    color: var(--text-medium);
  }

  .heroMessage {
    font-size: var(--font-size-sm);
  }

  .heroMessage.err {
    color: #ffb5b5;
  }

  .heroMessage.info {
    color: var(--text-medium);
  }

  .workflowRail {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-3);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }

  .workflowRail::-webkit-scrollbar {
    height: 6px;
  }

  .workflowRail::-webkit-scrollbar-thumb {
    background: rgba(32, 46, 73, 0.9);
    border-radius: 999px;
  }

  .stageCard {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    scroll-snap-align: center;
    transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease;
  }

  .stageCard.active {
    border-color: rgba(106, 167, 255, 0.45);
    box-shadow: 0 0 0 1px rgba(106, 167, 255, 0.18) inset;
  }

  .stageCard.complete {
    border-color: rgba(45, 204, 113, 0.4);
    box-shadow: 0 0 0 1px rgba(45, 204, 113, 0.18) inset;
    background: rgba(20, 68, 44, 0.35);
  }

  .stageCard.upcoming {
    opacity: 0.65;
  }

  .stageIndex {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: rgba(106, 167, 255, 0.18);
    color: var(--text-strong);
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: var(--font-size-sm);
    flex: 0 0 auto;
  }

  .stageCard.complete .stageIndex {
    background: rgba(45, 204, 113, 0.28);
    color: #a8f9c6;
  }

  .stageLabel {
    font-weight: 800;
    font-size: var(--font-size-md);
  }

  .stageDesc {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    margin-top: 2px;
  }

  .mainGrid {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    align-items: start;
  }

  .selectorCard,
  .configCard,
  .jobCard {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panelTitle {
    font-weight: 800;
    font-size: var(--font-size-lg);
    margin: 0;
  }

  .panelHint {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    margin: 0;
  }

  .shapeList {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .shapeTile {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-surface-alt);
    width: 100%;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.14s ease, background 0.14s ease, transform 0.1s ease;
  }

  .shapeTile:hover {
    border-color: rgba(106, 167, 255, 0.4);
  }

  .shapeTile:active {
    transform: translateY(1px);
  }

  .shapeTile.selected {
    border-color: rgba(106, 167, 255, 0.55);
    box-shadow: 0 0 0 2px rgba(106, 167, 255, 0.18);
    background: rgba(106, 167, 255, 0.1);
    color: var(--text-strong);
  }

  .shapeIcon {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    background: #0b101b;
    border: 1px solid var(--border-color);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .shapeText {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .shapeTitle {
    font-weight: 800;
    font-size: var(--font-size-md);
  }

  .shapeSubtitle {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .configSplit {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }

  .previewPane,
  .fieldsPane {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }

  .splitTitle {
    font-weight: 800;
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .previewWrap {
    background: #0b101b;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    padding: var(--space-2);
    display: grid;
    place-items: center;
  }

  .bigSvg {
    width: min(100%, 360px);
    height: auto;
    border-radius: var(--radius-md);
    background: #0b101b;
    border: 1px solid var(--border-color);
  }

  .fields {
    display: grid;
    gap: var(--space-2);
  }

  .field {
    display: grid;
    gap: var(--space-1);
  }

  .label {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-weight: 700;
  }

  .valueBox {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-weight: 750;
    cursor: pointer;
    display: block;
    width: 100%;
    text-align: left;
    color: inherit;
    appearance: none;
    min-height: 0;
  }

  .hintRow {
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .jobStatusRow {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .jobButtons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .jobUpload {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .jobActions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .fileInput {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-alt);
    color: var(--text-medium);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .fileInput input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .fileLabel {
    font-weight: 600;
  }

  .selectedFile {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .preparedSummary {
    font-size: var(--font-size-sm);
    color: var(--text-medium);
  }

  .gcodePreview {
    margin-top: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid #223254;
    background: #0b101b;
    color: #cfe1ff;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: var(--font-size-xs);
    max-height: 200px;
    overflow: auto;
    white-space: pre;
  }

  .modalBack {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 999;
    padding: var(--space-4);
  }

  .modal {
    width: min(420px, 100%);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  .modalHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .modalValue {
    font-size: clamp(20px, 6vw, 26px);
    font-weight: 800;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    text-align: right;
    margin-bottom: var(--space-2);
  }

  .pad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .pad button {
    min-height: 46px;
    font-size: var(--font-size-lg);
    border-radius: var(--radius-md);
  }

  .pad .wide {
    grid-column: span 2;
  }

  .submsg {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
    white-space: pre-wrap;
  }

  @media (max-width: 980px) {
    .mainGrid {
      grid-template-columns: minmax(0, 1fr);
    }

    .heroStats {
      width: 100%;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
  }

  @media (max-width: 620px) {
    .heroContent {
      flex-direction: column;
      align-items: flex-start;
    }

    .workflowRail {
      grid-auto-columns: minmax(220px, 1fr);
    }

    .configSplit {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

<div class="page shapePage">
  <div class="surfaceCard heroCard">
    <div class="heroContent">
      <div>
        <h1>Vorm snijden</h1>
        <div class="submsg">Max {XY_MAX}×{XY_MAX} mm, XY-only G-code. Voorwaarde: X en Y gehomed.</div>

        <div class="pillRow">
          <div class={machinePill().cls}>
            {machinePill().txt} · homed: {homedAxes || "-"}
          </div>
          <div class={statusPill().cls}>{statusPill().txt}</div>
        </div>
      </div>

      <div class="heroStats">
        <div class="statCard">
          <span class="statLabel">Moonraker</span>
          <span class="statValue">{connected ? "Online" : "Offline"}</span>
          <span class="statMeta">{connected ? "Realtime status actief" : "Geen verbinding"}</span>
        </div>
        <div class="statCard">
          <span class="statLabel">Homed assen</span>
          <span class="statValue">{homedAxes || "-"}</span>
          <span class="statMeta">{isHomedXY() ? "XY gereed" : "Home X/Y vereist"}</span>
        </div>
        <div class="statCard">
          <span class="statLabel">Voorbereiding</span>
          <span class="statValue">{preparedSummary ? "Voorbereid" : "Nog niet"}</span>
          <span class="statMeta">{preparedSummary || "Genereer G-code via de knop hieronder"}</span>
        </div>
      </div>
    </div>

    {#if mrMessage}
      <div class={"heroMessage " + (mrState === "error" ? "err" : "info")}>{mrMessage}</div>
    {/if}
  </div>

  <div class="workflowRail">
    {#each workflowStages as stage}
      <div class={"stageCard " + stage.state}>
        <div class="stageIndex">{stage.id}</div>
        <div>
          <div class="stageLabel">{stage.label}</div>
          <div class="stageDesc">{stage.description}</div>
        </div>
      </div>
    {/each}
  </div>

  <div class="mainGrid">
    <section class="surfaceCard selectorCard">
      <div class="panelTitle">Vorm kiezen</div>
      <p class="panelHint">Tik op een vorm om parameters te wijzigen.</p>

      <div class="shapeList">
        {#each shapes as s}
          <button
            type="button"
            class={"shapeTile " + (selected === s.id ? "selected" : "")}
            aria-pressed={selected === s.id}
            on:click={() => selectShape(s.id)}
          >
            <span class="shapeIcon" aria-hidden="true">
              {#if s.id === "circle"}
                <svg width="50" height="50" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="32" fill="none" stroke="#6aa7ff" stroke-width="6" />
                </svg>
              {:else if s.id === "rect"}
                <svg width="50" height="50" viewBox="0 0 120 120">
                  <rect x="28" y="40" width="64" height="40" rx="6" fill="none" stroke="#6aa7ff" stroke-width="6" />
                </svg>
              {:else if s.id === "slot"}
                <svg width="50" height="50" viewBox="0 0 120 120">
                  <rect x="28" y="46" width="64" height="28" rx="14" ry="14" fill="none" stroke="#6aa7ff" stroke-width="6" />
                </svg>
              {:else}
                <svg width="50" height="50" viewBox="0 0 120 120">
                  <polygon
                    points="60,28 86,42 86,78 60,92 34,78 34,42"
                    fill="none" stroke="#6aa7ff" stroke-width="6" />
                </svg>
              {/if}
            </span>

            <span class="shapeText">
              <span class="shapeTitle">{s.title}</span>
              <span class="shapeSubtitle">{s.subtitle}</span>
            </span>
          </button>
        {/each}
      </div>
    </section>

    <section class="surfaceCard configCard">
      <div class="panelTitle">Configuratie</div>

      <div class="configSplit">
        <div class="previewPane">
          <div class="splitTitle">Preview</div>

          <div class="previewWrap">
            {#if selected === "circle"}
              <svg class="bigSvg" viewBox="0 0 120 120">
                <defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#b7c6ea" />
                  </marker>
                </defs>

                <circle cx="60" cy="60" r={mmToPx(circle.diameter) / 2} fill="none" stroke="#6aa7ff" stroke-width="5" />

                <line
                  x1={60 - mmToPx(circle.diameter) / 2}
                  y1={60 + mmToPx(circle.diameter) / 2 + 14}
                  x2={60 + mmToPx(circle.diameter) / 2}
                  y2={60 + mmToPx(circle.diameter) / 2 + 14}
                  stroke="#b7c6ea"
                  stroke-width="2"
                  marker-start="url(#arr)"
                  marker-end="url(#arr)"
                />
                <text x="60" y={60 + mmToPx(circle.diameter) / 2 + 30} fill="#eaf0ff" font-size="10" text-anchor="middle" font-weight="900">
                  Ø {circle.diameter.toFixed(1)} mm
                </text>
              </svg>
            {:else if selected === "rect"}
              {@const box = centerBoxSize(rect.length, rect.width)}
              <svg class="bigSvg" viewBox="0 0 120 120">
                <defs>
                  <marker id="arr2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#b7c6ea" />
                  </marker>
                </defs>

                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="6" fill="none" stroke="#6aa7ff" stroke-width="5" />

                <line
                  x1={box.x}
                  y1={box.y + box.h + 12}
                  x2={box.x + box.w}
                  y2={box.y + box.h + 12}
                  stroke="#b7c6ea"
                  stroke-width="2"
                  marker-start="url(#arr2)"
                  marker-end="url(#arr2)"
                />
                <text x={box.cx} y={box.y + box.h + 28} fill="#eaf0ff" font-size="10" text-anchor="middle" font-weight="900">
                  L {rect.length.toFixed(1)} mm
                </text>

                <line
                  x1={box.x + box.w + 12}
                  y1={box.y}
                  x2={box.x + box.w + 12}
                  y2={box.y + box.h}
                  stroke="#b7c6ea"
                  stroke-width="2"
                  marker-start="url(#arr2)"
                  marker-end="url(#arr2)"
                />
                <text x={box.x + box.w + 22} y={box.cy} fill="#eaf0ff" font-size="10" text-anchor="start" font-weight="900">
                  B {rect.width.toFixed(1)} mm
                </text>
              </svg>
            {:else if selected === "slot"}
              {@const box = centerBoxSize(slot.length, slot.width)}
              <svg class="bigSvg" viewBox="0 0 120 120">
                <defs>
                  <marker id="arr3" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#b7c6ea" />
                  </marker>
                </defs>

                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={box.h / 2}
                  ry={box.h / 2}
                  fill="none"
                  stroke="#6aa7ff"
                  stroke-width="5"
                />

                <line
                  x1={box.x}
                  y1={box.y + box.h + 12}
                  x2={box.x + box.w}
                  y2={box.y + box.h + 12}
                  stroke="#b7c6ea"
                  stroke-width="2"
                  marker-start="url(#arr3)"
                  marker-end="url(#arr3)"
                />
                <text x={box.cx} y={box.y + box.h + 28} fill="#eaf0ff" font-size="10" text-anchor="middle" font-weight="900">
                  L {slot.length.toFixed(1)} mm
                </text>

                <line
                  x1={box.x + box.w + 12}
                  y1={box.y}
                  x2={box.x + box.w + 12}
                  y2={box.y + box.h}
                  stroke="#b7c6ea"
                  stroke-width="2"
                  marker-start="url(#arr3)"
                  marker-end="url(#arr3)"
                />
                <text x={box.x + box.w + 22} y={box.cy} fill="#eaf0ff" font-size="10" text-anchor="start" font-weight="900">
                  B {slot.width.toFixed(1)} mm
                </text>

                <text x={box.x + box.w - 2} y={box.y - 6} fill="#b7c6ea" font-size="10" text-anchor="end" font-weight="900">
                  R = {(slot.width / 2).toFixed(1)} mm
                </text>
              </svg>
            {:else}
              <svg class="bigSvg" viewBox="0 0 120 120">
                <defs>
                  <marker id="arr4" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#b7c6ea" />
                  </marker>
                </defs>

                <polygon points={hexPointsForPreview(hex.acrossFlats)} fill="none" stroke="#6aa7ff" stroke-width="5" />

                <text x="60" y="112" fill="#eaf0ff" font-size="10" text-anchor="middle" font-weight="900">
                  S {hex.acrossFlats.toFixed(1)} mm
                </text>
              </svg>
            {/if}
          </div>
        </div>

        <div class="fieldsPane">
          <div class="splitTitle">Maten</div>

          <div class="fields">
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
                      max: XY_MAX,
                      apply: (v) => {
                        circle = { diameter: v };
                        normalizeCircle();
                        markShapeDirty();
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
                      max: XY_MAX,
                      apply: (v) => {
                        rect = { ...rect, length: v };
                        normalizeRect();
                        markShapeDirty();
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
                      max: XY_MAX,
                      apply: (v) => {
                        rect = { ...rect, width: v };
                        normalizeRect();
                        markShapeDirty();
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
                      max: XY_MAX,
                      apply: (v) => {
                        slot = { ...slot, length: v };
                        normalizeSlot();
                        markShapeDirty();
                      }
                    })}
                >
                  {slot.length.toFixed(1)} mm
                </button>
              </div>

              <div class="field">
                <div class="label">Breedte B (mm) (R = B/2)</div>
                <button
                  type="button"
                  class="valueBox"
                  on:click={() =>
                    openNumpad({
                      title: "Breedte B (mm)",
                      value: slot.width,
                      min: 0.1,
                      max: XY_MAX,
                      apply: (v) => {
                        slot = { ...slot, width: v };
                        normalizeSlot();
                        markShapeDirty();
                      }
                    })}
                >
                  {slot.width.toFixed(1)} mm
                </button>
              </div>

              <div class="hintRow">
                Radius automatisch: R = {(slot.width / 2).toFixed(1)} mm
              </div>

            {:else}
              <div class="field">
                <div class="label">Steekmaat S (mm) (across flats)</div>
                <button
                  type="button"
                  class="valueBox"
                  on:click={() =>
                    openNumpad({
                      title: "Steekmaat S (mm)",
                      value: hex.acrossFlats,
                      min: 0.1,
                      max: XY_MAX,
                      apply: (v) => {
                        hex = { acrossFlats: v };
                        normalizeHex();
                        markShapeDirty();
                      }
                    })}
                >
                  {hex.acrossFlats.toFixed(1)} mm
                </button>
              </div>
            {/if}

            <div class="hintRow">
              Begrensd op {XY_MAX} mm i.v.m. X/Y slag. XY moet gehomed zijn: <b>{isHomedXY() ? "JA" : "NEE"}</b>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <section class="surfaceCard jobCard">
    <div class="panelTitle">Job voorbereiding</div>

    <div class="jobStatusRow">
      <div class={statusPill().cls}>{statusPill().txt}</div>
      <div class="submsg">{statusMsg}</div>
    </div>

    {#if lastError}
      <div class="errorBox">{lastError}</div>
    {/if}

    {#if !connected}
      <div class="hintRow">
        Moonraker niet bereikbaar — controleer netwerkverbinding.
      </div>
    {/if}

    <div class="jobButtons">
      <button type="button" class="primary" on:click={prepareCut} disabled={!canPrepareShape}>
        Genereer G-code
      </button>
      <button type="button" class="secondary" on:click={refreshMachine}>
        Status verversen
      </button>
      {#if canStartTest}
        <button type="button" class="primary" on:click={startCutNow}>
          START (test)
        </button>
      {/if}
    </div>

    {#if !isHomedXY()}
      <div class="hintRow">
        Home X en Y via Handbediening voordat je een job voorbereidt.
      </div>
    {/if}

    <div class="jobUpload">
      <div class="splitTitle">Eigen G-code uploaden</div>
      <div class="jobActions">
        <label class="fileInput">
          <span class="fileLabel">Kies bestand</span>
          <input id="job-upload-input" type="file" accept=".gcode" on:change={handleFileChange} />
        </label>
        {#if selectedFileName}
          <span class="selectedFile">{selectedFileName}</span>
        {/if}
        <button type="button" class="secondary" on:click={uploadFile} disabled={!shapeFile}>
          Upload naar Moonraker
        </button>
      </div>
    </div>

    {#if preparedSummary}
      <div class="preparedSummary">Voorbereid: <b>{preparedSummary}</b></div>
    {/if}

    {#if preparedGcode}
      <div class="gcodePreview">{preparedGcode.split("\n").slice(0, 18).join("\n")}</div>
    {/if}
  </section>
</div>

{#if padOpen}
  <div
    class="modalBack"
    role="button"
    tabindex="0"
    aria-label="Sluit numerieke keypad"
    on:click={padCancel}
    on:keydown={handlePadBackdropKeyDown}
    on:keyup={handlePadBackdropKeyUp}
  >
    <div class="modal" on:click|stopPropagation>
      <div class="modalHead">
        <div class="modalTitle">{padTitle}</div>
        <button class="ghost" on:click={padCancel}>Sluiten</button>
      </div>

      <div class="modalValue">{keypadInput || ""} mm</div>
      <div class="submsg" style="margin-bottom: 12px;">Toegestaan: {padMin} – {padMax} mm</div>

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
