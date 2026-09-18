# Automated Cellularization v1

This increment adds a decision-support workflow that orchestrates the existing structural candidate generation and paired simulation evaluation.

## What it does

- Adds `POST /api/cellularization/automated`.
- Chooses a process-size-aware range of candidate cell counts (up to 6) when `k_values` is omitted.
- Reuses the existing candidate generator (routing, topology, processing-time, resource-compatibility similarity).
- Reuses the existing paired simulation evaluator with common random numbers.
- Evaluates strict cellularization and symmetric controlled overflow against one global baseline.
- Computes a Pareto set across structural score, controlled-overflow cycle time/P95, throughput, overflow share, and workload balance.
- Keeps a 95% max-utilization guardrail separate from Pareto membership.
- Adds transparent tradeoff labels: Maximum localization, Greater pooling / fewer cells, and Balanced tradeoff when distinct.
- Adds `Load + enable overflow`, which loads a generated design into the existing editor and turns on two-way overflow reception so Phase 2/3 controls are immediately usable after saving.

## Important modeling principle

This is not a black-box optimizer. The workflow generates and evaluates alternatives, exposes Pareto-efficient designs, and leaves the final design editable. Structural coherence and simulation performance remain separate evidence streams.

## Changed files

- `backend/api/core/auto_cellularization.py` (new)
- `backend/api/index.py`
- `frontend/app/cellularization/page.js`

## Validation performed

- Python compilation succeeded.
- Backend route imported successfully in the reconstructed current project.
- Automated cellularization executed end-to-end against the bundled demo model using multiple candidate cell counts and paired simulation replications.
