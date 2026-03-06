# Fade Threshold Slider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the number input for fade minutes with a horizontal range slider (10min-24hr), default 60min

**Architecture:** Single component change in App.tsx - replace input element, add value formatter function

**Tech Stack:** React, TypeScript, HTML input[type=range]

---

### Task 1: Add value formatter function

**Files:**

- Modify: `src/App.tsx` (add near top of file with other utilities)

**Step 1: Add formatFadeMinutes function**

Add this function after the imports and before the component:

```typescript
function formatFadeMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}דק`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return hours === 1 ? `1שעה` : `${hours}שעות`;
  }
  return `${hours}שעה ${mins}דק`;
}
```

**Step 2: Verify file compiles**

Run: `npm run build`
Expected: BUILD SUCCESS (no errors)

---

### Task 2: Replace number input with range slider

**Files:**

- Modify: `src/App.tsx:616-633` (the fade minutes input section)

**Step 1: Read current implementation**

Confirm current code at lines 616-633

**Step 2: Replace input element**

Replace the entire section (lines 616-633) with:

```tsx
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
```

**Step 3: Verify file compiles**

Run: `npm run build`
Expected: BUILD SUCCESS

---

### Task 3: Add CSS for slider

**Files:**

- Modify: `src/App.css` (add slider styles)

**Step 1: Add slider CSS**

Add to end of App.css:

```css
.sliderContainer {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sliderContainer input[type='range'] {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: #e2e8f0;
  border-radius: 3px;
  outline: none;
}

.sliderContainer input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  background: #dc2626;
  border-radius: 50%;
  cursor: pointer;
}

.sliderContainer input[type='range']::-moz-range-thumb {
  width: 20px;
  height: 20px;
  background: #dc2626;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.sliderValue {
  font-weight: 600;
  color: #dc2626;
  min-width: 70px;
  text-align: left;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: BUILD SUCCESS

---

### Task 4: Test manually

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Verify**

- Open browser to localhost
- Open settings panel
- Confirm slider appears with default at 60 minutes ("1שעה")
- Drag slider, confirm value display updates
- Save and refresh, confirm value persists
