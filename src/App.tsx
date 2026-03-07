import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './App.css';
import { appConfig } from './config';
import type { AlarmsComputedStateV1 } from './data/alarms';
import { fetchAndComputeAlarms, loadStoredAlarmsState } from './data/alarms';
import type { NormalizedPolygon, PolygonsLoadSource } from './data/polygons';
import { loadPolygons } from './data/polygons';
import {
  MapContainer,
  Marker,
  Polygon as LeafletPolygon,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';
import type {
  DivIcon,
  LatLngBoundsExpression,
  LatLngExpression,
  Map as LeafletMap,
  Polygon as LeafletPolygonLayer,
} from 'leaflet';
import { divIcon } from 'leaflet';
import { computeFadeOpacity, computeMinutesSince } from './map/fade';
import { formatFadeMinutes, formatMinutesSince } from './formatters';

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
type LabelPolicy = { enabled: boolean; maxLabels: number; marginPx: number };

function computeLabelPolicy(zoom: number): LabelPolicy {
  if (zoom <= 6) return { enabled: false, maxLabels: 0, marginPx: 14 };
  if (zoom <= 7) return { enabled: true, maxLabels: 20, marginPx: 12 };
  if (zoom <= 8) return { enabled: true, maxLabels: 40, marginPx: 10 };
  if (zoom <= 9) return { enabled: true, maxLabels: 80, marginPx: 8 };
  return { enabled: true, maxLabels: Number.POSITIVE_INFINITY, marginPx: 6 };
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function isPointOnSegment(
  pointLat: number,
  pointLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): boolean {
  const cross = (pointLng - aLng) * (bLat - aLat) - (pointLat - aLat) * (bLng - aLng);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (pointLng - aLng) * (bLng - aLng) + (pointLat - aLat) * (bLat - aLat);
  if (dot < 0) return false;
  const squaredLen = (bLng - aLng) ** 2 + (bLat - aLat) ** 2;
  return dot <= squaredLen;
}

function isPointInRing(point: [number, number], ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  const [pointLat, pointLng] = point;
  let inside = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [latA, lngA] = ring[current];
    const [latB, lngB] = ring[previous];

    if (isPointOnSegment(pointLat, pointLng, latA, lngA, latB, lngB)) return true;

    const intersects =
      latA > pointLat !== latB > pointLat &&
      pointLng < ((lngB - lngA) * (pointLat - latA)) / (latB - latA) + lngA;

    if (intersects) inside = !inside;
  }

  return inside;
}

function isPointInsidePolygon(point: [number, number], rings: [number, number][][]): boolean {
  if (rings.length === 0) return false;
  if (!isPointInRing(point, rings[0])) return false;
  for (let index = 1; index < rings.length; index += 1) {
    if (isPointInRing(point, rings[index])) return false;
  }
  return true;
}

function findPointInsidePolygon(polygon: NormalizedPolygon): [number, number] {
  const [minLat, minLng, maxLat, maxLng] = polygon.bounds;
  const center: [number, number] = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  const rings = polygon.rings as [number, number][][];

  if (isPointInsidePolygon(center, rings)) return center;

  const outerRing = rings[0];
  if (outerRing.length > 0) {
    let sumLat = 0;
    let sumLng = 0;
    for (const [lat, lng] of outerRing) {
      sumLat += lat;
      sumLng += lng;
    }
    const avgPoint: [number, number] = [sumLat / outerRing.length, sumLng / outerRing.length];
    if (isPointInsidePolygon(avgPoint, rings)) return avgPoint;
  }

  const gridSteps = [5, 7, 9, 11];
  for (const steps of gridSteps) {
    let bestPoint: [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let row = 0; row <= steps; row += 1) {
      const tLat = row / steps;
      const lat = minLat + (maxLat - minLat) * tLat;
      for (let col = 0; col <= steps; col += 1) {
        const tLng = col / steps;
        const lng = minLng + (maxLng - minLng) * tLng;
        const candidate: [number, number] = [lat, lng];
        if (!isPointInsidePolygon(candidate, rings)) continue;
        const distance = (lat - center[0]) ** 2 + (lng - center[1]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPoint = candidate;
        }
      }
    }

    if (bestPoint) return bestPoint;
  }

  return outerRing[0] ?? center;
}

function normalizeZoneKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFKC');
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
  const [mapZoom, setMapZoom] = useState(8);
  const [hiddenLabelZoneKeys, setHiddenLabelZoneKeys] = useState<Set<string>>(() => new Set());
  const isMountedRef = useRef(true);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polygonLayersByNameRef = useRef<Map<string, LeafletPolygonLayer>>(new Map());
  const labelIconCacheRef = useRef<Map<string, DivIcon>>(new Map());
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
  const polygonsByName = useMemo(() => {
    const map = new Map<string, NormalizedPolygon>();
    for (const polygon of polygons ?? []) {
      map.set(normalizeZoneKey(polygon.name), polygon);
    }
    return map;
  }, [polygons]);
  const labelAnchorByZoneKey = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const polygon of polygons ?? []) {
      map.set(normalizeZoneKey(polygon.name), findPointInsidePolygon(polygon));
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

  const effectiveZoneLastAlarmMs = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, iso] of normalizedZoneLastAlarm.entries()) {
      const ms = new Date(iso).getTime();
      if (!Number.isFinite(ms)) continue;
      map.set(key, ms);
    }
    return map;
  }, [normalizedZoneLastAlarm]);

  const labelCandidates = useMemo(() => {
    const candidates: Array<{
      zoneKey: string;
      label: string;
      anchor: [number, number];
      minutesSince: number;
    }> = [];

    for (const [zoneKey, alarmAtMs] of effectiveZoneLastAlarmMs.entries()) {
      const polygon = polygonsByName.get(zoneKey);
      if (!polygon) continue;
      const minutesSince = computeMinutesSince({ nowMs, alarmAtMs });
      candidates.push({
        zoneKey,
        label: formatMinutesSince(minutesSince),
        anchor: labelAnchorByZoneKey.get(zoneKey) ?? findPointInsidePolygon(polygon),
        minutesSince,
      });
    }

    candidates.sort((a, b) => a.minutesSince - b.minutesSince);
    return candidates;
  }, [effectiveZoneLastAlarmMs, labelAnchorByZoneKey, nowMs, polygonsByName]);

  const declutterLabels = useCallback(
    (map: LeafletMap) => {
      const policy = computeLabelPolicy(map.getZoom());
      if (!policy.enabled || policy.maxLabels <= 0) {
        const allHidden = new Set(labelCandidates.map((candidate) => candidate.zoneKey));
        setHiddenLabelZoneKeys((current) => (setsEqual(current, allHidden) ? current : allHidden));
        return;
      }

      const visibleBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const hidden = new Set<string>();
      let visibleCount = 0;

      for (const candidate of labelCandidates) {
        if (visibleCount >= policy.maxLabels) {
          hidden.add(candidate.zoneKey);
          continue;
        }

        const point = map.latLngToContainerPoint(candidate.anchor);
        const width = Math.max(28, candidate.label.length * 8 + 12);
        const height = 22;
        const left = point.x - width / 2;
        const right = left + width;
        const top = point.y - height / 2;
        const bottom = top + height;

        let overlaps = false;
        for (const box of visibleBoxes) {
          if (
            left < box.right + policy.marginPx &&
            right > box.left - policy.marginPx &&
            top < box.bottom + policy.marginPx &&
            bottom > box.top - policy.marginPx
          ) {
            overlaps = true;
            break;
          }
        }

        if (overlaps) {
          hidden.add(candidate.zoneKey);
          continue;
        }

        visibleBoxes.push({ left, right, top, bottom });
        visibleCount += 1;
      }

      setHiddenLabelZoneKeys((current) => (setsEqual(current, hidden) ? current : hidden));
    },
    [labelCandidates],
  );

  const handleMapViewChanged = useCallback(
    (map: LeafletMap) => {
      mapRef.current = map;
      setMapZoom(map.getZoom());
      declutterLabels(map);
    },
    [declutterLabels],
  );
  const getLabelIcon = useCallback((labelText: string): DivIcon => {
    const cached = labelIconCacheRef.current.get(labelText);
    if (cached) return cached;

    const icon = divIcon({
      className: 'area-label-marker',
      html: `<span class="area-label-inner">${labelText}</span>`,
    });
    labelIconCacheRef.current.set(labelText, icon);
    return icon;
  }, []);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    declutterLabels(map);
  }, [declutterLabels]);

  function MapEventBridge({ onViewChange }: { onViewChange: (map: LeafletMap) => void }) {
    const map = useMapEvents({
      zoomend: () => onViewChange(map),
      moveend: () => onViewChange(map),
      resize: () => onViewChange(map),
    });

    useEffect(() => {
      onViewChange(map);
    }, [map, onViewChange]);

    return null;
  }

  const labelPolicy = useMemo(() => computeLabelPolicy(mapZoom), [mapZoom]);

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
          {polygonsLabel} • ריענון כל {appConfig.apiPollSeconds} שנ׳ • עודכן לאחרונה:{' '}
          {lastUpdatedLabel}
          {isAlarmsLoading ? ' • מעדכן…' : ''}
        </div>
        <div className="dataAttribution" aria-label="ייחוס נתונים">
          נתונים: פוליגונים מ־
          <a href="https://github.com/amitfin/oref_alert" target="_blank" rel="noopener noreferrer">
            {' '}
            amitfin/oref_alert
          </a>{' '}
          • אזעקות מ־
          <a
            href="https://github.com/yuval-harpaz/alarms"
            target="_blank"
            rel="noopener noreferrer"
          >
            {' '}
            yuval-harpaz/alarms
          </a>
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
              משך דהייה עד שקיפות 0
            </label>
            <div className="sliderContainer">
              <input
                id={fadeMinutesInputId}
                type="range"
                min={10}
                max={1440}
                step={5}
                value={fadeMinutes}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (!Number.isFinite(parsed)) return;
                  setFadeMinutes(Math.max(10, Math.min(1440, parsed)));
                }}
              />
              <span className="sliderValue">{formatFadeMinutes(fadeMinutes)}</span>
            </div>
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
                      <span>לפני {formatMinutesSince(entry.minutesSince)}</span>
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
          >
            <MapEventBridge onViewChange={handleMapViewChanged} />
            <TileLayer attribution={basemap.attribution} url={basemap.url} />
            {polygons
              ?.filter((polygon) => {
                const zoneKey = normalizeZoneKey(polygon.name);
                const csvIso = normalizedZoneLastAlarm.get(zoneKey);
                const csvAt = csvIso ? new Date(csvIso) : null;
                const csvAtMs = csvAt && Number.isFinite(csvAt.getTime()) ? csvAt.getTime() : null;
                return csvAtMs !== null;
              })
              .map((polygon) => {
                const zoneKey = normalizeZoneKey(polygon.name);
                const csvIso = normalizedZoneLastAlarm.get(zoneKey);
                const csvAt = csvIso ? new Date(csvIso) : null;
                const csvAtMs = csvAt && Number.isFinite(csvAt.getTime()) ? csvAt.getTime() : null;
                const isMatched = csvAtMs !== null;
                const fadeOpacity =
                  isMatched && csvAtMs !== null
                    ? computeFadeOpacity({ nowMs, alarmAtMs: csvAtMs, fadeMinutes })
                    : 0;
                const minutesSince =
                  isMatched && csvAtMs !== null
                    ? computeMinutesSince({ nowMs, alarmAtMs: csvAtMs })
                    : null;
                const alarmAt = csvAtMs !== null ? new Date(csvAtMs) : null;

                const positions: LatLngExpression[] | LatLngExpression[][] = polygon.rings;
                const showLabel =
                  labelPolicy.enabled &&
                  isMatched &&
                  minutesSince !== null &&
                  !hiddenLabelZoneKeys.has(zoneKey);
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
                const tooltipContent =
                  minutesSince !== null ? formatMinutesSince(minutesSince) : '';

                const labelAnchor = labelAnchorByZoneKey.get(zoneKey) ?? null;

                return (
                  <Fragment key={polygon.name}>
                    <LeafletPolygon
                      positions={positions}
                      pathOptions={pathOptions}
                      interactive={isMatched && minutesSince !== null}
                      ref={(layer) => {
                        if (layer) {
                          polygonLayersByNameRef.current.set(polygon.name, layer);
                        } else {
                          polygonLayersByNameRef.current.delete(polygon.name);
                        }
                      }}
                    >
                      <Popup>
                        <div className="popupTitle">{polygon.name}</div>
                        {isMatched && alarmAt && minutesSince !== null ? (
                          <div className="popupBody">
                            <div>זמן מאז אזעקה: {formatMinutesSince(minutesSince)}</div>
                            <div>זמן אזעקה: {formatAlarmTimestamp(alarmAt)}</div>
                          </div>
                        ) : (
                          <div className="popupBody">אין התאמה מדויקת ב־CSV.</div>
                        )}
                      </Popup>
                    </LeafletPolygon>
                    {showLabel && labelAnchor ? (
                      <Marker
                        position={labelAnchor}
                        icon={getLabelIcon(tooltipContent)}
                        interactive={false}
                        keyboard={false}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
          </MapContainer>
        </div>
      </main>
    </div>
  );
}

export default App;
