<script lang="ts">
  import { page } from '$app/stores';

  type NavItem = { href: string; label: string; icon: 'home' | 'manual' | 'shape' | 'dxf' | 'settings' };

  const nav: NavItem[] = [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/manual', label: 'Handbediening', icon: 'manual' },
    { href: '/shape', label: 'Vorm snijden', icon: 'shape' },
    { href: '/dxf', label: 'DXF snijden', icon: 'dxf' },
    { href: '/settings', label: 'Instellingen', icon: 'settings' }
  ];

  function isActive(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }
</script>

<style>
  :global(:root) {
    color-scheme: dark;
    --bg-body: #070b12;
    --bg-surface: #0c121d;
    --bg-surface-alt: #101828;
    --border-color: #1a2332;
    --border-color-strong: #243247;
    --accent: #6aa7ff;
    --accent-strong: #3c66c2;
    --text-strong: #e5e9f0;
    --text-medium: #bac7dd;
    --text-muted: #8895af;
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --space-1: 4px;
    --space-2: 6px;
    --space-3: 10px;
    --space-4: 14px;
    --space-5: 18px;
    --space-6: 24px;
    --space-7: 32px;
    --font-size-xs: 12px;
    --font-size-sm: 13px;
    --font-size-md: clamp(14px, 1.8vw, 15.5px);
    --font-size-lg: clamp(15px, 2vw, 17px);
    --font-size-xl: clamp(17px, 3vw, 20px);
  }

  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg-body);
    color: var(--text-strong);
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: var(--font-size-md);
    line-height: 1.45;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .layout {
    display: grid;
    grid-template-columns: 56px 1fr;
    height: 100dvh;
    background: var(--bg-body);
  }

  .sidebar {
    background: var(--bg-surface);
    border-right: 1px solid var(--border-color);
    padding: var(--space-4) var(--space-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }


  .nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    align-items: center;
  }

  a.item {
    width: 42px;
    height: 42px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    text-decoration: none;
    color: var(--text-medium);
    border: 1px solid transparent;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    background: transparent;
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  }

  a.item:hover {
    background: rgba(106, 167, 255, 0.08);
    border-color: rgba(106, 167, 255, 0.18);
    color: var(--text-strong);
  }

  a.item.active {
    background: rgba(60, 102, 194, 0.2);
    border-color: rgba(106, 167, 255, 0.4);
    color: var(--text-strong);
    box-shadow: 0 0 0 1px rgba(106, 167, 255, 0.25) inset;
  }

  a.item:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .icon {
    width: 18px;
    height: 18px;
    display: block;
  }

  .stroke {
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .fillSoft {
    fill: rgba(255, 255, 255, 0.04);
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .main {
    overflow: hidden;
    display: grid;
    grid-template-rows: 1fr;
  }

  .content {
    overflow: auto;
    padding: var(--space-5);
    width: min(100%, 760px);
    margin: 0 auto;
    -webkit-overflow-scrolling: touch;
  }

  :global(.pageShell) {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-bottom: var(--space-6);
  }

  :global(.surfaceCard) {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  }

  :global(.surfaceCard.tight) {
    padding: var(--space-3);
    border-radius: var(--radius-md);
  }

  :global(.sectionTitle) {
    font-size: var(--font-size-xl);
    font-weight: 800;
    margin: 0 0 var(--space-2);
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
    padding: var(--space-2) var(--space-3);
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface-alt);
    font-size: var(--font-size-xs);
    font-weight: 700;
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
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid #7a1f1f;
    background: #1b0d10;
    color: #ffb5b5;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    max-height: 150px;
    overflow: auto;
  }

  :global(button) {
    background: var(--bg-surface-alt);
    color: var(--text-strong);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 14px;
    font-weight: 700;
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
    min-height: 38px;
  }

  :global(button:hover) {
    background: rgba(106, 167, 255, 0.12);
    border-color: rgba(106, 167, 255, 0.3);
  }

  :global(button:active) {
    transform: translateY(1px);
  }

  :global(button:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  :global(button.primary) {
    background: rgba(106, 167, 255, 0.2);
    border-color: rgba(106, 167, 255, 0.4);
  }

  :global(button.primary:hover) {
    background: rgba(106, 167, 255, 0.28);
  }

  :global(button.secondary) {
    background: var(--bg-surface);
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

  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 52px 1fr;
    }

    .content {
      padding: var(--space-4);
      width: min(100%, 620px);
    }

    :global(.surfaceCard) {
      padding: var(--space-3);
    }

    :global(.sectionTitle) {
      font-size: clamp(16px, 4.2vw, 18px);
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
              <rect class="stroke" x="6" y="16.5" width="12" height="4.5" rx="1.4" />
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
    </nav>
  </aside>

  <section class="main">
    <main class="content">
      <slot />
    </main>
  </section>
</div>
