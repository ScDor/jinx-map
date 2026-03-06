# Design: Horizontal Slider for Fade Threshold

## Overview

Replace the number input for fade minutes with a horizontal range slider allowing users to select values from 10 minutes to 24 hours.

## UI/UX Specification

### Input Component

- **Type**: `<input type="range">`
- **Min**: 10 minutes
- **Max**: 1440 minutes (24 hours)
- **Step**: 5 minutes
- **Default**: 60 minutes

### Value Display

- Show current value in human-readable Hebrew format
- Format: "Xדק" for values under hour, "Xשעה Yדק" for values over an hour
- Examples: "45דק", "1שעה 30דק", "4שעות"

### Validation

- Clamp value between 10-1440
- Persist to localStorage as integer

## Files to Modify

- `src/App.tsx` - Replace input component and add value formatter

## Success Criteria

- Works on desktop and mobile (touch-friendly)
- Value displays in readable Hebrew format
- Persists to localStorage correctly
- Default of 60 minutes pre-selected
