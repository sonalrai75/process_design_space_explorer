# Saved Cell Designs Workspace

Frontend-only increment for the Cellularization & Scheduling page.

## What it adds

- Save any generated cellularization candidate without first loading it.
- Save the current edited cell design under a user-entered name.
- Persist saved design snapshots in browser localStorage under `pds_saved_cell_designs`.
- Reload any saved design later as an editable copy.
- Load a saved design either exactly as stored or with overflow reception enabled for all cells.
- Delete saved snapshots independently of the currently loaded editor design.
- Generated candidate cards and automated-cellularization tables now expose separate **Load**, **Load + overflow**, and **Save** actions.

## Scope

This does not change backend simulation, candidate generation, Pareto screening, structural scoring, or resource allocation logic. Saved designs are browser-local snapshots and are not synchronized across devices.

## Changed files

- `frontend/app/cellularization/page.js`
- `README_SAVED_CELL_DESIGNS_WORKSPACE.md`
