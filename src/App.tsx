import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './App.css';
import { appConfig } from './config';
import type { AlarmsComputedStateV1 } from './data/alarms';
import { fetchAndComputeAlarms, loadStoredAlarmsState } from './data/alarms';
import { fetchOrefRealtimeAlerts } from './data/realtime';
import type { NormalizedPolygon, PolygonsLoadSource } from './data/polygons';
import { loadPolygons } from './data/polygons';
import { MapContainer, Polygon as LeafletPolygon, Popup, TileLayer, Tooltip } from 'react-leaflet';
import type {
  LatLngBoundsExpression,
  LatLngExpression,
  Map as LeafletMap,
  Polygon as LeafletPolygonLayer,
} from 'leaflet';
import { computeFadeOpacity, computeMinutesSince } from './map/fade';

const FADE_MINUTES_KEY = 'jinx.fadeMinutes';
const DEFAULT_FADE_MINUTES = 60;
const BASEMAP_KEY = 'jinx.basemap';
const DEFAULT_BASEMAP = 'cartodb-positron';

interface BasemapOption {
  id: string;
  label: string;
  url: string;
  attribution: string;
}

const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'cartodb-positron',
    label: 'CartoDB Positron (בהיר)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: 'cartodb-dark',
    label: 'CartoDB Dark (כהה)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: 'openstreetmap',
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];
const MAP_TICK_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_RESULTS_LIMIT = 7;
const RECENT_ZONES_LIMIT = 14;
const REALTIME_BACKOFF_BASE_MS = 800;
const REALTIME_BACKOFF_MAX_MS = 60_000;
const REALTIME_HISTORY_REPLACED_SKEW_MS = 60_000;

function normalizeZoneKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFKC');
}

function computeEffectiveAlarmAtMs(
  csvAtMs: number | null,
  realtimeAtMs: number | null,
): number | null {
  if (csvAtMs === null && realtimeAtMs === null) return null;
  if (csvAtMs === null) return realtimeAtMs;
  if (realtimeAtMs === null) return csvAtMs;
  if (csvAtMs >= realtimeAtMs - REALTIME_HISTORY_REPLACED_SKEW_MS) return csvAtMs;
  return Math.max(csvAtMs, realtimeAtMs);
}

