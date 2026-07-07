<script lang="ts">
  import { onMount } from 'svelte';

  type PrinterInfo = {
    result?: {
      state?: string;
      state_message?: string;
    };
    error?: any;
  };

  type ConfigfileSettings = {
    result?: {
      status?: Record<string, any>;
    };
    error?: any;
  };

  let statusText = "Connecting…";
  let statusSub = "";
  let macros: string[] = [];
  let lastError = "";

  function setError(msg: string) {
    lastError = msg;
    console.error(msg);
  }

  async function mrGet<T>(path: string): Promise<T> {
    const res = await fetch(`/moonraker${path}`);
    const txt = await res.text();

    // Moonraker is JSON. Als nginx/html terugkomt, zie je dat meteen hier.
    try {
      const json = JSON.parse(txt);
      if (!res.ok || json?.error) {
        throw new Error(json?.error?.message ?? txt);
      }
      return json as T;
    } catch (e: any) {
      throw new Error(`Moonraker response parse/error: ${e?.message ?? e}\nRaw: ${txt.slice(0, 300)}`);
    }
  }

  async function sendGcode(script: string) {
    lastError = "";
    try {
      const res = await fetch(`/moonraker/printer/gcode/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script })
      });

      const txt = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(txt);
      } catch {
        // ignore
      }

      if (!res.ok || json?.error) {
        const msg = json?.error?.message ?? txt;
        setError(`G-code failed: ${msg}`);
        alert(`G-code error:\n${msg}`);
      }
    } catch (err: any) {
      setError(`Connection error: ${err?.message ?? err}`);
      alert("Connection error (Moonraker not reachable)");
    }
  }

  async function cancelJob() {
    lastError = "";
    try {
      const res = await fetch(`/moonraker/printer/print/cancel`, { method: "POST" });
      const txt = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(txt);
      } catch {
        // ignore
      }
      if (!res.ok || json?.error) {
        const msg = json?.error?.message ?? txt;
        setError(`Cancel failed: ${msg}`);
        alert(`Cancel failed:\n${msg}`);
      }
    } catch (err: any) {
      setError(`Connection error: ${err?.message ?? err}`);
      alert("Connection error");
    }
  }

  async function emergencyStop() {
    // Klipper emergency stop
    await sendGcode("M112");
  }

  async function runMacro(name: string) {
    // Probeer eerst RUN_MACRO (netjes), fallback is macro naam als command
    await sendGcode(`RUN_MACRO MACRO=${name}`);
  }

  function extractMacroNamesFromConfigfileSettings(payload: any): string[] {
    // Verwacht: result.status.configfile.settings met keys als "gcode_macro HOME_X": {...}
    const settings = payload?.result?.status?.configfile?.settings;
    if (!settings || typeof settings !== "object") return [];

    const names: string[] = [];
    for (const key of Object.keys(settings)) {
      // key voorbeeld: "gcode_macro HOME_X"
      if (key.startsWith("gcode_macro ")) {
        const n = key.replace("gcode_macro ", "").trim();
        if (n) names.push(n);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  async function refreshStatus() {
    try {
      const info = await mrGet<PrinterInfo>(`/printer/info`);
      const st = info?.result?.state ?? "unknown";
      const msg = info?.result?.state_message ?? "";

      if (st === "ready") {
        statusText = "Ready";
        statusSub = "";
      } else if (st === "printing") {
        statusText = "Printing";
        statusSub = "";
      } else if (st === "error") {
        statusText = "Alarm";
        statusSub = msg || "Unknown error";
      } else {
        statusText = st;
        statusSub = msg;
      }
    } catch (e: any) {
      statusText = "Disconnected";
      statusSub = "Moonraker not reachable";
      setError(e?.message ?? String(e));
    }
  }

  async function refreshMacros() {
    try {
      // Query configfile object (veel setups hebben dit)
      const cfg = await mrGet<ConfigfileSettings>(`/printer/objects/query?configfile=settings`);
      const names = extractMacroNamesFromConfigfileSettings(cfg);

      // Als dit leeg is, kunnen we later alternatief pakken (bijv. via /server/files/... printer.cfg parsen)
      macros = names;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      macros = [];
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;

  async function init() {
    await refreshStatus();
    await refreshMacros();
    timer = setInterval(refreshStatus, 1000);
  }

  onMount(() => {
    init();

    return () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
  });

  // SvelteKit: cleanup
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
</script>

<style>
  .homePage {
    max-width: 720px;
  }

  .dashboardGrid {
    display: grid;
    gap: var(--space-4);
  }

  @media (min-width: 760px) {
    .dashboardGrid {
      grid-template-columns: 1.1fr 0.9fr;
    }
  }

  .cardHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .statusLine {
    font-size: clamp(24px, 5vw, 28px);
    font-weight: 800;
    line-height: 1.15;
  }

  .statusLine.alarm {
    color: #ffb5b5;
  }

  .statusSub {
    margin-top: var(--space-2);
    color: var(--text-medium);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
  }

  .macroList {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .macroButton {
    min-width: 88px;
  }

  .actionRow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    margin-top: var(--space-3);
  }

  .emptyMessage {
    color: var(--text-medium);
    font-size: var(--font-size-sm);
  }
</style>

<div class="pageShell homePage">
  <div class="dashboardGrid">
    <section class="surfaceCard statusCard">
      <div class="cardHeader">
        <h1 class="sectionTitle">Status</h1>
      </div>
      <div class="statusLine" class:alarm={statusText === "Alarm"}>{statusText}</div>
      {#if statusSub}
        <div class="statusSub">{statusSub}</div>
      {/if}

      {#if lastError}
        <div class="errorBox">{lastError}</div>
      {/if}
    </section>

    <section class="surfaceCard macrosCard">
      <div class="cardHeader">
        <h1 class="sectionTitle">Macro’s</h1>
      </div>

      {#if macros.length === 0}
        <p class="emptyMessage">Geen macro’s gevonden (nog).</p>
        <p class="hint">
          Tip: zorg dat Moonraker toegang heeft tot configfile object. Zo niet, dan pakken we straks printer.cfg via de file API.
        </p>

        <div class="actionRow">
          <button class="secondary" on:click={refreshMacros}>Refresh</button>
          <button class="secondary" on:click={cancelJob}>Cancel Job</button>
          <button class="danger" on:click={emergencyStop}>Emergency Stop</button>
        </div>
      {:else}
        <div class="macroList">
          {#each macros as m}
            <button class="macroButton" on:click={() => runMacro(m)}>{m}</button>
          {/each}
        </div>

        <div class="actionRow">
          <button class="secondary" on:click={refreshMacros}>Refresh macro’s</button>
          <button class="secondary" on:click={cancelJob}>Cancel Job</button>
          <button class="danger" on:click={emergencyStop}>Emergency Stop</button>
        </div>
      {/if}
    </section>
  </div>
</div>
