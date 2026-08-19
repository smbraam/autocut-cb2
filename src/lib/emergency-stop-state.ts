import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export const EMERGENCY_STOP_MESSAGE =
  'Noodstop uitgevoerd. Ga naar Home en voer Firmware restart uit om verder te gaan.';

export type EmergencyStopState = {
  active: boolean;
  message: string;
  activatedAt: number | null;
};

const STORAGE_KEY = 'autocut-ui-emergency-stop';

const defaultState: EmergencyStopState = {
  active: false,
  message: '',
  activatedAt: null
};

function sanitizeState(raw: Partial<EmergencyStopState> | null | undefined): EmergencyStopState {
  return {
    active: Boolean(raw?.active),
    message: typeof raw?.message === 'string' ? raw.message : '',
    activatedAt: typeof raw?.activatedAt === 'number' ? raw.activatedAt : null
  };
}

function sameState(a: EmergencyStopState, b: EmergencyStopState) {
  return a.active === b.active && a.message === b.message && a.activatedAt === b.activatedAt;
}

function createEmergencyStopStore() {
  const store = writable<EmergencyStopState>(defaultState);
  let loaded = false;
  let current = defaultState;
  let lastPersisted = '';

  function load() {
    if (!browser || loaded) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const next = sanitizeState(JSON.parse(raw));
        current = next;
        lastPersisted = JSON.stringify(next);
        store.set(next);
      }
    } catch {
      store.set(defaultState);
    }

    loaded = true;
  }

  store.subscribe((value) => {
    current = value;
    if (!browser || !loaded) return;

    const serialized = JSON.stringify(value);
    if (serialized === lastPersisted) return;

    localStorage.setItem(STORAGE_KEY, serialized);
    lastPersisted = serialized;
  });

  return {
    subscribe: store.subscribe,
    load,
    activate(message = EMERGENCY_STOP_MESSAGE) {
      loaded = true;
      store.set({
        active: true,
        message,
        activatedAt: Date.now()
      });
    },
    clear() {
      loaded = true;
      if (sameState(current, defaultState)) return;
      store.set(defaultState);
    }
  };
}

export const emergencyStopState = createEmergencyStopStore();