# Correct max-util fix

The previous patch accidentally replaced the valid `max_util` return in `calculate_structural_capacity()` instead of the undefined `max_util` at the end of `_replicated_robustness()`.

This corrected file:
- restores `calculate_structural_capacity()` to return its local `max_util`
- changes only `_replicated_robustness()` to return the worst observed replicated utilization from `max_util_values`
