# v0.13.3 — Node and Edge Statistical Inspector

Adds an on-demand Stats button to every process activity node and routing edge.

Activity Stats shows the observed duration histogram when observed points exist, plus:
n, mean, median, min, max, range, and sample standard deviation.

Edge Stats shows:
observed transition count, routing probability, and the handoff/wait-time
distribution where source end and target start timestamps are available,
with the same descriptive statistics.

If timestamps do not support an edge handoff distribution, the app reports
the count/probability and does not invent a delay distribution.

API version: 0.13.3
