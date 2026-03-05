import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import './App.css'
import { appConfig } from './config'
import type { AlarmsComputedStateV1 } from './data/alarms'
import { fetchAndComputeAlarms, loadStoredAlarmsState } from './data/alarms'
import type { NormalizedPolygon, PolygonsLoadSource } from './data/polygons'
import { loadPolygons } from './data/polygons'
import { MapContainer, Polygon as LeafletPolygon, Popup, TileLayer } from 'react-leaflet'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import { computeFadeOpacity, computeMinutesSince } from './map/fade'

const FADE_MINUTES_KEY = 'jinx.fadeMinutes'
const DEFAULT_FADE_MINUTES = 60
const MAP_TICK_MS = 30_000

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
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
  const isMountedRef = useRef(true)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)

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

  const lastUpdatedLabel = useMemo(() => formatLastUpdated(lastUpdatedAt), [lastUpdatedAt])
  const polygonsLabel = useMemo(() => {
    if (isPolygonsLoading) return 'טוען פוליגונים…'
    if (!polygons) return 'פוליגונים: לא נטענו'
    const sourceLabel = polygonsSource === 'polygons.json' ? 'מלא' : 'דוגמה'
    return `פוליגונים: ${polygons.length} (${sourceLabel})`
  }, [isPolygonsLoading, polygons, polygonsSource])

  const polygonsBounds = useMemo(() => computePolygonsBounds(polygons), [polygons])
  const zoneLastAlarm = alarmsState?.zoneLastAlarm ?? {}

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
                className="searchInput"
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="חיפוש אזור…"
                aria-label="חיפוש אזור"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
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
              aria-expanded={isSettingsOpen}
              aria-controls="settingsPanel"
              onClick={() => setIsSettingsOpen((current) => !current)}
            >
              הגדרות
            </button>
          </div>
        </div>
        <div className="status" aria-label="סטטוס">
          אב־טיפוס מקומי • {polygonsLabel} • ריענון כל {appConfig.apiPollSeconds} שנ׳ • עודכן לאחרונה:{' '}
          {lastUpdatedLabel}
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

        <div className="mapWrap" aria-label="מפת ישראל">
          <MapContainer
            className="mapContainer"
            center={[31.7, 35.0]}
            zoom={8}
            bounds={polygonsBounds ?? undefined}
            boundsOptions={{ padding: [12, 12] }}
            scrollWheelZoom
            preferCanvas
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {polygons?.map((polygon) => {
              const matchIso = zoneLastAlarm[polygon.name]
              const alarmAt = matchIso ? new Date(matchIso) : null
              const alarmAtMs = alarmAt && Number.isFinite(alarmAt.getTime()) ? alarmAt.getTime() : null
              const isMatched = alarmAtMs !== null
              const fadeOpacity = isMatched
                ? computeFadeOpacity({ nowMs, alarmAtMs, fadeMinutes })
                : 0
              const minutesSince = isMatched ? computeMinutesSince({ nowMs, alarmAtMs }) : null

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
                <LeafletPolygon key={polygon.name} positions={positions} pathOptions={pathOptions}>
                  <Popup>
                    <div className="popupTitle">{polygon.name}</div>
                    {isMatched && alarmAt && minutesSince !== null ? (
                      <div className="popupBody">
                        <div>דקות מאז אזעקה: {minutesSince}</div>
                        <div>זמן אזעקה: {formatAlarmTimestamp(alarmAt)}</div>
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
