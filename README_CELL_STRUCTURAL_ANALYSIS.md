# Cell Structural Analysis increment

This increment adds the first automated-cellularization decision-support layer without generating or changing cells.

## What it does

The Cellularization page now includes **Cell Structural Analysis** for the current manual cell design.

It evaluates:

- conditional work-type entropy when usable work-type-to-cell data exists;
- routing / next-activity entropy by source cell;
- required-skill entropy when activities contain explicit skill requirements;
- activity-pattern entropy;
- processing-characteristic entropy using service-time tercile classes;
- cross-cell routing fraction;
- skill coverage;
- cell workload / capacity structure;
- workload imbalance;
- small-cell incidence;
- scarce-skill duplication;
- resource-pooling loss;
- a structural overflow-pressure proxy.

The entropy components are normalized against their corresponding global entropy. Lower conditional entropy indicates that more operational variety has been localized within cells.

## Configurable weights

The UI exposes weights for each structural entropy component and each penalty. Setting a weight to zero excludes that component from the displayed decision-support score.

The score is intentionally labeled as a **decision-support score**, not an optimum. It is lower-is-better under the selected weights, but simulation remains the operational test.

## Important modeling behavior

- No cells are generated automatically in this increment.
- No cell assignments or resource allocations are changed by the analysis.
- No simulation, optimization, overflow, or scheduling behavior is changed.
- The overflow-pressure value is a structural proxy based on cell load pressure and coverage; realized overflow still comes from the Phase 2 simulation.
- Work-type entropy is reported as N/A if the current model does not contain a usable work-type-to-cell mapping.
- Skill entropy / skill coverage are reported as N/A where explicit activity skill demand is unavailable.

## Backend endpoint

`POST /api/cellularization/structural-analysis`

The request contains the current `ProcessModel`, the architecture id, and optional component weights.
