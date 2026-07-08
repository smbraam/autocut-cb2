<script lang="ts">
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { emergencyStopState } from '$lib/emergency-stop-state';
  import { machineApi } from '$lib/machine-api';
  import { uiSettings } from '$lib/ui-settings';
  import { autocutMachineState } from '$lib/autocut-machine-state';

  type PendingHome = 'X' | 'Y' | 'Z' | null;

  let statusText = 'Connecting';
  let statusMessage = '';
  let homedAxes = '';
  let position: [number, number, number] = [0, 0, 0];
  let positionMin: [number, number, number] = [0, 0, 0];
  let positionMax: [number, number, number] = [100, 100, 50];
  let lastError = '';
  let showAlarm = false;
  let showHomeConfirm = false;
  let homeInProgress = false;
  let pendingHome: PendingHome = null;
  let activeHomeAxis: PendingHome = null;
  let completedHomeAxis: PendingHome = null;
  let limitsLoaded = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let endstopPoll: ReturnType<typeof setInterval> | null = null;
  
  // Endstop status: null = unknown, 'open' = not triggered, 'TRIGGERED' = triggered
  let endstopStatus: Record<string, string> = {};
  let endstopIndicators = { x: false, y: false, z: false };
  let endstopReleaseDelayMs = 500;
  let endstopFadeTimers: Record<string, ReturnType<typeof setTimeout> | null> = { x: null, y: null, z: null };

  function setError(msg: string) {
    lastError = msg;
    console.error(msg);
  }

  function normalizeHomedAxes(value: unknown) {
    if (typeof value === 'string') return value.toLowerCase();
    if (Array.isArray(value)) return value.join('').toLowerCase();
    return '';
  }

  function normalizePosition(value: unknown): [number, number, number] | null {
    if (!Array.isArray(value) || value.length < 3) return null;
    const next = value.slice(0, 3).map((item) => Number(item));
    if (!next.every(Number.isFinite)) return null;
    return next as [number, number, number];
  }

  function displayHomedAxes() {
    return $autocutMachineState.homedAxes || homedAxes;
  }

  function displayPosition() {
    return $autocutMachineState.position ?? position;
  }

  function isAxisHomed(axis: 'X' | 'Y' | 'Z') {
    return displayHomedAxes().includes(axis.toLowerCase());
  }

  function axisValue(axis: 'X' | 'Y' | 'Z') {
    if (!isAxisHomed(axis)) return '--';
    const index = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
    return displayPosition()[index].toFixed(1);
  }

  function isBadStatus() {
    return ['Error', 'Disconnected', 'Unknown', 'Shutdown'].includes(statusText);
  }

  function machineStatusHint() {
    if (isBadStatus()) return visibleAlarmMessage();
    return statusMessage || 'Geen foutmelding actief.';
  }

  function visibleAlarmMessage() {
    return lastError || statusMessage || 'Geen extra melding beschikbaar.';
  }

  function canPollEndstops() {
    return statusText === 'Ready' || statusText === 'Busy';
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

  function axisIndex(axis: 'X' | 'Y' | 'Z') {
    return axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  async function refreshMachine(includeConfig = false) {
    try {
      const shouldLoadConfig = includeConfig || !limitsLoaded;
      const r = await machineApi.getStatus(shouldLoadConfig);
      const st = r?.result?.status ?? {};
      const ps = st.print_stats?.state ?? '';
      const wh = st.webhooks?.state ?? '';
      const message = st.display_status?.message ?? st.webhooks?.state_message ?? st.print_stats?.message ?? '';
      const toolhead = st.toolhead ?? {};
      const gcodeMove = st.gcode_move ?? {};
      const cfg = st.configfile?.settings ?? {};

      const livePosition = normalizePosition(toolhead.position) ?? normalizePosition(gcodeMove.gcode_position);
      const klipperHomedAxes = normalizeHomedAxes(toolhead.homed_axes);
      if (klipperHomedAxes) autocutMachineState.mergeKlipper(klipperHomedAxes, livePosition);
      if (livePosition && !homedAxes) position = livePosition;

      if (shouldLoadConfig) {
        const sx = cfg['carriage x'] ?? cfg['stepper_x'] ?? {};
        const sy = cfg['carriage y'] ?? cfg['stepper_y'] ?? {};
        const sz = cfg['carriage z'] ?? cfg['stepper_z'] ?? {};
        positionMin = [Number(sx.position_min ?? 0), Number(sy.position_min ?? 0), Number(sz.position_min ?? 0)];
        positionMax = [Number(sx.position_max ?? 100), Number(sy.position_max ?? 100), Number(sz.position_max ?? 50)];
        limitsLoaded = true;
      }

      if (wh === 'ready') {
        statusText = ps === 'printing' ? 'Busy' : 'Ready';
        emergencyStopState.clear();
      } else if (wh === 'error') {
        statusText = 'Error';
      } else if (wh) {
        statusText = wh.charAt(0).toUpperCase() + wh.slice(1);
      } else {
        statusText = ps ? ps.charAt(0).toUpperCase() + ps.slice(1) : 'Unknown';
      }

      statusMessage = message || '';
      lastError = '';
    } catch (e: any) {
      statusText = 'Disconnected';
      statusMessage = 'Moonraker niet bereikbaar';
      setError(e?.message ?? String(e));
    }
  }

  async function refreshEndstops() {
    if (!canPollEndstops()) return;

    try {
      const response = await machineApi.queryEndstops();
      endstopStatus = response?.result ?? {};
      
      (['x', 'y', 'z'] as const).forEach((axis) => {
        setEndstopIndicator(axis, axisEndstopTriggered(endstopStatus, axis));
      });
    } catch (e: any) {
      const message = e?.message ?? String(e);
      if (/shutdown|not ready|webrequest|query_endstops/i.test(message)) {
        statusText = 'Shutdown';
        statusMessage = message;
      }
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function targetAfterHome(axis: 'X' | 'Y' | 'Z') {
    const index = axisIndex(axis);

    if (axis === 'Z') {
      return clamp(get(uiSettings).travelHeightMm, positionMin[index], positionMax[index]);
    }

    return Math.round(((positionMin[index] + positionMax[index]) / 2) * 10) / 10;
  }

  function homeScript(axis: 'X' | 'Y' | 'Z', target: number) {
    const feedrate = axis === 'Z' ? 240 : 360;
    return [`G28 ${axis}`, 'G90', `G0 ${axis}${target.toFixed(3)} F${feedrate}`].join('\n');
  }

  function homeWaitMs(axis: 'X' | 'Y' | 'Z', target: number) {
    const index = axisIndex(axis);
    const speed = axis === 'Z' ? 4 : 6;
    const homingSpeed = axis === 'Z' ? 2 : 6;
    const travel = Math.max(0, positionMax[index] - positionMin[index]);
    const targetMove = Math.abs(target - positionMin[index]);
    const minimum = Math.ceil((targetMove / speed) * 1000) + 1200;
    const maximum = Math.ceil(((travel / homingSpeed) + (targetMove / speed)) * 1000) + 5000;
    return { minimum: Math.max(1500, minimum), maximum: Math.max(5000, maximum) };
  }

  async function runHome(axis: 'X' | 'Y' | 'Z') {
    if (homeInProgress) return;

    homeInProgress = true;
    activeHomeAxis = axis;
    completedHomeAxis = null;
    pendingHome = null;
    lastError = '';

    try {
      await refreshMachine(!limitsLoaded);
      const target = targetAfterHome(axis);
      const wait = homeWaitMs(axis, target);
      let commandError: Error | null = null;
      const command = machineApi.sendGcode(homeScript(axis, target)).catch((e: any) => {
        commandError = e instanceof Error ? e : new Error(e?.message ?? String(e));
      });

      await Promise.race([
        Promise.all([command, sleep(wait.minimum)]),
        sleep(wait.maximum)
      ]);

      if (commandError) throw commandError;

      const nextPosition: [number, number, number] = [...get(autocutMachineState).position];
      nextPosition[axisIndex(axis)] = target;
      autocutMachineState.markAxisHomed(axis, nextPosition);
      setEndstopIndicator(axis.toLowerCase() as 'x' | 'y' | 'z', true);
      completedHomeAxis = axis;
      showHomeConfirm = true;
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      if (activeHomeAxis === axis) activeHomeAxis = null;
      homeInProgress = false;
    }
  }

  async function resetKlipper() {
    try {
      lastError = '';
      await machineApi.restart();
      autocutMachineState.clear();
      showAlarm = false;
      statusText = 'Restarting';
      statusMessage = 'Klipper wordt opnieuw gestart';
      setTimeout(() => {
        void refreshMachine();
      }, 1200);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function resetFirmware() {
    try {
      lastError = '';
      await machineApi.firmwareRestart();
      autocutMachineState.clear();
      emergencyStopState.clear();
      statusText = 'Restarting';
      statusMessage = 'Firmware restart wordt uitgevoerd';
      setTimeout(() => {
        void refreshMachine();
      }, 1200);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function emergencyStopMachine() {
    try {
      await machineApi.emergencyStop();
      autocutMachineState.clear();
      emergencyStopState.activate();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      showAlarm = false;
      showHomeConfirm = false;
      homeInProgress = false;
      pendingHome = null;
      activeHomeAxis = null;
      completedHomeAxis = null;
      statusText = 'Emergency';
      statusMessage = 'Noodstop uitgevoerd. Voer Firmware restart uit door op de alarmmelding in de Home-pagina te klikken en hier Firmware restart te selecteren.';
    }
  }

  async function homeAxis(axis: 'X' | 'Y' | 'Z') {
    if (homeInProgress) {
      showHomeConfirm = true;
      return;
    }

    pendingHome = axis;
    completedHomeAxis = null;
    showHomeConfirm = true;
  }

  function confirmPendingHome() {
    if (completedHomeAxis) {
      completedHomeAxis = null;
      showHomeConfirm = false;
      return;
    }

    if (!pendingHome || homeInProgress) return;
    void runHome(pendingHome);
  }

  function homeConfirmText() {
    if (completedHomeAxis) return `As ${completedHomeAxis} succesvol gehomed.`;
    if (homeInProgress) return `Home ${activeHomeAxis ?? pendingHome ?? ''} is bezig.\n\nDe vaste noodstop rechtsboven blijft beschikbaar. Sluiten verbergt alleen deze melding; de beweging loopt door totdat Klipper klaar is.`;

    const axisLabel = pendingHome ? `Home ${pendingHome}` : 'Home';
    const extra = pendingHome === 'Z'
      ? '\n\nVoor Z: zet de machine op een vlak oppervlak en zorg dat de toorts licht kan bewegen zonder iets te raken.'
      : '';

    return `${axisLabel} start direct beweging.\n\nHoud vingers vrij van bewegende delen en zorg dat de toorts volledig vrij kan bewegen.${extra}`;
  }

  function homeDialogTitle() {
    if (completedHomeAxis) return 'Homen klaar';
    if (homeInProgress) return 'Homen bezig';
    return 'Bevestig homen';
  }

  function openAlarm() {
    if (!isBadStatus()) return;
    showAlarm = true;
  }

  onMount(() => {
    uiSettings.load();
    autocutMachineState.load();
    endstopReleaseDelayMs = get(uiSettings).endstopReleaseDelayMs;
    const unsubscribeSettings = uiSettings.subscribe((value) => {
      endstopReleaseDelayMs = value.endstopReleaseDelayMs;
    });
    const unsubscribeMachineState = autocutMachineState.subscribe((value) => {
      homedAxes = value.homedAxes;
      position = value.position;
    });
    void refreshMachine(true);
    void refreshEndstops();
    poll = setInterval(() => void refreshMachine(false), 1000);
    endstopPoll = setInterval(refreshEndstops, 200); // Poll endstops 5x per seconde (minder belasting)

    return () => {
      if (poll) clearInterval(poll);
      if (endstopPoll) clearInterval(endstopPoll);
      Object.values(endstopFadeTimers).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
      unsubscribeSettings();
      unsubscribeMachineState();
    };
  });
</script>

<style>
  .page {
    display: grid;
    gap: 10px;
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

  .homeRow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    min-height: 0;
    margin-top: 10px;
  }

  .card {
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.16);
    border-radius: 22px;
    padding: 12px;
    box-shadow: 0 18px 28px rgba(0, 0, 0, 0.16);
    min-height: 0;
  }

  .cardTitle {
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .dangerButton {
    background: linear-gradient(180deg, rgba(150, 32, 40, 0.98), rgba(104, 18, 26, 0.98));
    border: 1px solid rgba(255, 154, 154, 0.24);
    color: #fff3f3;
  }

  .statusCard {
    display: grid;
    gap: 10px;
  }

  .statusHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .statusMeta {
    display: grid;
    gap: 4px;
  }

  .pageTitle {
    color: #ffffff;
    font-size: 26px;
    font-weight: 900;
    line-height: 1;
  }

  .positionWrap {
    display: grid;
    gap: 0;
  }

  .positionHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .positionMeta {
    display: grid;
  }

  .positionGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    min-height: 0;
  }

  .positionCard,
  .homeCard {
    display: grid;
    gap: 6px;
    align-content: start;
    padding: 10px 12px;
    border-radius: 18px;
    background: rgba(11, 22, 39, 0.86);
    border: 1px solid rgba(124, 199, 255, 0.12);
  }

  .positionCard.homed {
    border-color: rgba(115, 240, 176, 0.42);
    box-shadow: inset 0 0 0 1px rgba(115, 240, 176, 0.16);
  }

  .homeCard {
    padding: 0;
    background: transparent;
    border: 0;
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

  .unit {
    color: #8fa3c7;
    font-size: 16px;
    font-weight: 800;
  }

  .homeCardHead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  button.homeButton {
    width: 100%;
    min-height: 78px;
    border-radius: 18px;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 6px;
    padding: 14px;
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    color: #eaf0ff;
    border: 1px solid rgba(124, 199, 255, 0.12);
    cursor: pointer;
    text-align: left;
  }

  button.homeButton:hover {
    background: #1b2a4a;
  }

  button.homeButton:focus {
    outline: 2px solid #6aa7ff;
    outline-offset: 2px;
  }

  .homeButton .label {
    font-size: 22px;
    font-weight: 950;
  }

  .homeButton .sub {
    color: #9cb1d8;
    font-size: 16px;
    font-weight: 800;
  }

  .statusStrip {
    width: 100%;
    border-radius: 18px;
    border: 1px solid rgba(124, 199, 255, 0.12);
    background: rgba(11, 22, 39, 0.86);
    padding: 14px;
    display: grid;
    gap: 4px;
    text-align: left;
    min-height: 0;
  }

  .statusStrip.bad {
    background: linear-gradient(180deg, rgba(44, 15, 21, 0.98), rgba(25, 9, 13, 0.98));
    border-color: rgba(186, 63, 75, 0.28);
  }

  .statusStrip:disabled {
    opacity: 1;
    cursor: default;
  }

  .statusStripValue {
    font-size: 28px;
    font-weight: 950;
    line-height: 1;
  }

  .statusStripText {
    color: #b7c6ea;
    font-size: 16px;
    line-height: 1.35;
  }

  .modalBack {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.58);
    display: grid;
    place-items: center;
    padding: 12px;
    z-index: 80;
  }

  .homeModalBack {
    pointer-events: none;
    background: transparent;
    align-items: center;
  }

  .homeModalBack .modal {
    pointer-events: auto;
  }

  .modal {
    width: min(100%, 460px);
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.18);
    border-radius: 22px;
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

  .secondary {
    background: #101a2c;
  }

  @media (max-width: 720px) {
    .homeRow,
    .positionGrid {
      grid-template-columns: 1fr;
    }

    .modalActions {
      grid-template-columns: 1fr;
    }

    .topStopButton {
      width: 100%;
    }

    .positionHeader {
      grid-template-columns: 1fr;
      display: grid;
    }

    .statusHeader {
      grid-template-columns: 1fr;
      display: grid;
    }
  }
</style>

<div class="page">
  {#if $emergencyStopState.active}
    <div class="emergencyNotice">{$emergencyStopState.message}</div>
  {/if}

  <section class="card statusCard">
    <div class="statusHeader">
      <div class="statusMeta">
        <div class="pageTitle">Home</div>
      </div>
      <button class="dangerButton topStopButton" on:click={emergencyStopMachine}>Emergency stop</button>
    </div>

    <button type="button" class={`statusStrip ${isBadStatus() ? 'bad' : ''}`} disabled={!isBadStatus()} on:click={openAlarm}>
      <div class="statusStripValue">{statusText}</div>
      <div class="statusStripText">{machineStatusHint()}</div>
    </button>
  </section>

  <section class="card positionWrap">
    <div class="positionGrid">
      <div class={`positionCard ${isAxisHomed('X') ? 'homed' : ''}`}>
        <div class="positionCardHead">
          <div class="cardTitle">X</div>
          <div class={`endstopIndicator ${endstopIndicators.x ? 'active' : ''}`} title="Endstop X status"></div>
        </div>
        <div class="valueLine">
          <div class={`value ${isAxisHomed('X') ? '' : 'dimmed'}`}>{axisValue('X')}</div>
          <div class="unit">mm</div>
        </div>
      </div>
      <div class={`positionCard ${isAxisHomed('Y') ? 'homed' : ''}`}>
        <div class="positionCardHead">
          <div class="cardTitle">Y</div>
          <div class={`endstopIndicator ${endstopIndicators.y ? 'active' : ''}`} title="Endstop Y status"></div>
        </div>
        <div class="valueLine">
          <div class={`value ${isAxisHomed('Y') ? '' : 'dimmed'}`}>{axisValue('Y')}</div>
          <div class="unit">mm</div>
        </div>
      </div>
      <div class={`positionCard ${isAxisHomed('Z') ? 'homed' : ''}`}>
        <div class="positionCardHead">
          <div class="cardTitle">Z</div>
          <div class={`endstopIndicator ${endstopIndicators.z ? 'active' : ''}`} title="Endstop Z status"></div>
        </div>
        <div class="valueLine">
          <div class={`value ${isAxisHomed('Z') ? '' : 'dimmed'}`}>{axisValue('Z')}</div>
          <div class="unit">mm</div>
        </div>
      </div>
    </div>

    <div class="homeRow">
      <div class="homeCard">
        <button class="homeButton" on:click={() => homeAxis('X')}>
          <span class="label">Home X</span>
          <span class="sub">Alleen X-as</span>
        </button>
      </div>

      <div class="homeCard">
        <button class="homeButton" on:click={() => homeAxis('Y')}>
          <span class="label">Home Y</span>
          <span class="sub">Alleen Y-as</span>
        </button>
      </div>

      <div class="homeCard">
        <button class="homeButton" on:click={() => homeAxis('Z')}>
          <span class="label">Home Z</span>
          <span class="sub">Vlak oppervlak vereist</span>
        </button>
      </div>
    </div>
  </section>
</div>

{#if showAlarm}
  <div class="modalBack">
    <div class="modal" role="dialog" aria-modal="true">
      <h2 class="modalTitle">Alarmmelding</h2>
      <div class="modalText">{visibleAlarmMessage()}</div>
      <div class="modalActions">
        <button class="secondary" on:click={() => (showAlarm = false)}>Sluiten</button>
        <button class="secondary" on:click={resetKlipper}>Reset</button>
        <button class="dangerButton" on:click={resetFirmware}>Firmware restart</button>
      </div>
    </div>
  </div>
{/if}

{#if showHomeConfirm}
  <div class="modalBack homeModalBack">
    <div class="modal" role="dialog" aria-modal="true">
      <h2 class="modalTitle">{homeDialogTitle()}</h2>
      <div class="modalText">{homeConfirmText()}</div>
      <div class="modalActions">
        {#if completedHomeAxis}
          <button on:click={confirmPendingHome}>Bevestiging</button>
        {:else if !homeInProgress}
          <button class="secondary" on:click={() => { showHomeConfirm = false; pendingHome = null; }}>Annuleren</button>
          <button on:click={confirmPendingHome}>OK</button>
        {:else}
          <button class="secondary" on:click={() => (showHomeConfirm = false)}>Sluiten</button>
        {/if}
      </div>
    </div>
  </div>
{/if}
