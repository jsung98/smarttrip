# Engineering Decisions

This file tracks high-impact technical decisions and their rationale.

## 2026-02-27: Prefer deterministic day block replacement over fragile regex-only replacement
- Context: Regeneration and edit flows were failing when Day headers had formatting variance.
- Decision: Added explicit day range detection and replacement logic (`findDayRange`) in `components/ItineraryView.tsx`.
- Consequence: Regeneration/edit reliability improved; less dependent on header punctuation edge cases.

## 2026-02-27: Use inline memo input UI instead of browser prompt
- Context: `window.prompt` was blocked or inconsistent in some runtime environments.
- Decision: Added inline memo editor state and controls in `ItineraryView`.
- Consequence: Better UX consistency and fewer "no response" reports.

## 2026-02-27: Build verification gate before deployment
- Context: Repeated Vercel compile failures surfaced one type error at a time.
- Decision: Run full `npm run build` locally before pushing deployment fixes.
- Consequence: Faster stabilization and fewer trial-and-error deployment cycles.
