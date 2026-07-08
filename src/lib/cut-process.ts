import { DEFAULT_CUT_FEED_RATE, MAX_CUT_FEED_RATE, MIN_CUT_FEED_RATE } from './cut-speed';
import { DEFAULT_CUT_HEIGHT, MAX_CUT_HEIGHT, MIN_CUT_HEIGHT } from './cut-height';

export type CutProcessSettings = {
  straightFeedRate: number;
  curveFeedRate: number;
  cutHeight: number;
  contactOffset: number;
  contactDownSpeed: number;
  contactLiftSpeed: number;
  torchLeadTime: number;
  contactSettleTime: number;
  pierceDelay: number;
  finishLiftHeight: number;
  finishLiftSpeed: number;
};

export const CUT_PROCESS_LIMITS = {
  straightFeedRate: { min: MIN_CUT_FEED_RATE, max: MAX_CUT_FEED_RATE },
  curveFeedRate: { min: MIN_CUT_FEED_RATE, max: MAX_CUT_FEED_RATE },
  cutHeight: { min: MIN_CUT_HEIGHT, max: MAX_CUT_HEIGHT },
  contactOffset: { min: 0, max: 10 },
  contactDownSpeed: { min: 10, max: 2000 },
  contactLiftSpeed: { min: 10, max: 3000 },
  torchLeadTime: { min: 0, max: 10 },
  contactSettleTime: { min: 0, max: 5 },
  pierceDelay: { min: 0, max: 10 },
  finishLiftHeight: { min: 0, max: 50 },
  finishLiftSpeed: { min: 10, max: 3000 }
} satisfies Record<keyof CutProcessSettings, { min: number; max: number }>;

export const defaultCutProcessSettings: CutProcessSettings = {
  straightFeedRate: DEFAULT_CUT_FEED_RATE,
  curveFeedRate: Math.max(MIN_CUT_FEED_RATE, Math.round(DEFAULT_CUT_FEED_RATE * 0.8)),
  cutHeight: DEFAULT_CUT_HEIGHT,
  contactOffset: 0,
  contactDownSpeed: 300,
  contactLiftSpeed: 600,
  torchLeadTime: 0.1,
  contactSettleTime: 0.1,
  pierceDelay: 0.5,
  finishLiftHeight: 10,
  finishLiftSpeed: 600
};

function clampNumber(value: unknown, fallback: number, min: number, max: number, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, numeric)) * factor) / factor;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

export function sanitizeCutProcessSettings(raw: Partial<CutProcessSettings> | null | undefined): CutProcessSettings {
  return {
    straightFeedRate: clampInteger(
      raw?.straightFeedRate,
      defaultCutProcessSettings.straightFeedRate,
      CUT_PROCESS_LIMITS.straightFeedRate.min,
      CUT_PROCESS_LIMITS.straightFeedRate.max
    ),
    curveFeedRate: clampInteger(
      raw?.curveFeedRate,
      defaultCutProcessSettings.curveFeedRate,
      CUT_PROCESS_LIMITS.curveFeedRate.min,
      CUT_PROCESS_LIMITS.curveFeedRate.max
    ),
    cutHeight: clampNumber(
      raw?.cutHeight,
      defaultCutProcessSettings.cutHeight,
      CUT_PROCESS_LIMITS.cutHeight.min,
      CUT_PROCESS_LIMITS.cutHeight.max,
      2
    ),
    contactOffset: clampNumber(
      raw?.contactOffset ?? (raw as Partial<CutProcessSettings> & { contactDownDistance?: number } | null | undefined)?.contactDownDistance,
      defaultCutProcessSettings.contactOffset,
      CUT_PROCESS_LIMITS.contactOffset.min,
      CUT_PROCESS_LIMITS.contactOffset.max,
      2
    ),
    contactDownSpeed: clampInteger(
      raw?.contactDownSpeed,
      defaultCutProcessSettings.contactDownSpeed,
      CUT_PROCESS_LIMITS.contactDownSpeed.min,
      CUT_PROCESS_LIMITS.contactDownSpeed.max
    ),
    contactLiftSpeed: clampInteger(
      raw?.contactLiftSpeed,
      defaultCutProcessSettings.contactLiftSpeed,
      CUT_PROCESS_LIMITS.contactLiftSpeed.min,
      CUT_PROCESS_LIMITS.contactLiftSpeed.max
    ),
    torchLeadTime: clampNumber(
      raw?.torchLeadTime,
      defaultCutProcessSettings.torchLeadTime,
      CUT_PROCESS_LIMITS.torchLeadTime.min,
      CUT_PROCESS_LIMITS.torchLeadTime.max,
      2
    ),
    contactSettleTime: clampNumber(
      raw?.contactSettleTime,
      defaultCutProcessSettings.contactSettleTime,
      CUT_PROCESS_LIMITS.contactSettleTime.min,
      CUT_PROCESS_LIMITS.contactSettleTime.max,
      2
    ),
    pierceDelay: clampNumber(
      raw?.pierceDelay,
      defaultCutProcessSettings.pierceDelay,
      CUT_PROCESS_LIMITS.pierceDelay.min,
      CUT_PROCESS_LIMITS.pierceDelay.max,
      2
    ),
    finishLiftHeight: clampNumber(
      raw?.finishLiftHeight,
      defaultCutProcessSettings.finishLiftHeight,
      CUT_PROCESS_LIMITS.finishLiftHeight.min,
      CUT_PROCESS_LIMITS.finishLiftHeight.max,
      2
    ),
    finishLiftSpeed: clampInteger(
      raw?.finishLiftSpeed,
      defaultCutProcessSettings.finishLiftSpeed,
      CUT_PROCESS_LIMITS.finishLiftSpeed.min,
      CUT_PROCESS_LIMITS.finishLiftSpeed.max
    )
  };
}
