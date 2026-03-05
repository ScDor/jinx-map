# Phase 03: Realtime Alerts + “All Clear” (Best-Effort)

This phase upgrades the app from “history-only” to a best-effort realtime experience: it attempts to subscribe to live alert events in the browser and, when available, keeps zones fully red during an active alert and transitions to orange only if an explicit “all clear / allowed to leave shelter” signal is detected. It remains safe: realtime failures must never break the app and must fall back to CSV automatically.

## Tasks

- [ ] Research and extract realtime + all-clear signals used by `amitfin/oref_alert`:
  - Pull and inspect the relevant code paths in `amitfin/oref_alert` to identify:
    - Realtime event sources (WebSocket and/or HTTP polling)
    - Payload shapes (area names/codes, timestamps, categories)
    - Any “all clear / exit shelter” indicators or related endpoints
  - Record findings in a small internal markdown note under the repo (only if the repo already has a docs area; otherwise embed concise notes in code comments or commit messages)

- [ ] Implement a resilient realtime connector (browser-safe):
  - Add a `realtime` module with:
    - Pluggable transports (WebSocket first, HTTP poll fallback if discovered)
    - Exponential backoff, max retry, and a “disable for this session” circuit breaker
    - Strict runtime validation of incoming payloads (ignore unknown shapes safely)
  - Ensure CORS/geo failures are detected and surfaced as status text without console spam

- [ ] Model “active alert” vs “history fade” vs “all clear” states:
  - Data model per zone:
    - `lastAlarmAt` (from realtime or CSV)
    - `activeAlert` boolean (forces full red)
    - `allClearAt` (optional; only if explicit signal exists)
  - Visualization rules:
    - If `activeAlert`: full red, opacity=1.0
    - If `allClearAt` exists and is after `lastAlarmAt`: switch to orange and then apply the same fade-to-0 curve
    - If no all-clear exists: never show orange; use red fade only

- [ ] Integrate realtime with UI and refresh loop:
  - Prefer realtime updates over CSV while connected; still keep the 60s CSV refresh as a reconciliation fallback
  - Add a clear UI indicator: “ריל־טיים פעיל” / “ריל־טיים לא זמין (CSV)”
  - Add a manual toggle “נסה להתחבר לריל־טיים” (off by default if repeated failures occurred this session)

- [ ] Add tests for realtime parsing and state transitions (no network):
  - Fixtures for discovered realtime payloads (alert + all-clear if applicable)
  - Unit tests for:
    - Payload parsing/validation
    - State transitions (alert starts, alert repeats, all-clear arrives, CSV reconciliation)
    - Visualization decision logic (red vs orange vs fade)

- [ ] Run tests and verify behavior manually:
  - Run unit tests and fix any failures introduced in this phase
  - Manual checks:
    - App works normally when realtime cannot connect
    - When fed fixture realtime events (via a dev-only injection), zones change to active red and (if supported) orange on all-clear