function readStoredInt(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredInt(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function readStoredBasemap(): string {
  try {
    const raw = localStorage.getItem(BASEMAP_KEY);
    if (!raw) return DEFAULT_BASEMAP;
    const valid = BASEMAP_OPTIONS.find((b) => b.id === raw);
    return valid ? raw : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

function writeStoredBasemap(value: string): void {
  try {
    localStorage.setItem(BASEMAP_KEY, value);
  } catch {
    // ignore
  }
}

function formatLastUpdated(value: Date | null): string {
  if (!value) return 'לא עודכן עדיין';
  return value.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatAlarmTimestamp(value: Date): string {
  return value.toLocaleString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function computePolygonSizeKm(rings: LatLngExpression[] | LatLngExpression[][]): number {
  const coords: number[][] = [];
  const flatten = (arr: LatLngExpression[] | LatLngExpression[][]): void => {
    for (const item of arr) {
      if (Array.isArray(item) && typeof item[0] === 'number') {
        coords.push(item as number[]);
      } else if (Array.isArray(item)) {
        flatten(item as LatLngExpression[]);
      }
    }
  };
  flatten(rings);
  if (coords.length < 3) return 0;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    if (c[0] < minLat) minLat = c[0];
    if (c[0] > maxLat) maxLat = c[0];
    if (c[1] < minLng) minLng = c[1];
    if (c[1] > maxLng) maxLng = c[1];
  }
  const latKm = (maxLat - minLat) * 111;
  const lngKm = (maxLng - minLng) * 111 * Math.cos((minLat * Math.PI) / 180);
  return Math.max(latKm, lngKm);
}

function computePolygonsBounds(
  polygons: NormalizedPolygon[] | null,
): LatLngBoundsExpression | null {
  if (!polygons || polygons.length === 0) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const polygon of polygons) {
    const [pMinLat, pMinLng, pMaxLat, pMaxLng] = polygon.bounds;
    if (pMinLat < minLat) minLat = pMinLat;
    if (pMinLng < minLng) minLng = pMinLng;
    if (pMaxLat > maxLat) maxLat = pMaxLat;
    if (pMaxLng > maxLng) maxLng = pMaxLng;
  }

  if (![minLat, minLng, maxLat, maxLng].every((value) => Number.isFinite(value))) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

function readInitialAlarms(): { state: AlarmsComputedStateV1 | null; lastUpdatedAt: Date | null } {
  const stored = loadStoredAlarmsState();
  if (!stored?.computedAt) return { state: stored, lastUpdatedAt: null };
  const parsed = new Date(stored.computedAt);
  return {
    state: stored,
    lastUpdatedAt: Number.isFinite(parsed.getTime()) ? parsed : null,
  };
}

function App() {
  const fadeMinutesInputId = useId();
  const basemapSelectId = useId();
  const [initialAlarms] = useState(() => readInitialAlarms());
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isZonesOpen, setIsZonesOpen] = useState(false);
  const [fadeMinutes, setFadeMinutes] = useState(() =>
    readStoredInt(FADE_MINUTES_KEY, DEFAULT_FADE_MINUTES),
  );
  const [basemapId, setBasemapId] = useState(() => readStoredBasemap());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(initialAlarms.lastUpdatedAt);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [polygons, setPolygons] = useState<NormalizedPolygon[] | null>(null);
  const [polygonsSource, setPolygonsSource] = useState<PolygonsLoadSource | null>(null);
  const [isPolygonsLoading, setIsPolygonsLoading] = useState(true);
  const [isAlarmsLoading, setIsAlarmsLoading] = useState(false);
  const [alarmsState, setAlarmsState] = useState<AlarmsComputedStateV1 | null>(initialAlarms.state);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [realtimeMode, setRealtimeMode] = useState<
    'disabled' | 'connecting' | 'available' | 'unavailable'
  >(() => (appConfig.realtimeEnabled ? 'connecting' : 'disabled'));
  const [realtimeForcedActiveZones, setRealtimeForcedActiveZones] = useState<Set<string>>(
    () => new Set(),
  );
  const [realtimeLastAlarmByZoneMs, setRealtimeLastAlarmByZoneMs] = useState<
    Record<string, number>
  >(() => ({}));
  const isMountedRef = useRef(true);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polygonLayersByNameRef = useRef<Map<string, LeafletPolygonLayer>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const refreshAlarms = useCallback(async () => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    setIsAlarmsLoading(true);
    const promise = fetchAndComputeAlarms({ url: appConfig.alarmsCsvUrl })
      .then((computed) => {
        if (!isMountedRef.current) return;
        setAlarmsState(computed);
        const computedAt = new Date(computed.computedAt);
        if (Number.isFinite(computedAt.getTime())) setLastUpdatedAt(computedAt);
        setErrorMessage(null);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        setErrorMessage('שגיאה בעדכון האזעקות (ממשיכים עם הנתונים האחרונים).');
      })
      .finally(() => {
        refreshInFlightRef.current = null;
        if (!isMountedRef.current) return;
        setIsAlarmsLoading(false);
      });

    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    writeStoredInt(FADE_MINUTES_KEY, fadeMinutes);
  }, [fadeMinutes]);

  useEffect(() => {
    writeStoredBasemap(basemapId);
  }, [basemapId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadPolygons()
      .then(({ source, payload }) => {
        if (cancelled) return;
        setPolygons(payload.polygons);
        setPolygonsSource(source);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage('שגיאה בטעינת הפוליגונים (נסו לרענן).');
      })
      .finally(() => {
        if (cancelled) return;
        setIsPolygonsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshAlarms();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshAlarms();
    }, appConfig.apiPollSeconds * 1000);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshAlarms]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, MAP_TICK_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [searchText]);

  useEffect(() => {
    if (!appConfig.realtimeEnabled) return;

    let cancelled = false;
    let timeout: number | null = null;
    let consecutiveFailures = 0;
    let lastSignature: string | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timeout = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const computeBackoffMs = () => {
      const exponent = Math.max(0, consecutiveFailures - 1);
      const raw = REALTIME_BACKOFF_BASE_MS * 2 ** exponent;
      return Math.min(REALTIME_BACKOFF_MAX_MS, raw);
    };

    const poll = async () => {
      if (cancelled) return;
      setRealtimeMode((mode) => (mode === 'available' ? 'available' : 'connecting'));

      try {
        const payload = await fetchOrefRealtimeAlerts(appConfig.realtimeAlertsUrl);
        if (cancelled || !isMountedRef.current) return;

        consecutiveFailures = 0;
        setRealtimeMode('available');

        const areas = payload.areas;
        const signature = `${payload.alertDateIso ?? ''}|${payload.title ?? ''}|${areas.join(',')}`;
        if (signature === lastSignature) {
          schedule(appConfig.realtimePollSeconds * 1000);
          return;
        }

        lastSignature = signature;
        const alarmAtMs = Date.now();

        if (areas.length === 0) {
          setRealtimeForcedActiveZones(new Set());
          schedule(appConfig.realtimePollSeconds * 1000);
          return;
        }

        setRealtimeLastAlarmByZoneMs((current) => {
          const next = { ...current };
          for (const name of areas) {
            next[normalizeZoneKey(name)] = alarmAtMs;
          }
          return next;
        });
        setRealtimeForcedActiveZones(new Set(areas.map(normalizeZoneKey)));
        schedule(appConfig.realtimePollSeconds * 1000);
      } catch {
        if (cancelled || !isMountedRef.current) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= appConfig.realtimeMaxFailures) {
          setRealtimeMode('unavailable');
          setRealtimeForcedActiveZones(new Set());
          return;
        }
        schedule(computeBackoffMs());
      }
    };

    schedule(0);
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, []);

  const lastUpdatedLabel = useMemo(() => formatLastUpdated(lastUpdatedAt), [lastUpdatedAt]);
  const polygonsLabel = useMemo(() => {
    if (isPolygonsLoading) return 'טוען פוליגונים…';
    if (!polygons) return 'פוליגונים: לא נטענו';
    const sourceLabel = polygonsSource === 'polygons.json' ? 'מלא' : 'דוגמה';
    return `פוליגונים: ${polygons.length} (${sourceLabel})`;
  }, [isPolygonsLoading, polygons, polygonsSource]);

  const polygonsBounds = useMemo(() => computePolygonsBounds(polygons), [polygons]);
  const basemap = useMemo(
    () => BASEMAP_OPTIONS.find((b) => b.id === basemapId) ?? BASEMAP_OPTIONS[0],
    [basemapId],
  );
  const zoneLastAlarm = useMemo(() => alarmsState?.zoneLastAlarm ?? {}, [alarmsState]);
  const realtimeLabel = useMemo(() => {
    if (!appConfig.realtimeEnabled) return 'ריל־טיים: כבוי';
    if (realtimeMode === 'connecting') return 'מנסה ריל־טיים…';
    if (realtimeMode === 'unavailable') return 'ריל־טיים לא זמין, משתמשים ב־CSV';
    if (realtimeForcedActiveZones.size > 0) return 'ריל־טיים: פעיל';
    return 'ריל־טיים: זמין';
  }, [realtimeForcedActiveZones.size, realtimeMode]);
  const polygonsByName = useMemo(() => {
    const map = new Map<string, NormalizedPolygon>();
    for (const polygon of polygons ?? []) {
      map.set(normalizeZoneKey(polygon.name), polygon);
    }
    return map;
  }, [polygons]);

  const polygonSearchIndex = useMemo(() => {
    return (polygons ?? []).map((polygon) => ({
      name: polygon.name,
      key: polygon.name.normalize('NFKC'),
    }));
  }, [polygons]);

  const searchMatches = useMemo(() => {
    const query = debouncedSearchText.normalize('NFKC');
    if (!query) return [];
    const matches = polygonSearchIndex
      .map((entry) => ({ name: entry.name, index: entry.key.indexOf(query) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        return a.name.length - b.name.length;
      })
      .slice(0, SEARCH_RESULTS_LIMIT)
      .map((entry) => entry.name);
    return matches;
  }, [debouncedSearchText, polygonSearchIndex]);

  const normalizedZoneLastAlarm = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, iso] of Object.entries(zoneLastAlarm)) {
      map.set(normalizeZoneKey(name), iso);
    }
    return map;
  }, [zoneLastAlarm]);

  const normalizedRealtimeLastAlarmByZoneMs = useMemo(() => {
    const map = new Map<string, number>();
    for (const [name, alarmAtMs] of Object.entries(realtimeLastAlarmByZoneMs)) {
      if (typeof alarmAtMs !== 'number' || !Number.isFinite(alarmAtMs)) continue;
      map.set(normalizeZoneKey(name), alarmAtMs);
    }
    return map;
  }, [realtimeLastAlarmByZoneMs]);

  const effectiveZoneLastAlarmMs = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key] of polygonsByName.entries()) {
      const csvIso = normalizedZoneLastAlarm.get(key);
      const csvAtMs = csvIso ? new Date(csvIso).getTime() : null;
      const csvAtMsValid = csvAtMs !== null && Number.isFinite(csvAtMs) ? csvAtMs : null;
      const realtimeAtMs = normalizedRealtimeLastAlarmByZoneMs.get(key) ?? null;

      const effective = computeEffectiveAlarmAtMs(csvAtMsValid, realtimeAtMs);
      if (effective === null) continue;
      map.set(key, effective);
    }
    return map;
  }, [normalizedRealtimeLastAlarmByZoneMs, normalizedZoneLastAlarm, polygonsByName]);

  const recentZones = useMemo(() => {
    const entries: Array<{ name: string; alarmAt: Date; alarmAtMs: number; minutesSince: number }> =
      [];
    for (const [key, alarmAtMs] of effectiveZoneLastAlarmMs.entries()) {
      const polygon = polygonsByName.get(key);
      if (!polygon) continue;
      const alarmAt = new Date(alarmAtMs);
      entries.push({
        name: polygon.name,
        alarmAt,
        alarmAtMs,
        minutesSince: computeMinutesSince({ nowMs, alarmAtMs }),
      });
    }
    entries.sort((a, b) => b.alarmAtMs - a.alarmAtMs);
    return entries.slice(0, RECENT_ZONES_LIMIT);
  }, [effectiveZoneLastAlarmMs, nowMs, polygonsByName]);

  const focusZoneByName = useCallback(
    (name: string) => {
      const polygon = polygonsByName.get(normalizeZoneKey(name));
      if (!polygon) return;
      setSearchText(polygon.name);
      setIsZonesOpen(false);
      const [minLat, minLng, maxLat, maxLng] = polygon.bounds;
      mapRef.current?.fitBounds(
        [
          [minLat, minLng],
          [maxLat, maxLng],
        ],
        { padding: [32, 32], maxZoom: 13 },
      );
      window.setTimeout(() => {
        polygonLayersByNameRef.current.get(polygon.name)?.openPopup();
      }, 0);
      searchInputRef.current?.blur();
    },
    [polygonsByName],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbarRow">
          <div className="title" aria-label="כותרת">
            {appConfig.appName}
          </div>
          <div className="topbarActions">
            <div className="searchWrap" role="search">
              <input
                ref={searchInputRef}
                className="searchInput"
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="חיפוש אזור…"
                aria-label="חיפוש אזור"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchText('');
                    setDebouncedSearchText('');
                    searchInputRef.current?.blur();
                    return;
                  }
                  if (event.key !== 'Enter') return;
                  const firstMatch = searchMatches[0];
                  if (!firstMatch) return;
                  event.preventDefault();
                  focusZoneByName(firstMatch);
                }}
              />
              {isSearchFocused && searchMatches.length > 0 ? (
                <div className="searchResults" role="listbox" aria-label="תוצאות חיפוש">
                  {searchMatches.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="searchResultButton"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => focusZoneByName(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="actionButton"
              onClick={() => {
                setErrorMessage(null);
                void refreshAlarms();
              }}
            >
              רענון
            </button>
            <button
              type="button"
              className="actionButton"
              aria-expanded={isZonesOpen}
              aria-controls="zonesPanel"
              onClick={() => {
                setIsZonesOpen((current) => {
                  const next = !current;
                  if (next) setIsSettingsOpen(false);
                  return next;
                });
              }}
            >
              אזורים
            </button>
            <button
              type="button"
              className="actionButton"
              aria-expanded={isSettingsOpen}
              aria-controls="settingsPanel"
              onClick={() => {
                setIsSettingsOpen((current) => {
                  const next = !current;
                  if (next) setIsZonesOpen(false);
                  return next;
                });
              }}
            >
              הגדרות
            </button>
          </div>
        </div>
        <div className="status" aria-label="סטטוס">
          אב־טיפוס מקומי • {polygonsLabel} • ריענון כל {appConfig.apiPollSeconds} שנ׳ • עודכן
          לאחרונה: {lastUpdatedLabel} • {realtimeLabel}
          {isAlarmsLoading ? ' • מעדכן…' : ''}
        </div>
      </header>
      <main className="stage" aria-label="מפה">
        {errorMessage ? (
          <div className="errorBanner" role="status" aria-live="polite">
            {errorMessage}
          </div>
        ) : null}

        <aside
          id="settingsPanel"
          className={isSettingsOpen ? 'settingsPanel settingsPanelOpen' : 'settingsPanel'}
          aria-label="הגדרות"
        >
          <div className="settingsHeader">
            <div className="settingsTitle">הגדרות</div>
            <button type="button" className="actionButton" onClick={() => setIsSettingsOpen(false)}>
              סגירה
            </button>
          </div>

          <div className="settingsBody">
            <label className="fieldLabel" htmlFor={fadeMinutesInputId}>
              משך דהייה עד שקיפות 0 (בדקות)
            </label>
            <input
              id={fadeMinutesInputId}
              className="fieldInput"
              type="number"
              min={1}
              max={720}
              step={1}
              value={fadeMinutes}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (!Number.isFinite(parsed)) return;
                setFadeMinutes(Math.max(1, Math.min(720, parsed)));
              }}
            />
            <div className="fieldHint">ברירת מחדל: {DEFAULT_FADE_MINUTES} דקות.</div>

            <label className="fieldLabel" htmlFor={basemapSelectId}>
              שכבת מפה
            </label>
            <select
              id={basemapSelectId}
              className="fieldSelect"
              value={basemapId}
              onChange={(event) => setBasemapId(event.target.value)}
            >
              {BASEMAP_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <aside
          id="zonesPanel"
          className={isZonesOpen ? 'zonesPanel zonesPanelOpen' : 'zonesPanel'}
          aria-label="רשימת אזורים"
        >
          <div className="settingsHeader">
            <div className="settingsTitle">אזעקות אחרונות</div>
            <button type="button" className="actionButton" onClick={() => setIsZonesOpen(false)}>
              סגירה
            </button>
          </div>
          <div className="settingsBody">
            {recentZones.length === 0 ? (
              <div className="fieldHint">אין אזעקות תואמות עדיין (התאמה מדויקת בלבד).</div>
            ) : (
              <div className="zonesList" role="list">
                {recentZones.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    className="zoneRow"
                    onClick={() => focusZoneByName(entry.name)}
                  >
                    <div className="zoneName">{entry.name}</div>
                    <div className="zoneMeta">
                      <span>לפני {entry.minutesSince} דק׳</span>
                      <span className="zoneTimestamp">{formatAlarmTimestamp(entry.alarmAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="mapWrap" aria-label="מפת ישראל">
          <MapContainer
            className="mapContainer"
            center={[31.7, 35.0]}
            zoom={8}
            bounds={polygonsBounds ?? undefined}
            boundsOptions={{ padding: [12, 12], maxZoom: 10 }}
            scrollWheelZoom
            ref={mapRef}
          >
            <TileLayer attribution={basemap.attribution} url={basemap.url} />
            {polygons?.map((polygon) => {
              const zoneKey = normalizeZoneKey(polygon.name);
              const csvIso = normalizedZoneLastAlarm.get(zoneKey);
              const csvAt = csvIso ? new Date(csvIso) : null;
              const csvAtMs = csvAt && Number.isFinite(csvAt.getTime()) ? csvAt.getTime() : null;
              const realtimeAtMs = normalizedRealtimeLastAlarmByZoneMs.get(zoneKey) ?? null;
              const effectiveAlarmAtMs = computeEffectiveAlarmAtMs(csvAtMs, realtimeAtMs);
              const isHistoryReplaced =
                csvAtMs !== null &&
                realtimeAtMs !== null &&
                csvAtMs >= realtimeAtMs - REALTIME_HISTORY_REPLACED_SKEW_MS;
              const isMatched = effectiveAlarmAtMs !== null;
              const isForcedActive =
                realtimeAtMs !== null &&
                realtimeForcedActiveZones.has(zoneKey) &&
                !isHistoryReplaced;
              const fadeOpacity =
                isMatched && effectiveAlarmAtMs !== null && !isForcedActive
                  ? computeFadeOpacity({ nowMs, alarmAtMs: effectiveAlarmAtMs, fadeMinutes })
                  : isForcedActive
                    ? 1
                    : 0;
              const minutesSince =
                isMatched && effectiveAlarmAtMs !== null
                  ? computeMinutesSince({ nowMs, alarmAtMs: effectiveAlarmAtMs })
                  : null;
              const alarmAt = effectiveAlarmAtMs !== null ? new Date(effectiveAlarmAtMs) : null;

              const positions: LatLngExpression[] | LatLngExpression[][] = polygon.rings;
              const polygonSizeKm = computePolygonSizeKm(positions);
              const showTooltip = polygonSizeKm >= 20;
              const pathOptions = isMatched
                ? {
                    color: 'transparent',
                    weight: 0,
                    fillColor: '#dc2626',
                    fillOpacity: fadeOpacity,
                  }
                : {
                    color: 'transparent',
                    weight: 0,
                    fillColor: '#64748b',
                    fillOpacity: 0.08,
                  };
              const tooltipContent = minutesSince !== null
                ? showTooltip && polygonSizeKm >= 30
                  ? `${minutesSince}\n${polygon.name}`
                  : String(minutesSince)
                : '';

              return (
                <LeafletPolygon
                  key={polygon.name}
                  positions={positions}
                  pathOptions={pathOptions}
                  interactive={isMatched && minutesSince !== null && showTooltip}
                  ref={(layer) => {
                    if (layer) {
                      polygonLayersByNameRef.current.set(polygon.name, layer);
                    } else {
                      polygonLayersByNameRef.current.delete(polygon.name);
                    }
                  }}
                >
                  {isMatched && minutesSince !== null && showTooltip ? (
                    <Tooltip
                      direction="center"
                      permanent
                      className="polygon-tooltip"
                    >
                      {tooltipContent}
                    </Tooltip>
                  ) : null}
                  <Popup>
                    <div className="popupTitle">{polygon.name}</div>
                    {isMatched && alarmAt && minutesSince !== null ? (
                      <div className="popupBody">
                        <div>דקות מאז אזעקה: {minutesSince}</div>
                        <div>זמן אזעקה: {formatAlarmTimestamp(alarmAt)}</div>
                        {isForcedActive ? (
                          <div>סטטוס: פעיל (ריל־טיים; ממתינים ל־CSV)</div>
                        ) : csvAtMs === null && realtimeAtMs !== null ? (
                          <div>מקור: ריל־טיים (טרם הופיע ב־CSV)</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="popupBody">אין התאמה מדויקת ב־CSV.</div>
                    )}
                  </Popup>
                </LeafletPolygon>
              );
            })}
          </MapContainer>
        </div>
      </main>
    </div>
  );
}

export default App;
