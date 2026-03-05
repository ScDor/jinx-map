# Phase 04: UX Polish (Mobile) + PWA

This phase turns the prototype into a day-to-day usable tool on both mobile and desktop: better Hebrew RTL UX, faster “find my area” workflows, accessible interactions, and optional PWA offline support so the map remains useful under flaky connectivity.

## Tasks

- [ ] Polish Hebrew/RTL UI and accessibility:
  - Ensure the entire UI is RTL-correct (inputs, dropdowns, popups, numeric formatting)
  - Add keyboard support for search results navigation and focus management
  - Improve color contrast and add a simple legend explaining the fade (Hebrew)

- [ ] Improve “find my zone” workflows:
  - Add “מצא אותי” (geolocation) and highlight the containing polygon if location is permitted
  - Add quick actions for focused zone: “העתק שם”, “העתק קישור”, “פתח בגוגל מפות”
  - Add a “recently viewed” list persisted in `localStorage`

- [ ] Add map UX enhancements without heavy complexity:
  - Add a toggle to show/hide unmatched polygons (default: show but neutral)
  - Add a lightweight “heat mode” toggle (same data, different styling) if it improves readability
  - Add haptic-friendly tap targets and reduce accidental map drags on mobile

- [ ] Add PWA + offline-first caching (optional but default on):
  - Add a service worker to cache app shell + `polygons.json` + last known alarms state
  - Ensure the app loads offline and clearly indicates “מצב לא מקוון” while using cached data
  - Keep network fetching in the background and update UI when connectivity returns

- [ ] Add targeted UX tests (logic-level) and smoke checks:
  - Tests for: URL deep-linking to a zone, localStorage persistence, geolocation polygon lookup (with mocked coords)
  - Run tests and manually verify on mobile-sized viewport (responsive layout, touch usability)
