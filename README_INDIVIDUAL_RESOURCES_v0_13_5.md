# v0.13.5 — Individual Resource Skill Modeling

Extends the editable skill matrix from resource-pool level to individual-resource level when an agent/resource roster is available.

## What changed
- Added `ResourceAgent` to the process model.
- Contact-center Excel import now converts `Agent_Skills` rows into individual modeled agents.
- Skill proficiency is retained when the workbook provides a `proficiency` column.
- If staffing capacity exceeds the number of named agents, explicit `Unspecified ...` staffing slots are created so all modeled FTEs can be viewed and cross-trained in the matrix.
- The skill matrix displays individual resources as rows and skills as columns when agents are present; otherwise it falls back to resource-pool rows.
- Individual skill assignments are editable.
- Proficiency is editable from 0.25 to 1.00 for each assigned skill.
- Activity eligible resource pools are recalculated from the individual roster after each edit.
- The DES allocates skill-constrained work to individual eligible agents rather than only to pooled capacity.
- Pool staffing profiles still determine how many individual slots are active in each interval.
- Lower proficiency increases service time for that individual resource; proficiency 1.00 is baseline.
- Simulation output now includes `agent_stats` with individual busy time and utilization.
- Structural-capacity screening now accounts for the count of skill-capable individual resources by pool.

API version: 0.13.5
