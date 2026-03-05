export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function computeFadeOpacity(options: {
  nowMs: number;
  alarmAtMs: number;
  fadeMinutes: number;
}): number {
  const fadeMs = Math.max(1, options.fadeMinutes) * 60_000;
  const deltaMs = Math.max(0, options.nowMs - options.alarmAtMs);
  const ratio = 1 - deltaMs / fadeMs;
  return clamp01(ratio);
}

export function computeMinutesSince(options: { nowMs: number; alarmAtMs: number }): number {
  const deltaMs = Math.max(0, options.nowMs - options.alarmAtMs);
  return Math.floor(deltaMs / 60_000);
}
