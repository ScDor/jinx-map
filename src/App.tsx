import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import './App.css'
import { appConfig } from './config'
import type { AlarmsComputedStateV1 } from './data/alarms'
import { fetchAndComputeAlarms, loadStoredAlarmsState } from './data/alarms'
import { fetchOrefRealtimeAlerts } from './data/realtime'
import type { NormalizedPolygon, PolygonsLoadSource } from './data/polygons'
import { loadPolygons } from './data/polygons'
import { MapContainer, Polygon as LeafletPolygon, Popup, TileLayer } from 'react-leaflet'
import type {
  LatLngBoundsExpression,
  LatLngExpression,
  Map as LeafletMap,
  Polygon as LeafletPolygonLayer,
} from 'leaflet'
import { computeFadeOpacity, computeMinutesSince } from './map/fade'

const FADE_MINUTES_KEY = 'jinx.fadeMinutes'
const DEFAULT_FADE_MINUTES = 60
const MAP_TICK_MS = 30_000
const SEARCH_DEBOUNCE_MS = 180
const SEARCH_RESULTS_LIMIT = 7
const RECENT_ZONES_LIMIT = 14
const REALTIME_BACKOFF_BASE_MS = 800
const REALTIME_BACKOFF_MAX_MS = 60_000
const REALTIME_HISTORY_REPLACED_SKEW_MS = 60_000

function computeEffectiveAlarmAtMs(csvAtMs: number | null, realtimeAtMs: number | null): number | null {
  if (csvAtMs === null && realtimeAtMs === null) return null
  if (csvAtMs === null) return realtimeAtMs
  if (realtimeAtMs === null) return csvAtMs
  if (csvAtMs >= realtimeAtMs - REALTIME_HISTORY_REPLACED_SKEW_MS) return csvAtMs
  return Math.max(csvAtMs, realtimeAtMs)
}

