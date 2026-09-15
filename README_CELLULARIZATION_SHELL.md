# Cellularization UI shell

This increment is intentionally frontend-only.

Changes:
- Adds `/cellularization` as a dedicated Cellularization & Scheduling workspace.
- Adds an `Open Cellularization & Scheduling` button beside the existing baseline/optimization controls.
- Passes the current in-memory process model to the new page through localStorage.
- Shows current architecture, activities, resource pools and agents on the new page.
- Adds the Phase 1 experiment sequence as a non-executing shell.

No backend model schema, simulation, calibration or optimization code is changed in this increment.
