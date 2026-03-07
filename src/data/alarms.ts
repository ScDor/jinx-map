import Papa from 'papaparse';
import { parse, parseISO } from 'date-fns';
import { mapCsvZoneToPolygonName } from './zoneNameMapping';

export type AlarmsComputedStateV1 = {
  version: 1;
  computedAt: string;
  source: 'remote-range' | 'remote-full' | 'fixtures';
  newestAlarmAt?: string;
  rowsParsed: number;
  zoneLastAlarm: Record<string, string>;
};

const ALARMS_STATE_KEY = 'jinx.alarmsState.v1';

type FetchAlarmsCsvOptions = {
  url: string;
  tailBytes?: number;
  fixturesPath?: string;
};

export function loadStoredAlarmsState(): AlarmsComputedStateV1 | null {
  try {
    const raw = localStorage.getItem(ALARMS_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlarmsComputedStateV1>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.computedAt !== 'string') return null;
    if (!parsed.zoneLastAlarm || typeof parsed.zoneLastAlarm !== 'object') return null;
    if (typeof parsed.rowsParsed !== 'number' || !Number.isFinite(parsed.rowsParsed)) return null;
    if (
      parsed.source !== 'remote-range' &&
      parsed.source !== 'remote-full' &&
      parsed.source !== 'fixtures'
    ) {
      return null;
    }
    return {
      version: 1,
      computedAt: parsed.computedAt,
      source: parsed.source,
      newestAlarmAt: typeof parsed.newestAlarmAt === 'string' ? parsed.newestAlarmAt : undefined,
      rowsParsed: parsed.rowsParsed,
      zoneLastAlarm: parsed.zoneLastAlarm as Record<string, string>,
    };
  } catch {
    return null;
  }
}

export function storeAlarmsState(state: AlarmsComputedStateV1): void {
  try {
    localStorage.setItem(ALARMS_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function parseAlarmTimestamp(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const iso = parseISO(trimmed);
    if (Number.isFinite(iso.getTime())) return iso;
  } catch {
    // ignore
  }

  const candidateFormats = ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm'];
  for (const fmt of candidateFormats) {
    try {
      const value = parse(trimmed, fmt, new Date());
      if (Number.isFinite(value.getTime())) return value;
    } catch {
      // ignore
    }
  }

  const asDate = new Date(trimmed);
  if (Number.isFinite(asDate.getTime())) return asDate;

  return null;
}

export function parseAlarmsCsv(
  csvText: string,
): Pick<AlarmsComputedStateV1, 'newestAlarmAt' | 'rowsParsed' | 'zoneLastAlarm'> {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: 'greedy',
  });

  const zoneLast = new Map<string, Date>();
  let newest: Date | null = null;
  let rowsParsed = 0;

  for (const row of result.data) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const timeRaw = String(row[0] ?? '').trim();
    const citiesRaw = mapCsvZoneToPolygonName(String(row[1] ?? ''));
    if (!timeRaw || !citiesRaw) continue;

    if (timeRaw.toLowerCase() === 'time' && citiesRaw.toLowerCase() === 'cities') continue;

    const timestamp = parseAlarmTimestamp(timeRaw);
    if (!timestamp) continue;

    rowsParsed += 1;

    const existing = zoneLast.get(citiesRaw);
    if (!existing || existing.getTime() < timestamp.getTime()) {
      zoneLast.set(citiesRaw, timestamp);
    }
    if (!newest || newest.getTime() < timestamp.getTime()) {
      newest = timestamp;
    }
  }

  const zoneLastAlarm: Record<string, string> = {};
  for (const [zoneName, timestamp] of zoneLast.entries()) {
    zoneLastAlarm[zoneName] = timestamp.toISOString();
  }

  return {
    newestAlarmAt: newest ? newest.toISOString() : undefined,
    rowsParsed,
    zoneLastAlarm,
  };
}

function dropLeadingPartialLine(csvText: string): string {
  const firstNewline = csvText.indexOf('\n');
  if (firstNewline === -1) return csvText;
  return csvText.slice(firstNewline + 1);
}

async function fetchCsvText(pathOrUrl: string, init?: RequestInit): Promise<string> {
  console.log('[alarms] Fetching:', pathOrUrl);
  const response = await fetch(pathOrUrl, { cache: 'no-store', ...init });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathOrUrl}`);
  }
  return response.text();
}

export async function fetchAndComputeAlarms(
  options: FetchAlarmsCsvOptions,
): Promise<AlarmsComputedStateV1> {
  const tailBytes = options.tailBytes ?? 512_000;
  const fixturesPath =
    options.fixturesPath ?? `${import.meta.env.BASE_URL}fixtures/alarms.fixture.csv`;

  const computedAt = new Date().toISOString();

  try {
    const rangeText = await fetchCsvText(options.url, {
      headers: { Range: `bytes=-${tailBytes}` },
    });
    const parsed = parseAlarmsCsv(dropLeadingPartialLine(rangeText));
    const state: AlarmsComputedStateV1 = {
      version: 1,
      computedAt,
      source: 'remote-range',
      ...parsed,
    };
    storeAlarmsState(state);
    return state;
  } catch {
    // fall through
  }

  try {
    const fullText = await fetchCsvText(options.url);
    const parsed = parseAlarmsCsv(fullText);
    const state: AlarmsComputedStateV1 = {
      version: 1,
      computedAt,
      source: 'remote-full',
      ...parsed,
    };
    storeAlarmsState(state);
    return state;
  } catch {
    // fall through
  }

  console.log('[alarms] Falling back to fixtures');
  const fixtureText = await fetchCsvText(fixturesPath);
  const parsed = parseAlarmsCsv(fixtureText);
  const state: AlarmsComputedStateV1 = {
    version: 1,
    computedAt,
    source: 'fixtures',
    ...parsed,
  };
  storeAlarmsState(state);
  return state;
}
