export type OrefRealtimeAlertsPayload = {
  data?: unknown;
  title?: unknown;
  cat?: unknown;
  alertDate?: unknown;
};

export type OrefRealtimeAlerts = {
  title: string | null;
  areas: string[];
  alertDateIso: string | null;
};

function parseAreas(value: unknown): string[] {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      const name = String(item ?? '').trim();
      if (name) out.push(name);
    }
    return out;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function parseIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

import { appConfig } from '../config';

export async function fetchOrefRealtimeAlerts(
  url: string,
  init?: RequestInit,
): Promise<OrefRealtimeAlerts> {
  const cacheBuster = `cb=${Date.now()}`;
  const urlWithCb = url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;
  let fetchUrl = urlWithCb;
  if (appConfig.realtimeAlertsProxyUrl) {
    fetchUrl = `${appConfig.realtimeAlertsProxyUrl}${encodeURIComponent(urlWithCb)}`;
  }
  console.log('[realtime] Fetching:', fetchUrl);
  const response = await fetch(urlWithCb, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  console.log('[realtime] Response status:', response.status, response.statusText);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = (await response.json()) as OrefRealtimeAlertsPayload;
  console.log('[realtime] Raw JSON:', JSON.stringify(json));
  const title = typeof json.title === 'string' ? json.title.trim() || null : null;
  const areas = parseAreas(json.data);
  const alertDateIso = parseIso(json.alertDate);
  console.log('[realtime] Parsed:', { title, areas, alertDateIso });

  return { title, areas, alertDateIso };
}
