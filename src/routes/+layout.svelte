<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { emergencyStopState } from '$lib/emergency-stop-state';

  type NavItem = { href: string; label: string; icon: 'home' | 'manual' | 'shape' | 'dxf' | 'settings' };

  const nav: NavItem[] = [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/shape', label: 'Vorm snijden', icon: 'shape' },
    { href: '/manual', label: 'Handbediening', icon: 'manual' },
    { href: '/dxf', label: 'DXF snijden', icon: 'dxf' },
    { href: '/settings', label: 'Instellingen', icon: 'settings' }
  ];

  function isActive(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }


  onMount(() => {
    emergencyStopState.load();
  });
</script>

<style>
  :global(:root) {
    color-scheme: dark;
    --bg-body: #030914;
    --bg-body-glow: rgba(27, 59, 115, 0.28);
    --bg-surface: rgba(10, 20, 38, 0.94);
    --bg-surface-alt: rgba(15, 27, 49, 0.98);
    --bg-surface-soft: rgba(19, 35, 63, 0.72);
    --border-color: rgba(91, 130, 197, 0.16);
    --border-color-strong: rgba(120, 165, 242, 0.28);
    --accent: #7cc7ff;
    --accent-strong: #5b8eff;
    --accent-soft: rgba(124, 199, 255, 0.16);
    --success: #73f0b0;
    --warn: #ffd06e;
    --danger: #ff8c8c;
    --text-strong: #f3f7ff;
    --text-medium: #ccdaef;
    --text-muted: #8fa3c7;
    --radius-sm: 12px;
    --radius-md: 18px;
    --radius-lg: 24px;
    --space-1: 4px;
    --space-2: 6px;
    --space-3: 10px;
    --space-4: 14px;
    --space-5: 20px;
    --space-6: 24px;
    --space-7: 32px;
    --font-size-xs: 15px;
    --font-size-sm: 17px;
    --font-size-md: 18px;
    --font-size-lg: 21px;
    --font-size-xl: 26px;
    --font-size-2xl: 32px;
  }

  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg-body);
    color: var(--text-strong);
    font-family: "Avenir Next", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    font-size: var(--font-size-md);
    line-height: 1.45;
    overflow: hidden;
    overscroll-behavior: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: pan-y;
    cursor: none;
  }

  :global(button),
  :global(input),
  :global(textarea),
  :global(select) {
    font-family: inherit;
  }

  :global(*) {
    box-sizing: border-box;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: none !important;
  }

  :global(*::-webkit-scrollbar) {
    width: 0;
    height: 0;
    display: none;
  }

  :global(input),
  :global(textarea) {
    user-select: text;
    -webkit-user-select: text;
  }

  :global(body) {
    background:
      radial-gradient(circle at top left, var(--bg-body-glow), transparent 28%),
      radial-gradient(circle at bottom right, rgba(67, 102, 176, 0.16), transparent 26%),
      linear-gradient(180deg, #040912 0%, #040814 48%, #02060d 100%);
  }

  .layout {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    height: 100dvh;
    background: var(--bg-body);
    overflow: hidden;
  }

  .sidebar {
    background:
      linear-gradient(180deg, rgba(14, 25, 46, 0.98) 0%, rgba(8, 18, 33, 0.98) 100%);
    border-right: 1px solid var(--border-color);
    padding: 10px 6px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  a.item {
    width: 72px;
    height: 72px;
    border-radius: 20px;
    display: grid;
    place-items: center;
    text-decoration: none;
    color: var(--text-medium);
    border: 1px solid rgba(255, 255, 255, 0.02);
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    background: linear-gradient(180deg, rgba(16, 27, 47, 0.18), rgba(9, 18, 32, 0.18));
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease;
    position: relative;
    overflow: hidden;
  }

  a.item:hover {
    background: linear-gradient(180deg, rgba(24, 43, 73, 0.72), rgba(10, 21, 40, 0.92));
    border-color: rgba(124, 199, 255, 0.22);
    color: var(--text-strong);
    transform: translateY(-1px);
  }

  a.item.active {
    background:
      linear-gradient(180deg, rgba(28, 49, 83, 0.98), rgba(13, 26, 46, 0.98));
    border-color: rgba(124, 199, 255, 0.34);
    color: var(--text-strong);
    box-shadow:
      0 0 0 1px rgba(124, 199, 255, 0.18) inset,
      0 12px 22px rgba(0, 0, 0, 0.24);
  }

  a.item:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .icon {
    width: 30px;
    height: 30px;
    display: block;
  }

  .stroke {
    stroke: currentColor;
    stroke-width: 2.75;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .fillSoft {
    fill: rgba(124, 199, 255, 0.08);
    stroke: currentColor;
    stroke-width: 2.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .main {
    overflow: hidden;
    display: grid;
    grid-template-rows: 1fr;
    min-width: 0;
  }

  .content {
    overflow: auto;
    padding: 14px;
    width: 100%;
    max-width: none;
    margin: 0 auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scrollbar-width: none;
    -ms-overflow-style: none;
    touch-action: pan-y;
  }

  :global(.pageShell) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: calc(100dvh - 28px);
    padding-bottom: 14px;
  }

  :global(.surfaceCard) {
    background:
      linear-gradient(180deg, rgba(13, 23, 43, 0.96), rgba(8, 16, 29, 0.96));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 14px;
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(8px);
  }

  :global(.surfaceCard.tight) {
    padding: var(--space-3);
    border-radius: var(--radius-md);
  }

  :global(.sectionTitle) {
    font-size: var(--font-size-xl);
    font-weight: 900;
    margin: 0 0 var(--space-2);
    letter-spacing: 0.01em;
  }

  :global(.sectionLead) {
    color: var(--text-medium);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  :global(.sectionHint) {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  :global(.statusPill),
  :global(.badgePill) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: rgba(14, 26, 48, 0.88);
    font-size: var(--font-size-sm);
    font-weight: 800;
    color: var(--text-medium);
  }

  :global(.statusPill.ok) {
    color: #a8f9c6;
    border-color: #215c39;
    background: rgba(33, 92, 57, 0.18);
  }

  :global(.statusPill.warn) {
    color: #ffe1a4;
    border-color: #6a5320;
    background: rgba(106, 83, 32, 0.18);
  }

  :global(.statusPill.err) {
    color: #ffb5b5;
    border-color: #7a1f1f;
    background: rgba(122, 31, 31, 0.18);
  }

  :global(.errorBox) {
    margin-top: var(--space-3);
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    max-height: 150px;
    overflow: auto;
  }

  :global(button) {
    background: linear-gradient(180deg, rgba(26, 46, 80, 0.92), rgba(18, 33, 60, 0.92));
    color: var(--text-strong);
    border: 1px solid rgba(124, 199, 255, 0.12);
    border-radius: 16px;
    padding: 12px 16px;
    font-weight: 800;
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
    min-height: 46px;
  }

  :global(button:hover) {
    background: linear-gradient(180deg, rgba(33, 58, 100, 0.96), rgba(21, 39, 71, 0.96));
    border-color: rgba(124, 199, 255, 0.24);
  }

  :global(button:active) {
    transform: translateY(1px);
  }

  :global(button:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  :global(button.primary) {
    background: linear-gradient(180deg, rgba(86, 145, 255, 0.92), rgba(63, 106, 194, 0.9));
    border-color: rgba(151, 210, 255, 0.32);
    color: #f8fbff;
  }

  :global(button.primary:hover) {
    background: linear-gradient(180deg, rgba(101, 159, 255, 0.96), rgba(73, 120, 217, 0.94));
  }

  :global(button.secondary) {
    background: rgba(11, 22, 39, 0.92);
    color: var(--text-medium);
  }

  :global(button.secondary:hover) {
    color: var(--text-strong);
  }

  :global(button.ghost) {
    background: transparent;
  }

  :global(button.danger) {
    background: rgba(122, 31, 31, 0.18);
    border-color: #7a1f1f;
    color: #ffb5b5;
  }

  :global(button.danger:hover) {
    background: rgba(122, 31, 31, 0.28);
  }

  :global(input[type="file"]) {
    max-width: 100%;
    font-size: var(--font-size-sm);
  }

  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 84px 1fr;
    }

    a.item {
      width: 68px;
      height: 68px;
      border-radius: 18px;
    }
    .icon {
      width: 28px;
      height: 28px;
    }

    .content {
      padding: 10px;
    }

    :global(.surfaceCard) {
      padding: 12px;
    }

    :global(.sectionTitle) {
      font-size: 19px;
    }
  }
</style>

<div class="layout">
  <aside class="sidebar">
    <nav class="nav">
      {#each nav as n}
        <a
          class="item {isActive($page.url.pathname, n.href) ? 'active' : ''}"
          href={n.href}
          aria-label={n.label}
          title={n.label}
        >
          {#if n.icon === 'home'}
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path class="stroke" d="M4 10.5 12 4l8 6.5" />
              <path class="stroke" d="M6.5 10.2V20h11V10.2" />
            </svg>
          {:else if n.icon === 'manual'}
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <line class="stroke" x1="6" y1="5" x2="6" y2="19" />
              <line class="stroke" x1="12" y1="5" x2="12" y2="19" />
              <line class="stroke" x1="18" y1="5" x2="18" y2="19" />
              <circle class="fillSoft" cx="6" cy="9" r="2.4" />
              <circle class="fillSoft" cx="12" cy="14" r="2.4" />
              <circle class="fillSoft" cx="18" cy="7" r="2.4" />
            </svg>
          {:else if n.icon === 'shape'}
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <polygon class="stroke" points="4.5 14.5 9 5.5 13.5 14.5" />
              <circle class="stroke" cx="17.5" cy="10.5" r="3.8" />
              <rect class="stroke" x="4.5" y="16.5" width="15" height="4.5" rx="1.4" />
            </svg>
          {:else if n.icon === 'dxf'}
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path class="fillSoft" d="M7 3.8h7l3 3V20.2H7z" />
              <path class="stroke" d="M14 3.8v3h3" />
              <path class="stroke" d="M9 13h6" />
              <path class="stroke" d="M9 16h5" />
            </svg>
          {:else if n.icon === 'settings'}
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="stroke" cx="12" cy="12" r="6" />
              <circle class="stroke" cx="12" cy="12" r="3.2" />
              <line class="stroke" x1="12" y1="4.2" x2="12" y2="6.4" />
              <line class="stroke" x1="12" y1="17.6" x2="12" y2="19.8" />
              <line class="stroke" x1="5.8" y1="12" x2="3.8" y2="12" />
              <line class="stroke" x1="20.2" y1="12" x2="18.2" y2="12" />
              <line class="stroke" x1="6.9" y1="6.9" x2="5.5" y2="5.5" />
              <line class="stroke" x1="18.5" y1="18.5" x2="17.1" y2="17.1" />
              <line class="stroke" x1="17.1" y1="6.9" x2="18.5" y2="5.5" />
              <line class="stroke" x1="5.5" y1="18.5" x2="6.9" y2="17.1" />
            </svg>
          {/if}
        </a>
      {/each}
    </nav>  </aside>

  <section class="main">
    <main class="content">
      <slot />
    </main>
  </section>
</div>
