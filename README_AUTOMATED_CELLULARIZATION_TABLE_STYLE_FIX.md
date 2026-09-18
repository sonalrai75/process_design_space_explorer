# Automated Cellularization table-style scope fix

Fixes the client-side crash `ReferenceError: th is not defined` in the automated cellularization and candidate evaluation tables.

The table header/cell style objects (`th` and `td`) are now defined at module scope so every result-table component can access them. No simulation, candidate generation, scoring, or backend logic is changed.
