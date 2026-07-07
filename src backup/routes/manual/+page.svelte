<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Manual jog via Moonraker
   * - 3 rijen: X/Y/Z met + en - knoppen
   * - Per as een mm-veld; tik erop => touchscreen numpad modal
   * - Clamp input naar max bereik op basis van position_min/max en huidige positie
   * - Jog werkt alleen als assen gehomed zijn (toolhead.homed_axes)
   *
   * Vereist nginx proxy: /moonraker -> http://127.0.0.1:7125
   */

  type MR<T> = { result?: T; error?: { message?: string } };

  let connected = false;
  let homedAxes: string[] = [];
  let lastError = "";

  let pos: [number, number, number] = [0, 0, 0];
  let positionMax: [number, number, number] = [100, 100, 50];
  let positionMin: [number, number, number] = [0, 0, 0];

  let stepX = 10;
  let stepY = 10;
  let stepZ = 1;

  // keypad modal
  let keypadOpen = false;
  let keypadAxis: "X" | "Y" | "Z" = "X";
  let keypadValue = "";
  let keypadHint = "";
  let keypadError = "";

  let poll: ReturnType<typeof setInterval> | undefined;

  function axisIndex(axis: "X" | "Y" | "Z") {
    return axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  }

  function isAxisHomed(axis: "X" | "Y" | "Z") {
    return homedAxes.includes(axis.toLowerCase());
  }

  function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
  }

  function toFixedNice(n: number) {
    const s = n.toFixed(3);
    return s.replace(/\.?0+$/, "");
  }

  async function mrGet<T>(path: string): Promise<T> {
    const res = await fetch(`/moonraker${path}`);
    const txt = await res.text();
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch (e: any) {
      throw new Error(`Moonraker parse error: ${e?.message ?? e}`);
    }
    if (!res.ok || json?.error) throw new Error(json?.error?.message ?? txt);
    return json as T;
  }

  async function mrPost<T>(path: string, body?: any): Promise<T> {
    const res = await fetch(`/moonraker${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const txt = await res.text();
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch (e: any) {
      throw new Error(`Moonraker parse error: ${e?.message ?? e}`);
    }
    if (!res.ok || json?.error) throw new Error(json?.error?.message ?? txt);
    return json as T;
  }

  async function refreshState() {
    try {
      const q = await mrGet<MR<any>>(
        `/printer/objects/query?toolhead=position,homed_axes&configfile=settings`
      );

      const status = q?.result?.status ?? {};
      const toolhead = status.toolhead ?? {};
      const cfg = status.configfile?.settings ?? {};

      connected = true;
      lastError = "";

      // position
      const p = toolhead.position;
      if (Array.isArray(p) && p.length >= 3) {
        pos = [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
      }

      // homed axes
      const ha = toolhead.homed_axes ?? "";
      homedAxes = typeof ha === "string" ? ha.split("") : [];

      // read limits from config
      const sx = cfg["stepper_x"] ?? {};
      const sy = cfg["stepper_y"] ?? {};
      const sz = cfg["stepper_z"] ?? {};

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
    } catch (e: any) {
      connected = false;
      homedAxes = [];
      lastError = e?.message ?? String(e);
      console.error(lastError);
    }
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
    if (axis === "X") stepX = safe;
    if (axis === "Y") stepY = safe;
    if (axis === "Z") stepZ = safe;
  }

  function getAxisStep(axis: "X" | "Y" | "Z") {
    return axis === "X" ? stepX : axis === "Y" ? stepY : stepZ;
  }

  function openKeypad(axis: "X" | "Y" | "Z") {
    keypadAxis = axis;
    keypadValue = String(getAxisStep(axis));
    keypadError = "";
    keypadHint = `Max mogelijk vanaf huidige positie: ${toFixedNice(maxReach(axis))} mm`;
    keypadOpen = true;

    // focus input (voor soft keyboard op sommige touch panels)
    setTimeout(() => {
      const el = document.getElementById("keypad-input") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
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
    const n = Number(s);

    if (!s || Number.isNaN(n)) {
      keypadError = "Voer een geldig getal in.";
      return;
    }
    if (n < 0) {
      keypadError = "Alleen positieve waardes.";
      return;
    }

    // clamp naar safe bereik
    setAxisStep(keypadAxis, n);
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

  async function jog(axis: "X" | "Y" | "Z", dir: 1 | -1) {
    if (!connected) {
      alert("Geen verbinding met Moonraker.");
      return;
    }
    if (!isAxisHomed(axis)) {
      alert("Eerst homen in Home scherm (veiligheid).");
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

    const cmd = `G91\nG1 ${axis}${toFixedNice(dir * actualMove)} F3000\nG90`;

    try {
      await mrPost<MR<any>>(`/printer/gcode/script`, { script: cmd });
      await refreshState();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.error(lastError);
      alert(`G-code error:\n${lastError}`);
    }
  }

  onMount(() => {
    let active = true;

    (async () => {
      await refreshState();
      if (!active) return;
      poll = setInterval(refreshState, 800);
    })();

    return () => {
      active = false;
      if (poll) {
        clearInterval(poll);
        poll = undefined;
      }
    };
  });
</script>

<style>
  .manualPage {
    max-width: 720px;
    gap: var(--space-4);
  }

  .manualHint {
    margin: 0;
  }

  .badgeRow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #586276;
  }

  .dot.ok {
    background: #2dcc71;
  }

  .dot.bad {
    background: #e65d4a;
  }

  .manualControls {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .axisGrid {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    align-items: center;
  }

  .axisLabel {
    font-weight: 800;
    font-size: var(--font-size-lg);
  }

  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .stepBox {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    min-width: 86px;
    justify-content: space-between;
    font-weight: 700;
  }

  .unitLabel {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-weight: 600;
  }

  .hintline {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .keypadOverlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 50;
    padding: var(--space-4);
  }

  .modal {
    width: min(420px, 100%);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .modalTitle {
    font-size: var(--font-size-lg);
    font-weight: 800;
    margin: 0;
  }

  .modal input {
    width: 100%;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-strong);
    padding: var(--space-3);
    font-size: var(--font-size-lg);
    font-weight: 700;
  }

  .modalHint {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .modalErr {
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs);
  }

  .keypadGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .kbtn {
    min-height: 44px;
    font-size: var(--font-size-lg);
    border-radius: var(--radius-md);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  @media (max-width: 620px) {
    .axisGrid {
      grid-template-columns: 1fr;
      justify-items: stretch;
      gap: var(--space-2);
    }

    .btns {
      order: 3;
      justify-content: space-between;
    }

    .stepBox {
      order: 2;
      min-width: 0;
    }
  }
</style>

<div class="pageShell manualPage">
  <section class="surfaceCard manualSummary">
    <h1 class="sectionTitle">Handbediening</h1>

    <p class="sectionHint manualHint">
      Positie: X {toFixedNice(pos[0])} | Y {toFixedNice(pos[1])} | Z {toFixedNice(pos[2])}
      <br />
      Limits: X {positionMin[0]}..{positionMax[0]} • Y {positionMin[1]}..{positionMax[1]} • Z {positionMin[2]}..{positionMax[2]}
    </p>

    <div class="badgeRow">
      <div class="statusPill" class:ok={connected} class:err={!connected}>
        <span class="dot" class:ok={connected} class:bad={!connected}></span>
        {connected ? "Connected" : "Disconnected"}
      </div>

      <div class="statusPill" class:ok={isAxisHomed("X")} class:warn={!isAxisHomed("X")}>
        <span class="dot" class:ok={isAxisHomed("X")} class:bad={!isAxisHomed("X")}></span>
        X homed
      </div>
      <div class="statusPill" class:ok={isAxisHomed("Y")} class:warn={!isAxisHomed("Y")}>
        <span class="dot" class:ok={isAxisHomed("Y")} class:bad={!isAxisHomed("Y")}></span>
        Y homed
      </div>
      <div class="statusPill" class:ok={isAxisHomed("Z")} class:warn={!isAxisHomed("Z")}>
        <span class="dot" class:ok={isAxisHomed("Z")} class:bad={!isAxisHomed("Z")}></span>
        Z homed
      </div>
    </div>

    {#if lastError}
      <div class="errorBox">{lastError}</div>
    {/if}
  </section>

  <section class="surfaceCard manualControls">
    <h2 class="sectionTitle">Jog (mm)</h2>

    <div class="axisGrid">
      <div class="axisLabel">X</div>
      <div class="btns">
        <button class="secondary" disabled={!connected || !isAxisHomed("X")} on:click={() => jog("X", -1)}>X -</button>
        <button class="secondary" disabled={!connected || !isAxisHomed("X")} on:click={() => jog("X", 1)}>X +</button>
      </div>
      <button type="button" class="stepBox" on:click={() => openKeypad("X")}>
        <span>{toFixedNice(stepX)}</span>
        <span class="unitLabel">mm</span>
      </button>
    </div>

    <div class="axisGrid">
      <div class="axisLabel">Y</div>
      <div class="btns">
        <button class="secondary" disabled={!connected || !isAxisHomed("Y")} on:click={() => jog("Y", -1)}>Y -</button>
        <button class="secondary" disabled={!connected || !isAxisHomed("Y")} on:click={() => jog("Y", 1)}>Y +</button>
      </div>
      <button type="button" class="stepBox" on:click={() => openKeypad("Y")}>
        <span>{toFixedNice(stepY)}</span>
        <span class="unitLabel">mm</span>
      </button>
    </div>

    <div class="axisGrid">
      <div class="axisLabel">Z</div>
      <div class="btns">
        <button class="secondary" disabled={!connected || !isAxisHomed("Z")} on:click={() => jog("Z", -1)}>Z -</button>
        <button class="secondary" disabled={!connected || !isAxisHomed("Z")} on:click={() => jog("Z", 1)}>Z +</button>
      </div>
      <button type="button" class="stepBox" on:click={() => openKeypad("Z")}>
        <span>{toFixedNice(stepZ)}</span>
        <span class="unitLabel">mm</span>
      </button>
    </div>

    <p class="hintline">
      Tik op het mm-vakje om de stapgrootte te wijzigen. Waardes worden automatisch begrensd op basis van bereik en huidige positie.
    </p>
  </section>
</div>

{#if keypadOpen}
  <div class="keypadOverlay">
    <div class="modal" role="dialog" aria-modal="true">
      <h3 class="modalTitle">Stapgrootte {keypadAxis} (mm)</h3>

      <input
        id="keypad-input"
        inputmode="decimal"
        bind:value={keypadValue}
        placeholder="bijv. 10"
      />

      <div class="modalHint">{keypadHint}</div>

      {#if keypadError}
        <div class="modalErr">{keypadError}</div>
      {/if}

      <div class="keypadGrid">
        <button class="kbtn" on:click={() => appendKey("1")}>1</button>
        <button class="kbtn" on:click={() => appendKey("2")}>2</button>
        <button class="kbtn" on:click={() => appendKey("3")}>3</button>

        <button class="kbtn" on:click={() => appendKey("4")}>4</button>
        <button class="kbtn" on:click={() => appendKey("5")}>5</button>
        <button class="kbtn" on:click={() => appendKey("6")}>6</button>

        <button class="kbtn" on:click={() => appendKey("7")}>7</button>
        <button class="kbtn" on:click={() => appendKey("8")}>8</button>
        <button class="kbtn" on:click={() => appendKey("9")}>9</button>

        <button class="kbtn secondary" on:click={() => appendKey(".")}>.</button>
        <button class="kbtn" on:click={() => appendKey("0")}>0</button>
        <button class="kbtn secondary" on:click={backspaceKey}>⌫</button>

        <button class="kbtn danger" on:click={clearKey}>Clear</button>
        <button class="kbtn ghost" on:click={closeKeypad}>Cancel</button>
        <button class="kbtn primary" on:click={confirmKeypad}>Enter</button>
      </div>

      <div class="actions">
        <button class="secondary" on:click={closeKeypad}>Sluiten</button>
        <button class="primary" on:click={confirmKeypad}>Bevestigen</button>
      </div>
    </div>
  </div>
{/if}
