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

const TZAVAADOM_WS_URL = 'wss://ws.tzevaadom.co.il/socket?platform=WEB';
const ORIGIN_HEADER = 'https://www.tzevaadom.co.il';

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

interface TzevaAdomMessage {
  type: 'ALERT' | 'SYSTEM_MESSAGE';
  data: {
    notificationId: number;
    threat: number;
    cities: string[];
    time: number;
    isDrill?: boolean;
    citiesIds?: number[];
    instructionType?: number;
  };
}

const THREAT_TITLES: Record<number, string> = {
  0: 'ירי רקטות וטילים',
  1: 'אירוע חומרים מסוכנים',
  2: 'חדירת מחבלים',
  3: 'רעידת אדמה',
  4: 'חשש לצונאמי',
  5: 'חדירת כלי טיס עוין',
  6: 'חשש לאירוע רדיוגני',
  7: 'חשש לאירוע כימי',
  8: 'התרעות פיקוד העורף',
};

const PRE_ALERT_CATEGORY = 14;
const END_ALERT_CATEGORY = 13;

const threatIdToCategory: Record<number, number> = {
  0: 1,
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 1,
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

type RealtimeListener = (alerts: OrefRealtimeAlerts) => void;

let ws: WebSocket | null = null;
let wsListeners: Set<RealtimeListener> = new Set();
let wsConnected = false;
let wsLastAlerts: OrefRealtimeAlerts = { title: null, areas: [], alertDateIso: null };
let wsReconnectTimeout: number | null = null;

function parseTzevaAdomMessage(msg: TzevaAdomMessage): OrefRealtimeAlerts | null {
  try {
    if (msg.type === 'ALERT') {
      if (msg.data.isDrill) return null;
      const category = threatIdToCategory[msg.data.threat];
      if (!category) return null;
      return {
        title: THREAT_TITLES[msg.data.threat] || null,
        areas: msg.data.cities,
        alertDateIso: new Date(msg.data.time * 1000).toISOString(),
      };
    }
    if (msg.type === 'SYSTEM_MESSAGE') {
      const { instructionType, citiesIds } = msg.data;
      if (!citiesIds || citiesIds.length === 0) return null;
      if (instructionType === 0) {
        return {
          title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך',
          areas: citiesIds.map(String),
          alertDateIso: new Date(msg.data.time * 1000).toISOString(),
        };
      }
      if (instructionType === 1) {
        return {
          title: 'הארוע הסתיים',
          areas: [],
          alertDateIso: new Date(msg.data.time * 1000).toISOString(),
        };
      }
    }
  } catch (e) {
    console.warn('[realtime] Failed to parse tzevaadom message:', e);
  }
  return null;
}

function connectWs() {
  if (ws) return;
  console.log('[realtime] Connecting to tzevaadom WebSocket...');
  try {
    ws = new WebSocket(TZAVAADOM_WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[realtime] tzevaadom WebSocket connected');
      wsConnected = true;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as TzevaAdomMessage;
        const alerts = parseTzevaAdomMessage(msg);
        if (alerts) {
          console.log('[realtime] tzevaadom alert:', alerts);
          wsLastAlerts = alerts;
          wsListeners.forEach((listener) => listener(alerts));
        }
      } catch (e) {
        console.warn('[realtime] Failed to parse tzevaadom message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[realtime] tzevaadom WebSocket closed');
      ws = null;
      wsConnected = false;
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error('[realtime] tzevaadom WebSocket error:', e);
    };
  } catch (e) {
    console.error('[realtime] Failed to create WebSocket:', e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimeout) return;
  wsReconnectTimeout = window.setTimeout(() => {
    wsReconnectTimeout = null;
    connectWs();
  }, 5000);
}

export function startRealtimeWebSocket(listener: RealtimeListener): () => void {
  wsListeners.add(listener);
  if (!ws) {
    connectWs();
  } else if (wsLastAlerts.areas.length > 0 || wsLastAlerts.title) {
    listener(wsLastAlerts);
  }
  return () => {
    wsListeners.delete(listener);
    if (wsListeners.size === 0 && ws) {
      ws.close();
      ws = null;
    }
  };
}

export function getRealtimeStatus(): { connected: boolean } {
  return { connected: wsConnected };
}

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
