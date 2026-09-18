# Automated Cellularization — service-time preflight fix

This increment changes Automated Cellularization so unresolved service-time data no longer causes the entire workflow to fail.

- Stage 1 structural candidate generation still runs.
- Before Stage 2 simulation, the backend checks enabled activities for unresolved service-time models and invalid borrowed-distribution references.
- If blockers exist, the API returns the generated structural candidates plus an explicit `simulation_blocked` state and a list of blocking activities.
- The frontend shows those activities and still allows any generated candidate to be loaded into the editable cell editor.
- No synthetic or guessed service-time distribution is introduced.
- After the user resolves the activity timing model, rerunning Automated Cellularization proceeds to paired simulation and Pareto screening normally.
