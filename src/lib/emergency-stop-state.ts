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

function createEmergencyStopStore() {
  const store = writable<EmergencyStopState>(defaultState);
  let loaded = false;

  function load() {
    if (!browser || loaded) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        store.set(sanitizeState(JSON.parse(raw)));
      }
    } catch {
      store.set(defaultState);
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
      store.set(defaultState);
    }
  };
}

export const emergencyStopState = createEmergencyStopStore();