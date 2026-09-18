from __future__ import annotations

from typing import Any
import math

from .candidate_generation import generate_cell_candidates
from .candidate_evaluation import evaluate_cell_candidates
from .model import ProcessModel


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _value(row: dict[str, Any], path: tuple[str, ...], default: float = float("inf")) -> float:
    cur: Any = row
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return float(cur) if _finite(cur) else default


def _objective_vector(row: dict[str, Any]) -> dict[str, float]:
    """All objectives are represented as minimization objectives."""
    throughput = _value(row, ("cellular_controlled_overflow", "metrics", "throughput_per_hour"), 0.0)
    return {
        "structural_score": _value(row, ("structural_analysis", "score", "decision_support_score")),
        "mean_cycle_minutes": _value(row, ("cellular_controlled_overflow", "metrics", "mean_cycle_minutes")),
        "p95_cycle_minutes": _value(row, ("cellular_controlled_overflow", "metrics", "p95_cycle_minutes")),
        "negative_throughput": -throughput,
        "overflow_fraction": _value(row, ("overflow", "mean_fraction")),
        "workload_cv": _value(row, ("structural_analysis", "balance", "workload_cv")),
    }


def _dominates(a: dict[str, float], b: dict[str, float], eps: float = 1e-9) -> bool:
    keys = tuple(a.keys())
    no_worse = all(a[k] <= b[k] + eps for k in keys)
    strictly_better = any(a[k] < b[k] - eps for k in keys)
    return no_worse and strictly_better


def _pareto_ids(rows: list[dict[str, Any]]) -> list[str]:
    vectors = {str(row.get("id")): _objective_vector(row) for row in rows}
    ids = list(vectors)
    frontier: list[str] = []
    for cid in ids:
        if not any(other != cid and _dominates(vectors[other], vectors[cid]) for other in ids):
            frontier.append(cid)
    return frontier


def _normalize(values: list[float], value: float) -> float:
    finite_values = [v for v in values if _finite(v)]
    if not finite_values or not _finite(value):
        return 1.0
    lo, hi = min(finite_values), max(finite_values)
    if hi - lo <= 1e-12:
        return 0.0
    return (value - lo) / (hi - lo)


def _label_frontier(rows: list[dict[str, Any]], frontier_ids: list[str]) -> list[dict[str, Any]]:
    frontier = [r for r in rows if str(r.get("id")) in set(frontier_ids)]
    if not frontier:
        return []

    labels: list[dict[str, Any]] = []

    localization = min(
        frontier,
        key=lambda r: (
            _value(r, ("structural_analysis", "score", "decision_support_score")),
            _value(r, ("cellular_controlled_overflow", "metrics", "mean_cycle_minutes")),
        ),
    )
    labels.append({
        "role": "maximum_localization",
        "label": "Maximum localization",
        "candidate_id": localization.get("id"),
        "explanation": "Pareto candidate with the lowest structural decision-support score under the selected weights.",
    })

    min_k = min(int(r.get("k") or 9999) for r in frontier)
    pooling_group = [r for r in frontier if int(r.get("k") or 9999) == min_k]
    pooling = min(
        pooling_group,
        key=lambda r: (
            _value(r, ("overflow", "mean_fraction")),
            _value(r, ("cellular_controlled_overflow", "metrics", "mean_cycle_minutes")),
        ),
    )
    if pooling.get("id") != localization.get("id") or len(frontier) == 1:
        labels.append({
            "role": "maximum_pooling",
            "label": "Greater pooling / fewer cells",
            "candidate_id": pooling.get("id"),
            "explanation": "Pareto candidate with the fewest cells; ties favor lower realized overflow and then lower mean cycle time.",
        })

    # Equal-weight distance to the observed ideal point. This is a transparent tradeoff marker,
    # not a claim of optimality.
    vectors = {str(r.get("id")): _objective_vector(r) for r in frontier}
    keys = list(next(iter(vectors.values())).keys())
    values_by_key = {k: [vectors[cid][k] for cid in vectors] for k in keys}
    def distance(row: dict[str, Any]) -> float:
        v = vectors[str(row.get("id"))]
        return math.sqrt(sum(_normalize(values_by_key[k], v[k]) ** 2 for k in keys) / len(keys))
    balanced = min(frontier, key=distance)
    if not any(x["candidate_id"] == balanced.get("id") for x in labels):
        labels.append({
            "role": "balanced",
            "label": "Balanced tradeoff",
            "candidate_id": balanced.get("id"),
            "explanation": "Pareto candidate closest to the observed ideal after equal-weight normalization of the displayed structural and operational objectives; this is a tradeoff marker, not a unique optimum.",
        })

    return labels


def _default_k_values(model: ProcessModel, architecture_id: str) -> list[int]:
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        raise ValueError(f"Unknown architecture '{architecture_id}'.")
    enabled = list(arch.enabled_activities or [a.id for a in model.activities])
    n = len(enabled)
    if n < 2:
        raise ValueError("Automated cellularization requires at least two enabled activities.")
    # Grow the search range with process size without immediately exploding the simulation burden.
    k_max = min(6, n, max(2, int(round(math.sqrt(n))) + 1))
    return list(range(2, k_max + 1))


