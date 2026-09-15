# Phase 2 — Controlled Overflow

This increment extends the stable Phase 1 cellularization comparison with controlled cross-cell overflow while preserving total baseline capacity.

## Behavior

- Local cell capacity is always preferred.
- Overflow is considered only when the best local start would wait longer than the configured threshold.
- Overflow can only go to cells explicitly marked **May receive overflow**.
- Remote capacity is used only if it starts the work earlier than the local option.
- An optional maximum overflow share limits the proportion of resource assignments that may overflow.
- No resource capacity is duplicated or added.
- Global, Cellular / No Overflow, and Cellular / Controlled Overflow use common random-number seeds for paired comparison.

## New reported measures

- controlled-overflow share
- mean overflow count per replication
- mean waiting time saved on overflowed assignments
- paired performance differences between Controlled Overflow and No Overflow

## Files changed

- `backend/api/core/simulation.py`
- `backend/api/core/cellularization.py`
- `backend/api/index.py`
- `frontend/app/cellularization/page.js`

Existing simulation calls remain backward compatible because the new `overflow_policy` argument is optional and defaults to disabled.
