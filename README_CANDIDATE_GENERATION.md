# Automated Cellularization — Candidate Generation Increment

This increment adds Stage 1 decision-support candidate generation without running simulation or selecting a winner.

## What it adds

- Generates structurally coherent 2-cell and 3-cell alternatives.
- Attempts three deterministic similarity profiles:
  - balanced routing/topology/processing/resource similarity;
  - routing/topology emphasis;
  - processing-character emphasis.
- Removes duplicate partitions.
- Partitions existing baseline resource capacity without duplication.
- Scores every candidate with the existing configurable structural-analysis weights.
- Explains why each proposed cell was formed.
- Lets the user load any candidate into the existing editable manual cell editor.
- Does **not** automatically recommend a candidate and does **not** run simulation at this stage.

## UI cleanup

The configurable structural weights are displayed as separate bordered controls for clearer readability.

## New API

`POST /api/cellularization/generate-candidates`

Payload uses the current ProcessModel, architecture id, requested `k_values`, and structural weights.

## Validation performed

- Python compilation passed for `candidate_generation.py` and `index.py`.
- FastAPI import passed and the new route is registered.
- Candidate generation executed against the bundled demo model for k=2 and k=3.
- The backend generated distinct candidates and existing structural analysis scored each candidate.

A full Next.js build was not run in this environment because the required frontend node modules are not installed here.
