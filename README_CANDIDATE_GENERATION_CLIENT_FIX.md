# Candidate Generation Client Fix

Fixes a client-side crash in the Cellularization page caused by `finite` being referenced inside `CandidateDesignsPanel` without being defined in that component scope.

No backend, simulation, candidate-generation, structural-analysis, or optimization logic is changed.
