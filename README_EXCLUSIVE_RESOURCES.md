# Phase 1 exclusive resource allocation

This increment changes only the Cellularization UI.

- Resource capacity assigned to one cell is immediately unavailable to other cells.
- Each cell input is capped at baseline capacity minus allocations in the other cells.
- Reducing an allocation immediately releases capacity for the other cells.
- The UI displays total allocated and remaining free capacity for each resource pool.
- No backend, simulation, optimization, calibration, or process-model logic is changed.
