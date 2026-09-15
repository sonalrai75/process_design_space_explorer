Cellularization increment 2 — manual cell editor

Changes only frontend/app/cellularization/page.js.

Adds:
- Add/remove/rename cells
- Assign activities to cells
- Allocate integer resource-pool capacity by cell
- Live validation for unassigned/multi-cell activities and resource capacity totals
- Prevents saving when allocated capacity exceeds the baseline pool capacity
- Saves cell definitions in browser localStorage as pds_cellularization_cells

No backend, simulation, optimization, calibration, or process-model schema code is changed in this increment.
