<script lang="ts">
  export let open = false;
  export let title = '';
  export let value = '';
  export let subtitle = '';
  export let error = '';
  export let closeLabel = 'Sluiten';
  export let onClose: () => void = () => {};
  export let onAppend: (value: string) => void = () => {};
  export let onBackspace: () => void = () => {};
  export let onClear: () => void = () => {};
  export let onConfirm: () => void = () => {};

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="numPadBack"
    role="button"
    tabindex="0"
    aria-label="Sluit keypad"
    on:click|self={onClose}
    on:keydown={(event) => {
      if (event.key === 'Enter') onConfirm();
      if (event.key === 'Escape' || event.key === ' ') onClose();
    }}
  >
    <div class="numPadModal">
      <div class="numPadHead">
        <div class="numPadTitle">{title}</div>
        <button class="numPadClose" type="button" on:click={onClose}>{closeLabel}</button>
      </div>

      <div class="numPadTopRow">
        <div class="numPadValue">{value || '\u00A0'}</div>
        {#if subtitle}
          <div class="numPadSubtitle">{subtitle}</div>
        {/if}
      </div>

      {#if error}
        <div class="numPadError">{error}</div>
      {/if}

      <div class="numPadGrid">
        {#each keys as key}
          <button type="button" on:click={() => onAppend(key)}>{key}</button>
        {/each}
        <button type="button" on:click={() => onAppend('.')}>.</button>
        <button type="button" on:click={() => onAppend('0')}>0</button>
        <button type="button" on:click={onBackspace}>⌫</button>
        <button type="button" class="danger" on:click={onClear}>Clear</button>
        <button type="button" class="primary confirm" on:click={onConfirm}>Enter</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .numPadBack {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: grid;
    place-items: center;
    padding: 10px;
    background: rgba(0, 0, 0, 0.54);
  }

  .numPadModal {
    width: min(92vw, 540px);
    max-height: calc(100dvh - 20px);
    overflow: auto;
    border-radius: 18px;
    border: 1px solid rgba(109, 146, 219, 0.28);
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.99), rgba(7, 14, 26, 0.99));
    padding: 10px;
    box-shadow: 0 24px 36px rgba(0, 0, 0, 0.36);
  }

  .numPadHead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .numPadTitle {
    font-size: 20px;
    font-weight: 950;
    line-height: 1.1;
  }

  .numPadClose {
    min-height: 48px;
    min-width: 92px;
    border-radius: 14px;
  }

  .numPadTopRow {
    display: grid;
    grid-template-columns: minmax(150px, 0.5fr) minmax(0, 1fr);
    gap: 10px;
    align-items: stretch;
    margin-bottom: 10px;
  }

  .numPadValue {
    min-height: 50px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 8px 12px;
    border-radius: 14px;
    border: 1px solid rgba(124, 199, 255, 0.18);
    background: rgba(7, 16, 30, 0.92);
    color: #ffffff;
    font-size: 24px;
    font-weight: 950;
    line-height: 1;
    text-align: right;
  }

  .numPadSubtitle {
    min-height: 50px;
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-radius: 14px;
    border: 1px solid rgba(124, 199, 255, 0.1);
    background: rgba(10, 20, 36, 0.76);
    color: #aebfdf;
    font-size: 14px;
    font-weight: 750;
    line-height: 1.25;
  }

  .numPadError {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    font-size: 14px;
    font-weight: 750;
  }

  .numPadGrid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 7px;
  }

  .numPadGrid button {
    min-height: 50px;
    border-radius: 14px;
    padding: 8px;
    font-size: 20px;
    font-weight: 950;
  }

  .numPadGrid .confirm {
    grid-column: span 2;
  }

  @media (max-height: 520px) {
    .numPadModal {
      padding: 10px;
    }

    .numPadHead,
    .numPadTopRow {
      margin-bottom: 8px;
    }

    .numPadValue,
    .numPadSubtitle,
    .numPadGrid button {
      min-height: 48px;
    }

    .numPadTitle {
      font-size: 18px;
    }
  }

  @media (max-width: 720px) {
    .numPadTopRow {
      grid-template-columns: 1fr;
    }
  }
</style>
