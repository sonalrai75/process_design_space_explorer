# Overflow-threshold sensitivity increment

This increment is frontend-only and builds on the existing Phase 2 controlled-overflow endpoint.

It adds a sensitivity experiment on the Cellularization page using thresholds:
- 0 minutes
- 15 minutes
- 30 minutes
- 60 minutes
- 120 minutes
- effectively infinite (displayed as No overflow)

Each threshold is run with the same cases, seeds, replication count, current cell design, and maximum overflow-share setting. Results compare throughput, mean cycle time, P95 cycle time, WIP, backlog growth, maximum resource utilization, and realized overflow share.

The table highlights a preferred threshold as the lowest mean-cycle threshold among those with maximum resource utilization <= 95%. If none meet that screen, it reports the lowest mean-cycle threshold overall.

No backend, simulator, optimizer, Phase 1, Phase 2, or Phase 3 code is changed.
