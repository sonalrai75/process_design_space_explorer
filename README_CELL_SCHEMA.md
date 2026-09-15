# Cell schema increment

This increment makes the existing manual cell design part of the canonical ProcessModel without changing simulation behavior.

Changes:
- adds optional `WorkType` and `CellDefinition` Pydantic models;
- adds backward-compatible `work_types` and `cells` fields to `ProcessModel`;
- saves the cellularization editor's current cell definitions into `pds_cellularization_model` as `model.cells` as well as the existing dedicated local-storage key;
- reloads `model.cells` when a separate saved cell-design key is not present.

No simulation, optimization, calibration, routing, or API endpoint behavior is changed in this increment.
