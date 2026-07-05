export const DEFAULT_CUT_HEIGHT = 2.0;
export const MIN_CUT_HEIGHT = 0.5;
export const MAX_CUT_HEIGHT = 10.0;
export const DEFAULT_PIERCE_DELAY = 0.5;
export const DEFAULT_APPROACH_SPEED = 10;

export function clampCutHeight(value: number, fallback = DEFAULT_CUT_HEIGHT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_CUT_HEIGHT, Math.max(MIN_CUT_HEIGHT, numeric));
}
