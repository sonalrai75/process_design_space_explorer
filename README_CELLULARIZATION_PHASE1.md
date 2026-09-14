# Cellularization & Scheduling Experiments — Phase 1

Phase 1 extends the existing Process Design Space Explorer without creating a second simulator.

Implemented:
- Manual cell definitions.
- Activity-to-cell assignments.
- Resource-pool capacity allocation across cells.
- Work type / transaction type to preferred-cell assignment.
- Optional cell capacity limit validation.
- Operating modes:
  - Global Pooling + FCFS
  - Cellular / No Overflow + FCFS
- Common-random-number paired experiment runs.
- Metrics:
  - mean, median and P95 cycle time
  - mean waiting time
  - WIP
  - throughput
  - SLA attainment
  - max resource utilization
  - cell utilization
  - cell mean waiting time
  - average queue length by cell
  - bottleneck resource
  - bottleneck cell

Important modeling behavior:
- Process architecture/routing remains unchanged.
- Service-time distributions, demand, skills, resources and seeds are unchanged between scenarios.
- Resource capacity is partitioned across cells; the experiment validator requires the cell allocations to sum to the existing resource-pool capacity for a like-for-like comparison.
- Activities may be assigned to multiple cells.
- Cellular / No Overflow restricts each work item to the resources allocated to its preferred cell.
- Global Pooling ignores preferred cells and uses all eligible resources.
- No artificial penalty is applied to global pooling or to cellularization.

Not implemented until later phases:
- Controlled overflow.
- rho flexibility/localization parameter.
- SPT, EDD, SLA-risk or weighted scheduling.
- Feedback-loop/rework propagation model.
- Optimization of cell composition.
