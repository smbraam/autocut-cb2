import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type UiSettings = {
  developerMode: boolean;
  autoScroll: boolean;
  manualStepX: number;
  manualStepY: number;
  manualStepZ: number;
  manualJogSpeedXY: number;
  manualJogSpeedZ: number;
  showInstructions: boolean;
  travelHeightMm: number;
  endstopReleaseDelayMs: number;
  language: 'nl' | 'en';
};

export const defaultUiSettings: UiSettings = {
  developerMode: true,
  autoScroll: true,
  manualStepX: 10,
  manualStepY: 10,
  manualStepZ: 5,
  manualJogSpeedXY: 5,
  manualJogSpeedZ: 2,
  showInstructions: true,
  travelHeightMm: 10,
  endstopReleaseDelayMs: 500,
  language: 'nl'
};

const STORAGE_KEY = 'autocut-ui-settings';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSettings(raw: Partial<UiSettings> | null | undefined): UiSettings {
  const legacy = raw as (Partial<UiSettings> & { showSafetyWarning?: boolean }) | null | undefined;

  return {
    developerMode: typeof raw?.developerMode === 'boolean' ? raw.developerMode : defaultUiSettings.developerMode,
    manualStepX: clamp(Number(raw?.manualStepX ?? defaultUiSettings.manualStepX) || defaultUiSettings.manualStepX, 1, 100),
    manualStepY: clamp(Number(raw?.manualStepY ?? defaultUiSettings.manualStepY) || defaultUiSettings.manualStepY, 1, 100),
    manualStepZ: clamp(Number(raw?.manualStepZ === 1 ? defaultUiSettings.manualStepZ : (raw?.manualStepZ ?? defaultUiSettings.manualStepZ)) || defaultUiSettings.manualStepZ, 0.1, 25),
    manualJogSpeedXY: clamp(Number(raw?.manualJogSpeedXY ?? defaultUiSettings.manualJogSpeedXY) || defaultUiSettings.manualJogSpeedXY, 0.5, 25),
    manualJogSpeedZ: clamp(Number(raw?.manualJogSpeedZ ?? defaultUiSettings.manualJogSpeedZ) || defaultUiSettings.manualJogSpeedZ, 0.5, 10),
    autoScroll: typeof raw?.autoScroll === 'boolean' ? raw.autoScroll : defaultUiSettings.autoScroll,
    travelHeightMm: clamp(Number(raw?.travelHeightMm ?? defaultUiSettings.travelHeightMm) || defaultUiSettings.travelHeightMm, 0.1, 100),
    endstopReleaseDelayMs: clamp(Number.isFinite(Number(raw?.endstopReleaseDelayMs)) ? Number(raw?.endstopReleaseDelayMs) : defaultUiSettings.endstopReleaseDelayMs, 0, 10000),
    showInstructions: typeof raw?.showInstructions === 'boolean' ? raw.showInstructions : (typeof legacy?.showSafetyWarning === 'boolean' ? legacy.showSafetyWarning : defaultUiSettings.showInstructions),
    language: raw?.language === 'en' ? 'en' : 'nl'
  };
}

function createUiSettingsStore() {
  const store = writable<UiSettings>(defaultUiSettings);
  let loaded = false;

  function load() {
    if (!browser || loaded) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        store.set(sanitizeSettings(JSON.parse(raw)));
      }
    } catch {
      store.set(defaultUiSettings);
    }

    loaded = true;
  }

  store.subscribe((value) => {
    if (!browser || !loaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  });

  return {
    subscribe: store.subscribe,
    load,
    reset() {
      loaded = true;
      store.set(defaultUiSettings);
    },
    patch(patch: Partial<UiSettings>) {
      loaded = true;
      store.update((current) => sanitizeSettings({ ...current, ...patch }));
    }
  };
}

export const uiSettings = createUiSettingsStore();