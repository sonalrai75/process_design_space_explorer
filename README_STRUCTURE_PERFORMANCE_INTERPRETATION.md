# Structure ↔ Performance Interpretation

Frontend-only increment for the Cellularization workspace.

Adds a decision-support interpretation panel that appears after both:

1. Cell Structural Analysis has been run, and
2. Phase 2 Controlled Overflow comparison has been run.

The panel connects structural evidence with paired simulation evidence without treating the structural score as an operational optimum or claiming causality.

It reports:
- workload balance, skill coverage, cross-cell routing, available entropy reduction, and pooling-loss signals;
- controlled-overflow changes versus global pooling for throughput, mean/P95 cycle time, WIP, backlog growth, utilization, and realized overflow;
- whether the current pattern is consistent with local structure plus selective pooling being complementary;
- interpretation limits, including high utilization, low SLA attainment, and unavailable work-type/skill entropy.

No backend, simulator, optimizer, structural-analysis mathematics, or experiment mathematics are changed.
