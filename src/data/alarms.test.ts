import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAndComputeAlarms, loadStoredAlarmsState, parseAlarmsCsv } from './alarms';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('parseAlarmsCsv', () => {
  test('computes exact zone last-alarm timestamps and skips header', () => {
    const csv = [
      'time,cities,threat,id,description,origin',
      '2026-03-05 12:00:00,אזור בדיקה 1,0,1,"desc",X',
      '2026-03-05 12:05:00,אזור בדיקה 1,0,2,"desc",X',
      '2026-03-05 12:03:00,אזור בדיקה 2,0,3,"desc",X',
    ].join('\n');

    const parsed = parseAlarmsCsv(csv);
    expect(parsed.rowsParsed).toBe(3);
    expect(parsed.newestAlarmAt).toBeTruthy();
    expect(Object.keys(parsed.zoneLastAlarm).sort()).toEqual(['אזור בדיקה 1', 'אזור בדיקה 2']);
    expect(parsed.zoneLastAlarm['אזור בדיקה 1']).toContain('2026-03-05T12:05:00');
    expect(parsed.zoneLastAlarm['אזור בדיקה 2']).toContain('2026-03-05T12:03:00');
  });

  test('handles quoted newlines', () => {
    const csv = [
      'time,cities,threat,id,description,origin',
      '2026-03-05 12:00:00,אזור בדיקה 1,0,1,"שורה 1\nשורה 2",X',
    ].join('\n');

    const parsed = parseAlarmsCsv(csv);
    expect(parsed.rowsParsed).toBe(1);
    expect(parsed.zoneLastAlarm['אזור בדיקה 1']).toContain('2026-03-05T12:00:00');
  });
});

describe('fetchAndComputeAlarms', () => {
  test('falls back to full fetch if range fetch fails', async () => {
    const calls: Array<{ url: string; range?: string }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input);
        const headers = init?.headers as Record<string, string> | undefined;
        calls.push({ url, range: headers?.Range ?? headers?.range });

        if (headers?.Range) {
          return new Response('range not satisfiable', { status: 416 });
        }

        return new Response(['time,cities', '2026-03-05 12:00:00,אזור בדיקה 1'].join('\n'), {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }),
    );

    const state = await fetchAndComputeAlarms({
      url: 'https://example.test/alarms.csv',
      tailBytes: 10,
    });
    expect(state.source).toBe('remote-full');
    expect(calls.length).toBe(2);
    expect(calls[0]?.range).toBeTruthy();
    expect(calls[1]?.range).toBeFalsy();
  });

  test('falls back to fixtures if remote fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String(input);
        if (url === '/fixtures/alarms.fixture.csv') {
          return new Response(['time,cities', '2026-03-05 12:00:00,אזור בדיקה 1'].join('\n'), {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          });
        }
        return new Response('nope', { status: 500 });
      }),
    );

    const state = await fetchAndComputeAlarms({ url: 'https://example.test/alarms.csv' });
    expect(state.source).toBe('fixtures');
    expect(state.zoneLastAlarm['אזור בדיקה 1']).toBeTruthy();
    expect(loadStoredAlarmsState()?.source).toBe('fixtures');
  });
});
