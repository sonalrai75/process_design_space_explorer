# Phase 1 paired cellularization experiment + numerical display cleanup

This increment adds the first actual operating-structure comparison while preserving the current process architecture and simulation engine.

## Phase 1 paired experiment
- New endpoint: `POST /api/experiments/cellularization/phase1`
- Compares Global Pooling vs Cellular / No Overflow.
- Uses the same process architecture, arrival model, service-time distributions, routing probabilities, total baseline resource capacity, cases, and common random-number seeds.
- Cellular resources are implemented as exclusive cell-local partitions of the existing resource pools; no capacity is duplicated.
- Every enabled activity must belong to exactly one cell.
- Every baseline resource pool must be allocated exactly across the cells before the experiment can run.
- Results show Global, Cellular / No Overflow, and paired Cellular-minus-Global deltas for throughput, mean/median/P95 cycle time, SLA, WIP, max utilization, backlog growth, and annual cost.
- Time-varying staffing profiles are split across cells while preserving the original staffed total at each interval.

### Current Phase 1 limitation
Models containing individual `agents` are intentionally rejected because the current editor allocates pool capacity, not named individuals. This avoids silently duplicating or inventing individual resources. Agent-to-cell assignment can be added as a later increment.

## Numerical display cleanup
- Mean service-time displays are capped at two decimal places, without changing the underlying stored value unless the user edits it.
- Mean service-time editor values display at most two decimals.
- Numerical values in the calibrated summary near the top of the workspace use at most two decimal places where applicable.

## Files changed
- `backend/api/core/cellularization.py` (new)
- `backend/api/index.py`
- `frontend/app/cellularization/page.js`
- `frontend/app/page.js`

The existing optimizer, calibration engine, simulation mathematics, and model schema are otherwise unchanged.
