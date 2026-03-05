import { useEffect, useId, useMemo, useState } from 'react'
import './App.css'
import { appConfig } from './config'
import type { NormalizedPolygon, PolygonsLoadSource } from './data/polygons'
import { loadPolygons } from './data/polygons'

const FADE_MINUTES_KEY = 'jinx.fadeMinutes'
const DEFAULT_FADE_MINUTES = 60

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

function App() {
  const fadeMinutesInputId = useId()
  const [searchText, setSearchText] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [fadeMinutes, setFadeMinutes] = useState(() =>
    readStoredInt(FADE_MINUTES_KEY, DEFAULT_FADE_MINUTES),
  )
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [polygons, setPolygons] = useState<NormalizedPolygon[] | null>(null)
  const [polygonsSource, setPolygonsSource] = useState<PolygonsLoadSource | null>(null)
  const [isPolygonsLoading, setIsPolygonsLoading] = useState(true)

  useEffect(() => {
    writeStoredInt(FADE_MINUTES_KEY, fadeMinutes)
  }, [fadeMinutes])

  useEffect(() => {
    let cancelled = false
    setIsPolygonsLoading(true)

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

  const lastUpdatedLabel = useMemo(() => formatLastUpdated(lastUpdatedAt), [lastUpdatedAt])
  const polygonsLabel = useMemo(() => {
    if (isPolygonsLoading) return 'טוען פוליגונים…'
    if (!polygons) return 'פוליגונים: לא נטענו'
    const sourceLabel = polygonsSource === 'polygons.json' ? 'מלא' : 'דוגמה'
    return `פוליגונים: ${polygons.length} (${sourceLabel})`
  }, [isPolygonsLoading, polygons, polygonsSource])

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
                setLastUpdatedAt(new Date())
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

        <div className="placeholder">
          כאן תופיע המפה עם הפוליגונים (שלב הבא).
          <div className="hint">משך דהייה נוכחי: {fadeMinutes} דקות.</div>
          <div className="hint">{polygonsLabel}</div>
        </div>
      </main>
    </div>
  )
}

export default App
