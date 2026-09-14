v0.13.1 — Hybrid Process Modeling

Changes:
1. Activities now carry explicit model provenance, confidence, and terminal/milestone status.
2. Missing duration observations are marked unresolved instead of silently receiving a fallback service-time model.
3. The activity editor lets the user resolve an uninstrumented step as:
   - triangular SME estimate (minimum / most likely / maximum),
   - manual observed sample with empirical bootstrap,
   - borrowed distribution from a similar activity with a time multiplier,
   - fixed duration,
   - terminal / milestone.
4. New manually inserted activities start as unresolved so the process owner must define their behavior explicitly.
5. The DES supports triangular, empirical-bootstrap, and borrowed service-time models and blocks unresolved activities with an actionable error.
6. Event-log calibration reports per-activity duration-observation counts, modeling source, simulation distribution, and confidence.
7. The calibrated AS-IS panel highlights unresolved activities before simulation/optimization.
8. API version updated to 0.13.1.

The DOE, evolving-SVD/null-space optimization, architecture-family search, replicated robustness methodology, and v0.13 interactive design-studio features are unchanged.
