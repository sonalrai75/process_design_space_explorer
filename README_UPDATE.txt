Version 0.3 update

Replace these files in:
C:\projects\process_design_space_explorer

1. api\core\optimization.py
2. api\index.py
3. frontend\app\page.js

What changed:
- Added eq / ge / le constraint types
- Added demand / throughput stability analysis
- Added OVERLOADED / MARGINAL / STABLE classification
- Added explicit Phase 1 feasibility search
- Added Phase 2 null-space objective reduction
- Updated frontend to show stability and feasibility
- Default demo constraints:
    throughput >= 7.8/hr
    p95 cycle <= 600 min
    SLA >= 90%

After replacement, restart both backend and frontend.
