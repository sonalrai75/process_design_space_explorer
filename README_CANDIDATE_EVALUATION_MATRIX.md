# Candidate Evaluation Matrix

Stage 2 of automated cellularization decision support.

- Evaluates every generated candidate with the same stochastic baseline, cases, and random-number seeds.
- Runs each candidate as Cellular / No Overflow and Cellular / Controlled Overflow.
- Uses one common Global baseline for every candidate.
- Controlled-overflow evaluation enables symmetric receiving across generated cells while preserving the exact candidate capacity partition.
- Shows structural score, routing localization, workload balance, throughput, cycle time, P95, WIP, SLA, utilization, backlog, overflow share, and overflow wait savings.
- Does not select or rank a winner.
- General waiting time is not shown because the current baseline simulator does not emit that metric.
