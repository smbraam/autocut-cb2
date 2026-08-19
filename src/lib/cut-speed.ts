export const DEFAULT_CUT_FEED_RATE = 300;
export const MIN_CUT_FEED_RATE = 60;
export const MAX_CUT_FEED_RATE = 1500;

export function clampCutFeedRate(value: number, fallback = DEFAULT_CUT_FEED_RATE) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(MAX_CUT_FEED_RATE, Math.max(MIN_CUT_FEED_RATE, numeric)));
}
