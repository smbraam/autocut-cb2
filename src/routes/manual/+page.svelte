<script lang="ts">
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { emergencyStopState } from '$lib/emergency-stop-state';
  import { machineApi } from '$lib/machine-api';
  import { uiSettings } from '$lib/ui-settings';
  import NumberPad from '$lib/NumberPad.svelte';
  import { autocutMachineState } from '$lib/autocut-machine-state';

  /**
  * Manual jog via Moonraker proxy
   * - 3 rijen: X/Y/Z met + en - knoppen
   * - Per as een mm-veld; tik erop => touchscreen numpad modal
   * - Clamp input naar max bereik op basis van position_min/max en huidige positie
   * - Jog werkt alleen als assen gehomed zijn (toolhead.homed_axes)
   *
  * Vereist Moonraker proxy op /moonraker in nginx en in de Vite dev-server
   */

  let connected = false;
  let homedAxes: string[] = [];
  let lastError = "";
  let machineState = 'Connecting';

  let pos: [number, number, number] = [0, 0, 0];
  let positionMax: [number, number, number] = [100, 100, 50];
  let positionMin: [number, number, number] = [0, 0, 0];

  let stepX = 10;
  let stepY = 10;
  let stepZ = 5;
  let developerMode = true;
  let devMacros: string[] = [];
  let configLoaded = false;
  let lastConfigRefresh = 0;

  // keypad modal
  let keypadOpen = false;
  let keypadAxis: "X" | "Y" | "Z" = "X";
  let keypadTitle = "";
  let keypadValue = "";
  let keypadCurrent = 0;
  let keypadMin = 0;
  let keypadMax = 0;
  let keypadError = "";

  let torchActive = false;

  let poll: ReturnType<typeof setInterval> | null = null;
  let endstopPoll: ReturnType<typeof setInterval> | null = null;
  let stateRefreshInFlight = false;
  let endstopRefreshInFlight = false;
  
  // Endstop status indicators
  let endstopIndicators = { x: false, y: false, z: false };
  let endstopReleaseDelayMs = 500;
  let endstopFadeTimers: Record<string, ReturnType<typeof setTimeout> | null> = { x: null, y: null, z: null };


  function normalizeHomedAxes(value: unknown) {
    if (typeof value === 'string') return value.toLowerCase().split('');
    if (Array.isArray(value)) return value.join('').toLowerCase().split('');
    return [];
  }

  function normalizePosition(value: unknown): [number, number, number] | null {
    if (!Array.isArray(value) || value.length < 3) return null;
    const next = value.slice(0, 3).map((item) => Number(item));
    if (!next.every(Number.isFinite)) return null;
    return next as [number, number, number];
  }

  function axisIndex(axis: "X" | "Y" | "Z") {
    return axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  }

  function displayHomedAxes() {
    return $autocutMachineState.homedAxes || homedAxes.join('');
  }

  function displayPosition() {
    return $autocutMachineState.position ?? pos;
  }

  function isAxisHomed(axis: "X" | "Y" | "Z") {
    return displayHomedAxes().includes(axis.toLowerCase());
  }

  function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
  }

  function toFixedNice(n: number) {
    const rounded = Math.round(n * 10) / 10;
    const s = rounded.toFixed(1);
    return s.replace(/\.0$/, "");
  }

  function axisPositionValue(axis: "X" | "Y" | "Z") {
    if (!isAxisHomed(axis)) return "--";
    return displayPosition()[axisIndex(axis)].toFixed(1);
  }

  function axisEndstopTriggered(status: Record<string, string>, axis: 'x' | 'y' | 'z') {
    const candidates = [
      axis,
      `carriage ${axis}`,
      `stepper_${axis}`,
      `stepper ${axis}`,
      `stepper s${axis}`,
      `tmc2209_s${axis}:virtual_endstop`
    ];

    for (const key of candidates) {
      if (String(status[key] ?? '').toUpperCase() === 'TRIGGERED') return true;
    }

    return Object.entries(status).some(([key, value]) => {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, ' ');
      const normalizedValue = String(value ?? '').toUpperCase();
      return normalizedValue === 'TRIGGERED' && (
        normalizedKey === axis ||
        normalizedKey === `carriage ${axis}` ||
        normalizedKey === `stepper ${axis}` ||
        normalizedKey === `stepper s${axis}` ||
        normalizedKey.includes(` ${axis}`) ||
        normalizedKey.includes(`s${axis}:virtual endstop`)
      );
    });
  }

  function setEndstopIndicator(axis: 'x' | 'y' | 'z', triggered: boolean) {
    if (triggered) {
      if (endstopFadeTimers[axis]) {
        clearTimeout(endstopFadeTimers[axis]!);
        endstopFadeTimers[axis] = null;
      }

      endstopIndicators = { ...endstopIndicators, [axis]: true };
      return;
    }

    if (endstopFadeTimers[axis]) return;

    endstopFadeTimers[axis] = setTimeout(() => {
      endstopIndicators = { ...endstopIndicators, [axis]: false };
      endstopFadeTimers[axis] = null;
    }, endstopReleaseDelayMs);
  }

  function pageHidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  async function emergencyStopMachine() {
    try {
      await machineApi.emergencyStop();
      autocutMachineState.clear();
      emergencyStopState.activate();
      lastError = '';
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
    }
  }

  async function refreshState(includeConfig = false) {
    if (stateRefreshInFlight || pageHidden()) return;

    stateRefreshInFlight = true;
    try {
      const shouldLoadConfig = includeConfig || !configLoaded || Date.now() - lastConfigRefresh > 10000;
      const q = await machineApi.getStatus(shouldLoadConfig);
      const status = q?.result?.status ?? {};
      const toolhead = status.toolhead ?? {};
      const gcodeMove = status.gcode_move ?? {};
      const cfg = status.configfile?.settings ?? {};
      const printState = status.print_stats?.state ?? '';
      const webhookState = status.webhooks?.state ?? '';

      connected = true;
      lastError = "";

      if (webhookState === 'ready') {
        machineState = printState === 'printing' ? 'Busy' : 'Ready';
        emergencyStopState.clear();
      } else if (webhookState === 'error') {
        machineState = 'Error';
      } else if (webhookState) {
        machineState = webhookState.charAt(0).toUpperCase() + webhookState.slice(1);
      } else {
        machineState = printState ? printState.charAt(0).toUpperCase() + printState.slice(1) : 'Unknown';
      }

      const livePosition = normalizePosition(toolhead.position) ?? normalizePosition(gcodeMove.gcode_position);
      const klipperHomedAxes = normalizeHomedAxes(toolhead.homed_axes);
      if (klipperHomedAxes.length) autocutMachineState.mergeKlipper(klipperHomedAxes.join(''), livePosition);
      if (livePosition && !homedAxes.length) pos = livePosition;

      if (shouldLoadConfig) {
        const sx = cfg['carriage x'] ?? cfg['stepper_x'] ?? {};
        const sy = cfg['carriage y'] ?? cfg['stepper_y'] ?? {};
        const sz = cfg['carriage z'] ?? cfg['stepper_z'] ?? {};
        devMacros = extractDevMacros(cfg);

        positionMin = [
          Number(sx.position_min ?? 0),
          Number(sy.position_min ?? 0),
          Number(sz.position_min ?? 0)
        ];

        positionMax = [
          Number(sx.position_max ?? 100),
          Number(sy.position_max ?? 100),
          Number(sz.position_max ?? 50)
        ];

        configLoaded = true;
        lastConfigRefresh = Date.now();
      }
    } catch (e: any) {
      connected = false;
      homedAxes = [];
      machineState = 'Disconnected';
      lastError = e?.message ?? String(e);
      console.error(lastError);
    } finally {
      stateRefreshInFlight = false;
    }
  }

  async function refreshEndstops() {
    if (endstopRefreshInFlight || pageHidden() || (machineState !== 'Ready' && machineState !== 'Busy')) return;

    endstopRefreshInFlight = true;
    try {
      const response = await machineApi.queryEndstops();
      const endstopStatus = response?.result ?? {};
      
      (['x', 'y', 'z'] as const).forEach((axis) => {
        setEndstopIndicator(axis, axisEndstopTriggered(endstopStatus, axis));
      });
    } catch (e: any) {
      const message = e?.message ?? String(e);
      if (/shutdown|not ready|webrequest|query_endstops/i.test(message)) {
        machineState = 'Shutdown';
        lastError = message;
      }
    } finally {
      endstopRefreshInFlight = false;
    }
  }

  function statusClass() {
    if (machineState === 'Ready') return 'ok';
    if (machineState === 'Busy') return 'warn';
    if (['Error', 'Disconnected', 'Shutdown', 'Emergency'].includes(machineState)) return 'err';
    return '';
  }

  function maxReach(axis: "X" | "Y" | "Z") {
    const i = axisIndex(axis);
    const current = pos[i];
    const toMin = Math.max(0, current - positionMin[i]);
    const toMax = Math.max(0, positionMax[i] - current);
    return Math.max(toMin, toMax);
  }

  function clampStep(axis: "X" | "Y" | "Z", requested: number) {
    const m = maxReach(axis);
    const safe = clamp(requested, 0, m);
    return Math.round(safe * 1000) / 1000;
  }

  function setAxisStep(axis: "X" | "Y" | "Z", value: number) {
    const safe = clampStep(axis, value);
    if (axis === "X") {
      stepX = safe;
      uiSettings.patch({ manualStepX: safe });
    }
    if (axis === "Y") {
      stepY = safe;
      uiSettings.patch({ manualStepY: safe });
    }
    if (axis === "Z") {
      stepZ = safe;
      uiSettings.patch({ manualStepZ: safe });
    }
  }

  function getAxisStep(axis: "X" | "Y" | "Z") {
    return axis === "X" ? stepX : axis === "Y" ? stepY : stepZ;
  }

  function openKeypad(axis: "X" | "Y" | "Z") {
    keypadAxis = axis;
    keypadTitle = `Stapgrootte ${axis} (mm)`;
    keypadValue = "";
    keypadCurrent = getAxisStep(axis);
    keypadMin = 0;
    keypadMax = maxReach(axis);
    keypadError = "";
    keypadOpen = true;
  }

  function closeKeypad() {
    keypadOpen = false;
    keypadError = "";
  }

  function normalizeNumberString(s: string) {
    return s.replace(",", ".").trim();
  }

  function confirmKeypad() {
    const s = normalizeNumberString(keypadValue);
    if (!s) {
      keypadError = "Voer eerst een waarde in.";
      return;
    }

    const n = Number(s);

    if (Number.isNaN(n)) {
      keypadError = "Voer een geldig getal in.";
      return;
    }

    const v = clamp(n, keypadMin, keypadMax);
    setAxisStep(keypadAxis, v);
    closeKeypad();
  }

  function appendKey(ch: string) {
    keypadValue += ch;
  }
  function backspaceKey() {
    keypadValue = keypadValue.slice(0, -1);
  }
  function clearKey() {
    keypadValue = "";
  }

  const hiddenDevMacros = new Set([
    'CANCEL_PRINT',
    'G28',
    'HOME_ALL',
    'PAUSE',
    'RESUME',
    'SET_PAUSE_AT_LAYER',
    'SET_PAUSE_NEXT_LAYER',
    'SET_PRINT_STATS_INFO',
    'Z_MINUS_0P5',
    'Z_PLUS_0P5'
  ]);

  function extractDevMacros(settings: Record<string, any>) {
    return Object.keys(settings)
      .filter((key) => key.startsWith('gcode_macro '))
      .map((key) => key.replace('gcode_macro ', '').trim())
      .filter((name) => !!name && !name.startsWith('_'))
      .filter((name) => !hiddenDevMacros.has(name.toUpperCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function macroLabel(name: string) {
    return name.replaceAll('_', ' ').replace(/(\d+)P(\d+)/g, '$1.$2');
  }

  async function runMacro(name: string) {
    try {
      await machineApi.sendGcode(name);
      await refreshState();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
    }
  }

  async function jog(axis: 'X' | 'Y' | 'Z', dir: 1 | -1) {
    if (!connected) {
      alert("Geen verbinding met Moonraker.");
      return;
    }
    if (!isAxisHomed(axis)) {
      lastError = `As ${axis} moet eerst worden gehomed.`;
      alert(lastError);
      return;
    }

    const i = axisIndex(axis);
    const current = pos[i];
    const step = getAxisStep(axis);

    if (step <= 0) return;

    // clamp naar min/max
    const target = clamp(current + dir * step, positionMin[i], positionMax[i]);
    const actualMove = Math.abs(target - current);
    if (actualMove <= 0) return;

    const jogSpeed = axis === 'Z' ? 2 : 5;

    try {
      await machineApi.jog(axis, dir * actualMove, jogSpeed);
      const nextPosition: [number, number, number] = [...get(autocutMachineState).position];
      nextPosition[i] = target;
      autocutMachineState.setPosition(nextPosition);
      await refreshState();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
      alert(`G-code error:\n${lastError}`);
    }
  }

  async function torchPress() {
    if (!connected) return;
    torchActive = true;
    try {
      await machineApi.torchOn();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
    }
  }

  async function torchRelease() {
    if (!connected) return;
    torchActive = false;
    try {
      await machineApi.torchOff();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
    }
  }

  onMount(() => {
    uiSettings.load();
    autocutMachineState.load();
    const initial = get(uiSettings);
    stepX = clampStep('X', initial.manualStepX);
    stepY = clampStep('Y', initial.manualStepY);
    stepZ = clampStep('Z', initial.manualStepZ);
    endstopReleaseDelayMs = initial.endstopReleaseDelayMs;
    developerMode = initial.developerMode;

    const unsubscribe = uiSettings.subscribe((value) => {
      developerMode = value.developerMode;
      endstopReleaseDelayMs = value.endstopReleaseDelayMs;
    });
    const unsubscribeMachineState = autocutMachineState.subscribe((value) => {
      homedAxes = value.homedAxes.split('');
      pos = value.position;
    });

    void refreshState(true);
    void refreshEndstops();
    poll = setInterval(() => void refreshState(false), 1200);
    endstopPoll = setInterval(refreshEndstops, 500);

    return () => {
      if (poll) clearInterval(poll);
      if (endstopPoll) clearInterval(endstopPoll);
      Object.values(endstopFadeTimers).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
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

  .statusPill.ok {
    color: #a9ffcf;
    border-color: #1f6a49;
  }

  .statusPill.warn {
    color: #ffe2a8;
    border-color: #6a5320;
  }

  .statusPill.err {
    color: #ffb5b5;
    border-color: #7a1f1f;
  }

  .topStopButton {
    min-width: 136px;
    min-height: 56px;
    flex: 0 0 auto;
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

  .wrap {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
    max-width: none;
    align-items: start;
  }

  .fullRow {
    grid-column: 1 / -1;
  }

  .positionGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 12px 0 14px;
  }

  .positionCard {
    display: grid;
    gap: 6px;
    align-content: start;
    padding: 10px 12px;
    min-height: 80px;
    border-radius: 18px;
    background: rgba(11, 22, 39, 0.86);
    border: 1px solid rgba(124, 199, 255, 0.12);
  }

  .positionCardHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .endstopIndicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(143, 163, 199, 0.3);
    transition: background 0.15s ease, box-shadow 0.15s ease;
    flex-shrink: 0;
  }

  .endstopIndicator.active {
    background: #4ade80;
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
  }

  .positionLabel {
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .valueLine {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .value {
    font-size: 28px;
    font-weight: 950;
    line-height: 1;
  }

  .value.dimmed {
    color: #6f85aa;
  }

  .positionUnit {
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 800;
  }

  .card {
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.16);
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 18px 28px rgba(0, 0, 0, 0.16);
  }

  .compactLead {
    margin-bottom: 10px;
  }

  .pageTitle {
    color: #ffffff;
    font-weight: 900;
    font-size: 26px;
    line-height: 1;
    margin-bottom: 0;
  }

  .headerRow {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .hintline {
    opacity: 0.88;
    font-size: 17px;
    line-height: 1.45;
  }

  .jogGrid {
    display: grid;
    grid-template-columns: 304px 96px 122px 130px;
    gap: 12px;
    align-items: stretch;
    margin-top: 12px;
  }

  .axisCard {
    display: grid;
    gap: 10px;
    background: linear-gradient(180deg, rgba(14, 26, 48, 0.92), rgba(9, 18, 34, 0.92));
    border: 1px solid rgba(124, 199, 255, 0.14);
    border-radius: 20px;
    padding: 14px;
  }

  .padShell {
    padding: 8px;
    border-radius: 22px;
    background: rgba(8, 16, 30, 0.92);
    border: 1px solid rgba(124, 199, 255, 0.1);
  }

  .xyPad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 80px;
    gap: 8px;
    align-items: center;
  }

  .padCenter {
    min-height: 80px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(24, 37, 61, 0.92);
    border: 1px solid rgba(124, 199, 255, 0.12);
    font-weight: 950;
    color: #eaf0ff;
  }

  .padCenter.vertical {
    min-height: 80px;
    border-radius: 999px;
  }

  .spacer {
    min-height: 1px;
  }

  button {
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    color: #eaf0ff;
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 16px;
    padding: 14px 12px;
    font-weight: 900;
    font-size: 16px;
    cursor: pointer;
    min-width: 0;
    min-height: 64px;
  }
  button:hover { background: #1b2a4a; }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .primary {
    background: #1a2b55;
    border-color: #3558a8;
  }

  .primary:hover {
    background: #22376a;
  }

  .ghost {
    background: transparent;
  }

  .danger {
    background: #2a0f14;
    border-color: #7a1f1f;
    color: #ffb5b5;
  }

  .danger:hover {
    background: #3a141a;
  }

  .dangerButton {
    background: linear-gradient(180deg, rgba(150, 32, 40, 0.98), rgba(104, 18, 26, 0.98));
    border: 1px solid rgba(255, 154, 154, 0.24);
    color: #fff3f3;
  }

  .stepBox {
    background: rgba(7, 16, 30, 0.92);
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 18px;
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
    width: 100%;
    text-align: left;
  }

  .stepRow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .stepStack {
    display: grid;
    gap: 10px;
    align-content: stretch;
  }

  .stepBox.compact {
    display: grid;
    gap: 4px;
    justify-items: start;
    align-content: center;
    min-height: 72px;
    padding: 10px 12px;
  }

  .stepLabel {
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 800;
  }

  .iconButton {
    display: grid;
    place-items: center;
    width: 80px;
    min-width: 80px;
    min-height: 80px;
    padding: 8px;
    border-radius: 24px;
    background: linear-gradient(180deg, rgba(63, 74, 92, 0.92), rgba(49, 58, 74, 0.92));
  }

  .iconButton svg {
    width: 28px;
    height: 28px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .iconButton small {
    display: block;
    margin-top: 4px;
    font-size: 15px;
    font-weight: 900;
    color: #9db3d9;
  }

  .zStack {
    display: grid;
    grid-template-rows: repeat(3, 80px);
    gap: 8px;
  }

  .stepVal {
    font-weight: 950;
    font-size: 21px;
    white-space: nowrap;
  }
  .unit {
    opacity: 0.75;
    font-weight: 900;
    font-size: 17px;
  }

  .errorBox {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 14px;
    white-space: pre-wrap;
    max-height: 120px;
    overflow: auto;
  }

  .devCard {
    background: linear-gradient(180deg, rgba(19, 15, 31, 0.98), rgba(10, 10, 21, 0.98));
    border-color: rgba(186, 146, 255, 0.14);
  }

  .devLead {
    color: #cdbaf7;
    font-size: 16px;
    line-height: 1.4;
    margin-bottom: 12px;
  }

  .macroGrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .macroGrid button {
    min-height: 58px;
    font-size: 16px;
    padding: 10px;
  }

  .mainsailList {
    align-items: stretch;
  }

  .macroButton {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 850;
  }

  .torchColumn {
    display: grid;
    align-content: stretch;
    min-height: 100%;
  }

  .torchButton {
    display: grid;
    grid-template-rows: auto auto auto;
    gap: 8px;
    justify-items: center;
    align-content: center;
    width: 100%;
    min-height: 100%;
    padding: 12px;
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    border: 2px solid rgba(124, 199, 255, 0.18);
    color: #eaf0ff;
    font-size: 17px;
    font-weight: 900;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .torchButton:hover:not(:disabled) {
    background: linear-gradient(180deg, rgba(32, 56, 96, 0.95), rgba(22, 40, 72, 0.95));
    border-color: rgba(124, 199, 255, 0.28);
  }

  .torchButton:active:not(:disabled),
  .torchButton.active {
    background: linear-gradient(180deg, rgba(255, 102, 0, 0.85), rgba(204, 68, 0, 0.85));
    border-color: rgba(255, 154, 68, 0.65);
    color: #fff;
    box-shadow: 0 0 20px rgba(255, 102, 0, 0.4);
  }

  .torchButton:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .torchButton svg {
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  }

  .torchButton.active svg {
    filter: drop-shadow(0 2px 8px rgba(255, 200, 0, 0.6));
  }

  .torchButton small {
    font-size: 13px;
    font-weight: 700;
    opacity: 0.85;
  }

  .positionStack {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    align-content: stretch;
  }

  .positionBox {
    background: rgba(7, 16, 30, 0.92);
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 18px;
    padding: 12px 14px;
    display: grid;
    gap: 4px;
    align-content: center;
    min-height: 72px;
  }

  .positionBox.homed {
    border-color: rgba(115, 240, 176, 0.42);
    box-shadow: inset 0 0 0 1px rgba(115, 240, 176, 0.16);
  }

  .positionBoxHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .positionBoxValue {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .positionBoxValue .value {
    font-size: 26px;
  }

  @media (max-width: 760px) {
    .wrap,
    .jogGrid,
    .macroGrid,
    .stepRow,
    .stepStack,
    .torchColumn,
    .positionStack {
      grid-template-columns: 1fr;
    }

    .positionGrid {
      grid-template-columns: 1fr;
    }

    .topStopButton {
      width: 100%;
    }

    .headerActions {
      width: 100%;
    }

    .statusPill {
      flex: 1 1 auto;
    }

  }
</style>

<div class="page">
  {#if $emergencyStopState.active}
    <div class="emergencyNotice">{$emergencyStopState.message}</div>
  {/if}

  <div class="wrap">
    <div class="card">
      <div class="headerRow">
        <div>
          <div class="pageTitle">Handbediening</div>
        </div>
        <div class="headerActions">
          <div class={`statusPill ${statusClass()}`}>{machineState}</div>
          <button class="dangerButton topStopButton" on:click={emergencyStopMachine}>Emergency stop</button>
        </div>
      </div>

      <div class="jogGrid">
        <div class="axisCard padShell">
          <div class="xyPad">
            <div class="spacer"></div>
            <button class="iconButton" disabled={!connected || !isAxisHomed("Y")} on:click={() => jog("Y", 1)} aria-label="Y plus">
              <svg viewBox="0 0 24 24"><path d="M12 5v14" /><path d="m6 11 6-6 6 6" /></svg>
              <small>Y+</small>
            </button>
            <div class="spacer"></div>

            <button class="iconButton" disabled={!connected || !isAxisHomed("X")} on:click={() => jog("X", -1)} aria-label="X min">
              <svg viewBox="0 0 24 24"><path d="M5 12h14" /><path d="m11 18-6-6 6-6" /></svg>
              <small>X-</small>
            </button>
            <div class="padCenter">XY</div>
            <button class="iconButton" disabled={!connected || !isAxisHomed("X")} on:click={() => jog("X", 1)} aria-label="X plus">
              <svg viewBox="0 0 24 24"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
              <small>X+</small>
            </button>

            <div class="spacer"></div>
            <button class="iconButton" disabled={!connected || !isAxisHomed("Y")} on:click={() => jog("Y", -1)} aria-label="Y min">
              <svg viewBox="0 0 24 24"><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></svg>
              <small>Y-</small>
            </button>
            <div class="spacer"></div>
          </div>
        </div>

        <div class="axisCard padShell zStack">
          <button class="iconButton" disabled={!connected || !isAxisHomed("Z")} on:click={() => jog("Z", 1)} aria-label="Z plus">
            <svg viewBox="0 0 24 24"><path d="M12 5v14" /><path d="m6 11 6-6 6 6" /></svg>
            <small>Z+</small>
          </button>
          <div class="padCenter vertical">Z</div>
          <button class="iconButton" disabled={!connected || !isAxisHomed("Z")} on:click={() => jog("Z", -1)} aria-label="Z min">
            <svg viewBox="0 0 24 24"><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></svg>
            <small>Z-</small>
          </button>
        </div>

        <div class="stepStack">
          <button type="button" class="stepBox compact" on:click={() => openKeypad("X")}>
            <span class="stepLabel">Stap X</span>
            <span class="stepVal">{toFixedNice(stepX)} <span class="unit">mm</span></span>
          </button>
          <button type="button" class="stepBox compact" on:click={() => openKeypad("Y")}>
            <span class="stepLabel">Stap Y</span>
            <span class="stepVal">{toFixedNice(stepY)} <span class="unit">mm</span></span>
          </button>
          <button type="button" class="stepBox compact" on:click={() => openKeypad("Z")}>
            <span class="stepLabel">Stap Z</span>
            <span class="stepVal">{toFixedNice(stepZ)} <span class="unit">mm</span></span>
          </button>
        </div>

        <div class="torchColumn">
          <button 
            class={torchActive ? 'torchButton active' : 'torchButton'}
            disabled={!connected}
            on:mousedown={torchPress}
            on:mouseup={torchRelease}
            on:mouseleave={torchRelease}
            on:touchstart|preventDefault={torchPress}
            on:touchend|preventDefault={torchRelease}
            on:touchcancel|preventDefault={torchRelease}
            aria-label="Toorts bekrachtigen"
          >
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path d="M8.5 14.5L4 19l1.5 1.5L10 16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 6l-3 3 3 3 3-3-3-3z" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 3v3" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/>
              <path d="M16 10l3-3" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/>
              <path d="M19 13l1.5-1.5" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>{torchActive ? 'AAN' : 'Toorts'}</span>
            <small>Ingedrukt houden</small>
          </button>
        </div>

        <div class="positionStack">
              <div class={`positionBox ${isAxisHomed("X") ? 'homed' : ''}`}>
                <div class="positionBoxHead">
                  <span class="stepLabel">X</span>
                  <div class={`endstopIndicator ${endstopIndicators.x ? 'active' : ''}`} title="Endstop status"></div>
                </div>
                <div class="positionBoxValue">
                  <div class={`value ${isAxisHomed("X") ? '' : 'dimmed'}`}>{axisPositionValue("X")}</div>
                  <div class="positionUnit">mm</div>
                </div>
              </div>
              <div class={`positionBox ${isAxisHomed("Y") ? 'homed' : ''}`}>
                <div class="positionBoxHead">
                  <span class="stepLabel">Y</span>
                  <div class={`endstopIndicator ${endstopIndicators.y ? 'active' : ''}`} title="Endstop status"></div>
                </div>
                <div class="positionBoxValue">
                  <div class={`value ${isAxisHomed("Y") ? '' : 'dimmed'}`}>{axisPositionValue("Y")}</div>
                  <div class="positionUnit">mm</div>
                </div>
              </div>
              <div class={`positionBox ${isAxisHomed("Z") ? 'homed' : ''}`}>
                <div class="positionBoxHead">
                  <span class="stepLabel">Z</span>
                  <div class={`endstopIndicator ${endstopIndicators.z ? 'active' : ''}`} title="Endstop status"></div>
                </div>
                <div class="positionBoxValue">
                  <div class={`value ${isAxisHomed("Z") ? '' : 'dimmed'}`}>{axisPositionValue("Z")}</div>
                  <div class="positionUnit">mm</div>
                </div>
              </div>
        </div>
      </div>

      {#if lastError}
        <div class="errorBox">{lastError}</div>
      {/if}

    </div>

    {#if developerMode}
      <div class="card devCard fullRow">
        <div class="title">Ontwikkelmacro's</div>
        <div class="devLead">
          Alleen macro's uit printer.cfg. Deze lijst volgt direct wat Klipper via Moonraker rapporteert.
        </div>

        <div class="macroGrid mainsailList">
          {#each devMacros as macro}
            <button class="secondary macroButton" on:click={() => runMacro(macro)}>{macroLabel(macro)}</button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<NumberPad
  open={keypadOpen}
  title={keypadTitle}
  value={keypadValue}
  subtitle={`Huidig: ${toFixedNice(keypadCurrent)} mm · Toegestaan: ${toFixedNice(keypadMin)} – ${toFixedNice(keypadMax)} mm`}
  error={keypadError}
  onClose={closeKeypad}
  onAppend={appendKey}
  onBackspace={backspaceKey}
  onClear={clearKey}
  onConfirm={confirmKeypad}
/>