function readStoredInt(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeStoredInt(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}

function formatLastUpdated(value: Date | null): string {
  if (!value) return 'לא עודכן עדיין'
  return value.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function formatAlarmTimestamp(value: Date): string {
  return value.toLocaleString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function computePolygonsBounds(polygons: NormalizedPolygon[] | null): LatLngBoundsExpression | null {
  if (!polygons || polygons.length === 0) return null
  let minLat = Number.POSITIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  for (const polygon of polygons) {
    const [pMinLat, pMinLng, pMaxLat, pMaxLng] = polygon.bounds
    if (pMinLat < minLat) minLat = pMinLat
    if (pMinLng < minLng) minLng = pMinLng
    if (pMaxLat > maxLat) maxLat = pMaxLat
    if (pMaxLng > maxLng) maxLng = pMaxLng
  }

  if (![minLat, minLng, maxLat, maxLng].every((value) => Number.isFinite(value))) return null
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ]
}

function readInitialAlarms(): { state: AlarmsComputedStateV1 | null; lastUpdatedAt: Date | null } {
  const stored = loadStoredAlarmsState()
  if (!stored?.computedAt) return { state: stored, lastUpdatedAt: null }
  const parsed = new Date(stored.computedAt)
  return {
    state: stored,
    lastUpdatedAt: Number.isFinite(parsed.getTime()) ? parsed : null,
  }
}

function App() {
  const fadeMinutesInputId = useId()
  const [initialAlarms] = useState(() => readInitialAlarms())
  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText, setDebouncedSearchText] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isZonesOpen, setIsZonesOpen] = useState(false)
  const [fadeMinutes, setFadeMinutes] = useState(() =>
    readStoredInt(FADE_MINUTES_KEY, DEFAULT_FADE_MINUTES),
  )
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(initialAlarms.lastUpdatedAt)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [polygons, setPolygons] = useState<NormalizedPolygon[] | null>(null)
  const [polygonsSource, setPolygonsSource] = useState<PolygonsLoadSource | null>(null)
  const [isPolygonsLoading, setIsPolygonsLoading] = useState(true)
  const [isAlarmsLoading, setIsAlarmsLoading] = useState(false)
  const [alarmsState, setAlarmsState] = useState<AlarmsComputedStateV1 | null>(initialAlarms.state)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [realtimeMode, setRealtimeMode] = useState<
    'disabled' | 'connecting' | 'available' | 'unavailable'
  >(() => (appConfig.realtimeEnabled ? 'connecting' : 'disabled'))
  const [realtimeForcedActiveZones, setRealtimeForcedActiveZones] = useState<Set<string>>(
    () => new Set(),
  )
  const [realtimeLastAlarmByZoneMs, setRealtimeLastAlarmByZoneMs] = useState<Record<string, number>>(
    () => ({}),
  )
  const isMountedRef = useRef(true)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const polygonLayersByNameRef = useRef<Map<string, LeafletPolygonLayer>>(new Map())
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const refreshAlarms = useCallback(async () => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current

    setIsAlarmsLoading(true)
    const promise = fetchAndComputeAlarms({ url: appConfig.alarmsCsvUrl })
      .then((computed) => {
        if (!isMountedRef.current) return
        setAlarmsState(computed)
        const computedAt = new Date(computed.computedAt)
        if (Number.isFinite(computedAt.getTime())) setLastUpdatedAt(computedAt)
        setErrorMessage(null)
      })
      .catch(() => {
        if (!isMountedRef.current) return
        setErrorMessage('שגיאה בעדכון האזעקות (ממשיכים עם הנתונים האחרונים).')
      })
      .finally(() => {
        refreshInFlightRef.current = null
        if (!isMountedRef.current) return
        setIsAlarmsLoading(false)
      })

    refreshInFlightRef.current = promise
    return promise
  }, [])

  useEffect(() => {
    writeStoredInt(FADE_MINUTES_KEY, fadeMinutes)
  }, [fadeMinutes])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    loadPolygons()
      .then(({ source, payload }) => {
        if (cancelled) return
        setPolygons(payload.polygons)
        setPolygonsSource(source)
      })
      .catch(() => {
        if (cancelled) return
        setErrorMessage('שגיאה בטעינת הפוליגונים (נסו לרענן).')
      })
      .finally(() => {
        if (cancelled) return
        setIsPolygonsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshAlarms()
    }, 0)
    const interval = window.setInterval(() => {
      void refreshAlarms()
    }, appConfig.apiPollSeconds * 1000)

    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refreshAlarms])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, MAP_TICK_MS)
    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(handle)
    }
  }, [searchText])

  useEffect(() => {
    if (!appConfig.realtimeEnabled) return

    let cancelled = false
    let timeout: number | null = null
    let consecutiveFailures = 0
    let lastSignature: string | null = null

    const schedule = (delayMs: number) => {
      if (cancelled) return
      timeout = window.setTimeout(() => {
        void poll()
      }, delayMs)
    }

    const computeBackoffMs = () => {
      const exponent = Math.max(0, consecutiveFailures - 1)
      const raw = REALTIME_BACKOFF_BASE_MS * 2 ** exponent
      return Math.min(REALTIME_BACKOFF_MAX_MS, raw)
    }

    const poll = async () => {
      if (cancelled) return
      setRealtimeMode((mode) => (mode === 'available' ? 'available' : 'connecting'))

      try {
        const payload = await fetchOrefRealtimeAlerts(appConfig.realtimeAlertsUrl)
        if (cancelled || !isMountedRef.current) return

        consecutiveFailures = 0
        setRealtimeMode('available')

        const areas = payload.areas
        const signature = `${payload.alertDateIso ?? ''}|${payload.title ?? ''}|${areas.join(',')}`
        if (signature === lastSignature) {
          schedule(appConfig.realtimePollSeconds * 1000)
          return
        }

        lastSignature = signature
        const alarmAtMs = Date.now()

        if (areas.length === 0) {
          setRealtimeForcedActiveZones(new Set())
          schedule(appConfig.realtimePollSeconds * 1000)
          return
        }

        setRealtimeLastAlarmByZoneMs((current) => {
          const next = { ...current }
          for (const name of areas) {
            next[name] = alarmAtMs
          }
          return next
        })
        setRealtimeForcedActiveZones(new Set(areas))
        schedule(appConfig.realtimePollSeconds * 1000)
      } catch {
        if (cancelled || !isMountedRef.current) return
        consecutiveFailures += 1
        if (consecutiveFailures >= appConfig.realtimeMaxFailures) {
          setRealtimeMode('unavailable')
          setRealtimeForcedActiveZones(new Set())
          return
        }
        schedule(computeBackoffMs())
      }
    }

    schedule(0)
    return () => {
      cancelled = true
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [])

  const lastUpdatedLabel = useMemo(() => formatLastUpdated(lastUpdatedAt), [lastUpdatedAt])
  const polygonsLabel = useMemo(() => {
    if (isPolygonsLoading) return 'טוען פוליגונים…'
    if (!polygons) return 'פוליגונים: לא נטענו'
    const sourceLabel = polygonsSource === 'polygons.json' ? 'מלא' : 'דוגמה'
    return `פוליגונים: ${polygons.length} (${sourceLabel})`
  }, [isPolygonsLoading, polygons, polygonsSource])

  const polygonsBounds = useMemo(() => computePolygonsBounds(polygons), [polygons])
  const zoneLastAlarm = useMemo(() => alarmsState?.zoneLastAlarm ?? {}, [alarmsState])
  const realtimeLabel = useMemo(() => {
    if (!appConfig.realtimeEnabled) return 'ריל־טיים: כבוי'
    if (realtimeMode === 'connecting') return 'מנסה ריל־טיים…'
    if (realtimeMode === 'unavailable') return 'ריל־טיים לא זמין, משתמשים ב־CSV'
    if (realtimeForcedActiveZones.size > 0) return 'ריל־טיים: פעיל'
    return 'ריל־טיים: זמין'
  }, [realtimeForcedActiveZones.size, realtimeMode])
  const polygonsByName = useMemo(() => {
    const map = new Map<string, NormalizedPolygon>()
    for (const polygon of polygons ?? []) {
      map.set(polygon.name, polygon)
    }
    return map
  }, [polygons])

  const polygonSearchIndex = useMemo(() => {
    return (polygons ?? []).map((polygon) => ({
      name: polygon.name,
      key: polygon.name.normalize('NFKC'),
    }))
  }, [polygons])

  const searchMatches = useMemo(() => {
    const query = debouncedSearchText.normalize('NFKC')
    if (!query) return []
    const matches = polygonSearchIndex
      .map((entry) => ({ name: entry.name, index: entry.key.indexOf(query) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index
        return a.name.length - b.name.length
      })
      .slice(0, SEARCH_RESULTS_LIMIT)
      .map((entry) => entry.name)
    return matches
  }, [debouncedSearchText, polygonSearchIndex])

  const effectiveZoneLastAlarmMs = useMemo(() => {
    const map = new Map<string, number>()
    const names = new Set<string>([
      ...Object.keys(zoneLastAlarm),
      ...Object.keys(realtimeLastAlarmByZoneMs),
    ])

    for (const name of names) {
      const csvIso = zoneLastAlarm[name]
      const csvAtMs = csvIso ? new Date(csvIso).getTime() : null
      const csvAtMsValid = csvAtMs !== null && Number.isFinite(csvAtMs) ? csvAtMs : null
      const realtimeAtMsRaw = realtimeLastAlarmByZoneMs[name]
      const realtimeAtMs =
        typeof realtimeAtMsRaw === 'number' && Number.isFinite(realtimeAtMsRaw) ? realtimeAtMsRaw : null

      const effective = computeEffectiveAlarmAtMs(csvAtMsValid, realtimeAtMs)
      if (effective === null) continue
      map.set(name, effective)
    }
    return map
  }, [realtimeLastAlarmByZoneMs, zoneLastAlarm])

  const recentZones = useMemo(() => {
    const entries: Array<{ name: string; alarmAt: Date; alarmAtMs: number; minutesSince: number }> = []
    for (const [name, alarmAtMs] of effectiveZoneLastAlarmMs.entries()) {
      if (!polygonsByName.has(name)) continue
      const alarmAt = new Date(alarmAtMs)
      entries.push({
        name,
        alarmAt,
        alarmAtMs,
        minutesSince: computeMinutesSince({ nowMs, alarmAtMs }),
      })
    }
    entries.sort((a, b) => b.alarmAtMs - a.alarmAtMs)
    return entries.slice(0, RECENT_ZONES_LIMIT)
  }, [effectiveZoneLastAlarmMs, nowMs, polygonsByName])

  const focusZoneByName = useCallback(
    (name: string) => {
      const polygon = polygonsByName.get(name)
      if (!polygon) return
      setSearchText(name)
      setIsZonesOpen(false)
      const [minLat, minLng, maxLat, maxLng] = polygon.bounds
      mapRef.current?.fitBounds(
        [
          [minLat, minLng],
          [maxLat, maxLng],
        ],
        { padding: [32, 32], maxZoom: 13 },
      )
      window.setTimeout(() => {
        polygonLayersByNameRef.current.get(name)?.openPopup()
      }, 0)
      searchInputRef.current?.blur()
    },
    [polygonsByName],
  )

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
                    setSearchText('')
                    setDebouncedSearchText('')
                    searchInputRef.current?.blur()
                    return
                  }
                  if (event.key !== 'Enter') return
                  const firstMatch = searchMatches[0]
                  if (!firstMatch) return
                  event.preventDefault()
                  focusZoneByName(firstMatch)
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
                setErrorMessage(null)
                void refreshAlarms()
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
                  const next = !current
                  if (next) setIsSettingsOpen(false)
                  return next
                })
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
                  const next = !current
                  if (next) setIsZonesOpen(false)
                  return next
                })
              }}
            >
              הגדרות
            </button>
          </div>
        </div>
        <div className="status" aria-label="סטטוס">
          אב־טיפוס מקומי • {polygonsLabel} • ריענון כל {appConfig.apiPollSeconds} שנ׳ • עודכן לאחרונה:{' '}
          {lastUpdatedLabel} • {realtimeLabel}
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
                const parsed = Number.parseInt(event.target.value, 10)
                if (!Number.isFinite(parsed)) return
                setFadeMinutes(Math.max(1, Math.min(720, parsed)))
              }}
            />
            <div className="fieldHint">ברירת מחדל: {DEFAULT_FADE_MINUTES} דקות.</div>
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
            boundsOptions={{ padding: [12, 12] }}
            scrollWheelZoom
            preferCanvas
            whenCreated={(map) => {
              mapRef.current = map
            }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {polygons?.map((polygon) => {
              const csvIso = zoneLastAlarm[polygon.name]
              const csvAt = csvIso ? new Date(csvIso) : null
              const csvAtMs = csvAt && Number.isFinite(csvAt.getTime()) ? csvAt.getTime() : null
              const realtimeAtMs = realtimeLastAlarmByZoneMs[polygon.name] ?? null
              const effectiveAlarmAtMs = computeEffectiveAlarmAtMs(csvAtMs, realtimeAtMs)
              const isHistoryReplaced =
                csvAtMs !== null &&
                realtimeAtMs !== null &&
                csvAtMs >= realtimeAtMs - REALTIME_HISTORY_REPLACED_SKEW_MS
              const isMatched = effectiveAlarmAtMs !== null
              const isForcedActive =
                realtimeAtMs !== null && realtimeForcedActiveZones.has(polygon.name) && !isHistoryReplaced
              const fadeOpacity =
                isMatched && effectiveAlarmAtMs !== null && !isForcedActive
                  ? computeFadeOpacity({ nowMs, alarmAtMs: effectiveAlarmAtMs, fadeMinutes })
                  : isForcedActive
                    ? 1
                    : 0
              const minutesSince =
                isMatched && effectiveAlarmAtMs !== null
                  ? computeMinutesSince({ nowMs, alarmAtMs: effectiveAlarmAtMs })
                  : null
              const alarmAt = effectiveAlarmAtMs !== null ? new Date(effectiveAlarmAtMs) : null

              const positions: LatLngExpression[] | LatLngExpression[][] = polygon.rings
              const pathOptions = isMatched
                ? {
                    color: '#dc2626',
                    weight: 1.5,
                    opacity: fadeOpacity,
                    fillColor: '#dc2626',
                    fillOpacity: fadeOpacity,
                  }
                : {
                    color: '#64748b',
                    weight: 1,
                    opacity: 0.35,
                    fillColor: '#94a3b8',
                    fillOpacity: 0.05,
                  }

              return (
                <LeafletPolygon
                  key={polygon.name}
                  positions={positions}
                  pathOptions={pathOptions}
                  ref={(layer) => {
                    if (layer) {
                      polygonLayersByNameRef.current.set(polygon.name, layer)
                    } else {
                      polygonLayersByNameRef.current.delete(polygon.name)
                    }
                  }}
                >
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
              )
            })}
          </MapContainer>
        </div>
      </main>
    </div>
  )
}

export default App
