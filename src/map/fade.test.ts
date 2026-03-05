import { describe, expect, test } from 'vitest'
import { clamp01, computeFadeOpacity, computeMinutesSince } from './fade'

describe('clamp01', () => {
  test('clamps below 0', () => {
    expect(clamp01(-1)).toBe(0)
  })

  test('clamps above 1', () => {
    expect(clamp01(2)).toBe(1)
  })

  test('keeps values inside range', () => {
    expect(clamp01(0.4)).toBe(0.4)
  })
})

describe('computeFadeOpacity', () => {
  test('is 1 at alarm time', () => {
    expect(
      computeFadeOpacity({ nowMs: 1_000, alarmAtMs: 1_000, fadeMinutes: 60 }),
    ).toBe(1)
  })

  test('linearly fades to 0 at fade duration', () => {
    expect(
      computeFadeOpacity({ nowMs: 3_600_000, alarmAtMs: 0, fadeMinutes: 60 }),
    ).toBe(0)
  })

  test('never goes below 0', () => {
    expect(
      computeFadeOpacity({ nowMs: 9_999_999, alarmAtMs: 0, fadeMinutes: 1 }),
    ).toBe(0)
  })
})

describe('computeMinutesSince', () => {
  test('returns whole minutes since alarm', () => {
    expect(computeMinutesSince({ nowMs: 120_000, alarmAtMs: 0 })).toBe(2)
    expect(computeMinutesSince({ nowMs: 179_999, alarmAtMs: 0 })).toBe(2)
  })

  test('never returns negative minutes', () => {
    expect(computeMinutesSince({ nowMs: 0, alarmAtMs: 10_000 })).toBe(0)
  })
})

