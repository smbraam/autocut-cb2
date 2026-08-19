import { browser } from '$app/environment';
import { writable } from 'svelte/store';

type Axis = 'X' | 'Y' | 'Z';

type AutoCutMachineState = {
  homedAxes: string;
  position: [number, number, number];
  updatedAt: number;
};

const STORAGE_KEY = 'autocut-machine-state';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const defaultState: AutoCutMachineState = {
  homedAxes: '',
  position: [0, 0, 0],
  updatedAt: 0
};

function normalizeAxes(value: unknown) {
  const raw = Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '';
  return Array.from(new Set(raw.toLowerCase().replace(/[^xyz]/g, '').split('')))
    .sort((a, b) => 'xyz'.indexOf(a) - 'xyz'.indexOf(b))
    .join('');
}

function normalizePosition(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const next = value.slice(0, 3).map((item) => Number(item));
  if (!next.every(Number.isFinite)) return null;
  return next as [number, number, number];
}

function loadState() {
  if (!browser) return defaultState;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;

    const parsed = JSON.parse(raw) as Partial<AutoCutMachineState>;
    const updatedAt = Number(parsed.updatedAt ?? 0);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > MAX_AGE_MS) return defaultState;

    return {
      homedAxes: normalizeAxes(parsed.homedAxes),
      position: normalizePosition(parsed.position) ?? defaultState.position,
      updatedAt
    };
  } catch {
    return defaultState;
  }
}

function persist(state: AutoCutMachineState) {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function samePosition(a: [number, number, number], b: [number, number, number]) {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.001);
}

function sameState(a: AutoCutMachineState, b: AutoCutMachineState) {
  return a.homedAxes === b.homedAxes && samePosition(a.position, b.position);
}

function createAutoCutMachineState() {
  const store = writable<AutoCutMachineState>(defaultState);

  return {
    subscribe: store.subscribe,
    load() {
      store.set(loadState());
    },
    clear() {
      store.set(defaultState);
      if (browser) localStorage.removeItem(STORAGE_KEY);
    },
    mergeKlipper(homedAxes: unknown, position: unknown) {
      const axes = normalizeAxes(homedAxes);
      const nextPosition = normalizePosition(position);

      store.update((current) => {
        if (!axes && !current.homedAxes) return current;

        const mergedAxes = normalizeAxes(`${current.homedAxes}${axes}`);
        const merged: AutoCutMachineState = {
          homedAxes: mergedAxes,
          position: nextPosition ?? current.position,
          updatedAt: Date.now()
        };

        if (sameState(current, merged)) return current;

        persist(merged);
        return merged;
      });
    },
    markAxisHomed(axis: Axis, position: [number, number, number]) {
      store.update((current) => {
        const merged: AutoCutMachineState = {
          homedAxes: normalizeAxes(`${current.homedAxes}${axis}`),
          position,
          updatedAt: Date.now()
        };

        if (sameState(current, merged)) return current;

        persist(merged);
        return merged;
      });
    },
    setPosition(position: [number, number, number]) {
      store.update((current) => {
        const merged: AutoCutMachineState = {
          ...current,
          position,
          updatedAt: Date.now()
        };

        if (sameState(current, merged)) return current;

        persist(merged);
        return merged;
      });
    }
  };
}

export const autocutMachineState = createAutoCutMachineState();
