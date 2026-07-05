<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { uiSettings } from '$lib/ui-settings';

  const steps = [
    'Home eerst de machine.',
    'Kies daarna vorm snijden, DXF of handbediening.',
    'Bereid de taak voor en controleer de status.',
    'Start pas met de fysieke triggerknop als alles klaar staat.'
  ];

  let dontShowAgain = false;
  let showInstructions = true;

  function openHome() {
    if (dontShowAgain) {
      uiSettings.patch({ showInstructions: false });
    }
    void goto('/home');
  }

  onMount(() => {
    uiSettings.load();
    showInstructions = get(uiSettings).showInstructions;
    if (!showInstructions) {
      void goto('/home');
    }
  });
</script>

<style>
  .screen {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 20px;
    background:
      radial-gradient(circle at top right, rgba(124, 199, 255, 0.12), transparent 28%),
      linear-gradient(180deg, rgba(7, 14, 26, 1), rgba(11, 19, 35, 1));
  }

  .modal {
    width: min(100%, 620px);
    background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(109, 146, 219, 0.18);
    border-radius: 26px;
    padding: 18px 18px 16px;
    box-shadow: 0 24px 36px rgba(0, 0, 0, 0.28);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 950;
    letter-spacing: -0.04em;
  }

  p {
    margin: 6px 0 0;
    color: #c7d5eb;
    font-size: 16px;
  }

  .close {
    width: 52px;
    min-width: 52px;
    min-height: 52px;
    border-radius: 16px;
    border: 1px solid rgba(124, 199, 255, 0.14);
    background: rgba(16, 26, 44, 0.9);
    color: #f5fbff;
    font-size: 30px;
    line-height: 1;
    cursor: pointer;
  }

  .steps {
    display: grid;
    gap: 10px;
  }

  .step {
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(11, 22, 39, 0.86);
    border: 1px solid rgba(124, 199, 255, 0.12);
    color: #e7efff;
    font-size: 17px;
    font-weight: 800;
  }

  .footer {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }

  .checkboxRow {
    margin-top: 16px;
    padding: 12px 14px;
    background: rgba(8, 16, 30, 0.72);
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 14px;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    color: #c9d8ee;
    font-size: 16px;
    font-weight: 700;
  }

  .checkbox input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: #7cc7ff;
  }

  .ok {
    min-width: 170px;
    min-height: 62px;
    border-radius: 18px;
    border: 1px solid rgba(124, 199, 255, 0.14);
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    color: #eaf0ff;
    font-size: 20px;
    font-weight: 950;
    cursor: pointer;
  }
</style>

{#if showInstructions}
  <div class="screen">
    <section class="modal">
      <div class="head">
        <div>
          <h1>Bediening</h1>
          <p>Volg deze stappen voordat je de machine gebruikt.</p>
        </div>
        <button class="close" aria-label="Sluiten" on:click={openHome}>×</button>
      </div>

      <div class="steps">
        {#each steps as step, index}
          <div class="step">{index + 1}. {step}</div>
        {/each}
      </div>

      <div class="checkboxRow">
        <label class="checkbox">
          <input type="checkbox" bind:checked={dontShowAgain} />
          <span>Deze melding niet meer weergeven</span>
        </label>
      </div>

      <div class="footer">
        <button class="ok" on:click={openHome}>OK</button>
      </div>
    </section>
  </div>
{/if}