def _simulation_blockers(model: ProcessModel, architecture_id: str) -> list[dict[str, str]]:
    """Return known service-time blockers before Stage 2 simulation starts."""
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        return [{"activity_id": "", "activity_name": "", "reason": f"Unknown architecture '{architecture_id}'."}]
    enabled = set(arch.enabled_activities or [a.id for a in model.activities])
    amap = model.activity_map()
    blockers: list[dict[str, str]] = []
    for aid in enabled:
        act = amap.get(aid)
        if act is None:
            blockers.append({"activity_id": aid, "activity_name": aid, "reason": "Activity is enabled in the architecture but missing from the model."})
            continue
        if getattr(act, "terminal", False):
            continue
        st = act.service_time
        if st.distribution == "unresolved":
            blockers.append({
                "activity_id": act.id,
                "activity_name": act.name,
                "reason": "Unresolved service-time distribution.",
            })
        elif st.distribution == "borrowed":
            source = st.source_activity_id
            if not source or source not in amap:
                blockers.append({
                    "activity_id": act.id,
                    "activity_name": act.name,
                    "reason": "Borrowed distribution has no valid source activity.",
                })
    return blockers


def run_automated_cellularization(
    model: ProcessModel,
    architecture_id: str,
    *,
    k_values: list[int] | None = None,
    structural_weights: dict[str, float] | None = None,
    cases: int = 400,
    seed: int = 1700,
    replications: int = 4,
    local_wait_threshold_minutes: float = 30.0,
    max_overflow_fraction: float = 1.0,
    utilization_ceiling: float = 0.95,
) -> dict[str, Any]:
    selected_k = k_values or _default_k_values(model, architecture_id)
    generated = generate_cell_candidates(
        model,
        architecture_id,
        k_values=selected_k,
        structural_weights=structural_weights,
    )
    blockers = _simulation_blockers(model, architecture_id)
    if blockers:
        candidates = generated.get("candidates") or []
        return {
            "architecture_id": architecture_id,
            "mode": "decision_support",
            "k_values": selected_k,
            "candidate_count": len(candidates),
            "pareto_count": 0,
            "pareto_candidate_ids": [],
            "tradeoff_labels": [],
            "utilization_ceiling": min(1.0, max(0.0, float(utilization_ceiling))),
            "generation": {
                "candidate_count": generated.get("candidate_count", len(candidates)),
                "notes": generated.get("notes", []),
            },
            "simulation_blocked": True,
            "blocking_activities": blockers,
            "candidates": candidates,
            "notes": [
                "Stage 1 candidate generation completed successfully.",
                "Stage 2 simulation was not run because one or more enabled activities do not yet have usable service-time models.",
                "Resolve the listed activities, then rerun Automated Cellularization. The structural candidates are still available for inspection and loading into the editor.",
            ],
        }

    evaluated = evaluate_cell_candidates(
        model,
        architecture_id,
        generated.get("candidates") or [],
        structural_weights=structural_weights,
        cases=cases,
        seed=seed,
        replications=replications,
        local_wait_threshold_minutes=local_wait_threshold_minutes,
        max_overflow_fraction=max_overflow_fraction,
    )

    rows = evaluated.get("candidates") or []
    frontier_ids = _pareto_ids(rows)
    ceiling = min(1.0, max(0.0, float(utilization_ceiling)))
    for row in rows:
        max_util = _value(row, ("cellular_controlled_overflow", "metrics", "max_resource_utilization"))
        skill_coverage = _value(row, ("structural_analysis", "resource_fit", "skill_coverage_fraction"), 1.0)
        row["pareto_frontier"] = str(row.get("id")) in set(frontier_ids)
        row["capacity_guardrail_met"] = bool(max_util <= ceiling + 1e-12)
        row["skill_coverage_guardrail_met"] = bool(skill_coverage >= 0.999999)

    labels = _label_frontier(rows, frontier_ids)
    return {
        "architecture_id": architecture_id,
        "mode": "decision_support",
        "k_values": selected_k,
        "candidate_count": len(rows),
        "pareto_count": len(frontier_ids),
        "pareto_candidate_ids": frontier_ids,
        "tradeoff_labels": labels,
        "utilization_ceiling": ceiling,
        "generation": {
            "candidate_count": generated.get("candidate_count", 0),
            "notes": generated.get("notes", []),
        },
        "global": evaluated.get("global"),
        "overflow_policy": evaluated.get("overflow_policy"),
        "cases_per_replication": evaluated.get("cases_per_replication"),
        "replications": evaluated.get("replications"),
        "seeds": evaluated.get("seeds"),
        "candidates": rows,
        "notes": [
            "Automated cellularization is decision support, not a black-box optimizer.",
            "Stage 1 generates structurally coherent alternatives across several cell counts; Stage 2 evaluates every alternative with paired simulation using the same stochastic inputs and seeds.",
            "Pareto membership means that no other generated candidate is simultaneously no worse on all selected structural/operational objectives and strictly better on at least one.",
            "Tradeoff labels summarize different parts of the Pareto set and do not constitute an operational optimum or mandatory recommendation.",
            "A candidate may be Pareto-efficient while still violating the utilization guardrail; capacity guardrails are shown separately rather than hidden inside the structural score.",
        ],
    }
