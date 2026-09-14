# v0.13.4 — Editable Skill Matrix

Adds an on-demand Skill matrix to the Visual Process Modeler when the active model contains defined skills.
Rows are modeled resources/resource pools and columns are skills. Checkbox edits represent cross-training and immediately update the active model.
Activities with required skills have their eligible resource pools recalculated after each edit, so rerunning Simulation or Optimization evaluates the impact of the new cross-training configuration.

API version: 0.13.4
