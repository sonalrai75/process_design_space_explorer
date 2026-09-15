# Optimization visibility and live timing-status fix

Based on the known-good d22cd25 frontend plus UI Increment 1.

Changes only `frontend/app/page.js`:
- unresolved-duration warning is derived from the current edited model instead of the stale calibration snapshot
- activity provenance reflects current activity model source/distribution/confidence
- optimization completion reports the number of architecture results
- successful optimization automatically scrolls to the existing optimization-results section
- no API, simulation, calibration, or optimization mathematics changed
