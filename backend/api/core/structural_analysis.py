from __future__ import annotations

from collections import defaultdict
from math import log2
from typing import Any

import numpy as np

from .model import ProcessModel


DEFAULT_WEIGHTS = {
    "work_type_entropy": 1.0,
    "routing_entropy": 1.0,
    "skill_entropy": 1.0,
    "activity_entropy": 1.0,
    "processing_entropy": 0.5,
    "fragmentation_penalty": 0.5,
    "capacity_imbalance_penalty": 0.75,
    "skill_duplication_penalty": 0.5,
    "pooling_loss_penalty": 0.75,
    "overflow_pressure_penalty": 1.0,
}


def _entropy(weights: dict[str, float]) -> float:
    vals = np.asarray([max(0.0, float(v)) for v in weights.values()], dtype=float)
    total = float(vals.sum())
    if total <= 0:
        return 0.0
    probs = vals[vals > 0] / total
    return float(-np.sum(probs * np.log2(probs)))


def _conditional_entropy(events: list[tuple[str, str, float]]) -> dict[str, float | None]:
    global_counts: dict[str, float] = defaultdict(float)
    group_counts: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    group_totals: dict[str, float] = defaultdict(float)
    total = 0.0

    for group, category, raw_weight in events:
        weight = max(0.0, float(raw_weight))
        if weight <= 0:
            continue
        global_counts[str(category)] += weight
        group_counts[str(group)][str(category)] += weight
        group_totals[str(group)] += weight
        total += weight

    if total <= 0 or not global_counts:
        return {
            "global_entropy_bits": None,
            "conditional_entropy_bits": None,
            "normalized_conditional_entropy": None,
            "entropy_reduction_fraction": None,
        }

    global_h = _entropy(global_counts)
    cond_h = 0.0
    for group, counts in group_counts.items():
        cond_h += (group_totals[group] / total) * _entropy(counts)

    normalized = 0.0 if global_h <= 1e-12 else min(1.0, max(0.0, cond_h / global_h))
    reduction = 1.0 - normalized
    return {
        "global_entropy_bits": float(global_h),
        "conditional_entropy_bits": float(cond_h),
        "normalized_conditional_entropy": float(normalized),
        "entropy_reduction_fraction": float(reduction),
    }


def _architecture(model: ProcessModel, architecture_id: str):
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        raise ValueError(f"Unknown architecture '{architecture_id}'.")
    return arch


def _activity_to_cell(model: ProcessModel, enabled_ids: set[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    duplicates: list[str] = []
    for cell in model.cells:
        for aid in cell.activity_ids:
            if aid not in enabled_ids:
                continue
            if aid in mapping and mapping[aid] != cell.id:
                duplicates.append(aid)
            else:
                mapping[aid] = cell.id
    missing = sorted(enabled_ids - set(mapping))
    if missing:
        raise ValueError("Structural analysis requires every enabled activity to belong to a cell. Unassigned: " + ", ".join(missing))
    if duplicates:
        raise ValueError("Structural analysis requires unique activity-to-cell assignment. Multi-cell: " + ", ".join(sorted(set(duplicates))))
    return mapping


def _transition_probabilities(arch, enabled: set[str]) -> dict[str, list[tuple[str, float]]]:
    outgoing: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for t in arch.transitions:
        if t.source in enabled and t.target in enabled:
            outgoing[t.source].append((t.target, max(0.0, float(t.probability))))
    normalized: dict[str, list[tuple[str, float]]] = {}
    for source, rows in outgoing.items():
        total = sum(p for _, p in rows)
        if total > 0:
            normalized[source] = [(target, p / total) for target, p in rows]
    return normalized


def _expected_visits(model: ProcessModel, arch, enabled: set[str]) -> dict[str, float]:
    ids = [a.id for a in model.activities if a.id in enabled]
    if not ids:
        return {}
    index = {aid: i for i, aid in enumerate(ids)}
    pmat = np.zeros((len(ids), len(ids)), dtype=float)
    outgoing = _transition_probabilities(arch, enabled)
    for source, rows in outgoing.items():
        i = index[source]
        for target, p in rows:
            pmat[i, index[target]] += p

    b = np.zeros(len(ids), dtype=float)
    start = model.start_activity if model.start_activity in index else ids[0]
    b[index[start]] = 1.0
    try:
        visits = np.linalg.solve(np.eye(len(ids)) - pmat.T, b)
        if not np.all(np.isfinite(visits)) or np.any(visits < -1e-8):
            raise np.linalg.LinAlgError("invalid expected visits")
        visits = np.maximum(visits, 0.0)
    except np.linalg.LinAlgError:
        # Safe fallback for unusual/non-absorbing graphs: truncated propagation.
        visits = np.zeros(len(ids), dtype=float)
        mass = b.copy()
        for _ in range(500):
            visits += mass
            mass = mass @ pmat
            if float(np.sum(mass)) < 1e-10:
                break
            if float(np.sum(visits)) > 1e7:
                break
    return {aid: float(visits[index[aid]]) for aid in ids}


def _processing_class_events(model: ProcessModel, enabled: set[str], activity_to_cell: dict[str, str], visits: dict[str, float]):
    rows = []
    values = []
    for a in model.activities:
        if a.id not in enabled or a.terminal:
            continue
        mean = float(a.service_time.mean_minutes or 0.0)
        if mean > 0 and visits.get(a.id, 0.0) > 0:
            values.append(mean)
            rows.append((a, mean))
    if not rows:
        return [], None

    q1, q2 = np.quantile(np.asarray(values, dtype=float), [1 / 3, 2 / 3]) if len(values) >= 3 else (min(values), max(values))

    events = []
    for a, mean in rows:
        if mean <= q1:
            cls = "short"
        elif mean <= q2:
            cls = "medium"
        else:
            cls = "long"
        events.append((activity_to_cell[a.id], cls, visits.get(a.id, 0.0)))
    return events, {"lower_tercile_minutes": float(q1), "upper_tercile_minutes": float(q2)}


def _resource_can_serve(activity, resource) -> bool:
    required = set(activity.required_skills or [])
    explicit = set(activity.eligible_resource_pools or [])
    if explicit and resource.id not in explicit:
        return False
    if required and not required.issubset(set(resource.skills or [])):
        return False
    if not required and not explicit and activity.resource_pool and resource.id != activity.resource_pool:
        return False
    return True


def analyze_cell_structure(
    model: ProcessModel,
    architecture_id: str,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    if not model.cells:
        raise ValueError("No cells are defined in the current model.")

    arch = _architecture(model, architecture_id)
    enabled = set(arch.enabled_activities or [a.id for a in model.activities])
    activity_to_cell = _activity_to_cell(model, enabled)
    visits = _expected_visits(model, arch, enabled)
    outgoing = _transition_probabilities(arch, enabled)
    activity_map = model.activity_map()

    activity_events = [
        (activity_to_cell[aid], aid, visits.get(aid, 0.0))
        for aid in enabled
        if visits.get(aid, 0.0) > 0
    ]

    routing_events: list[tuple[str, str, float]] = []
    cross_flow = 0.0
    transition_flow = 0.0
    for source, rows in outgoing.items():
        source_visits = visits.get(source, 0.0)
        for target, probability in rows:
            flow = source_visits * probability
            if flow <= 0:
                continue
            routing_events.append((activity_to_cell[source], target, flow))
            transition_flow += flow
            if activity_to_cell[source] != activity_to_cell[target]:
                cross_flow += flow

    skill_events: list[tuple[str, str, float]] = []
    for aid in enabled:
        a = activity_map[aid]
        skills = list(dict.fromkeys(a.required_skills or []))
        if not skills:
            continue
        weight_each = visits.get(aid, 0.0) / len(skills)
        for skill in skills:
            skill_events.append((activity_to_cell[aid], skill, weight_each))

    processing_events, processing_bins = _processing_class_events(model, enabled, activity_to_cell, visits)

    work_type_events: list[tuple[str, str, float]] = []
    cell_work_types: dict[str, str] = {}
    for cell in model.cells:
        for wid in cell.preferred_work_types or []:
            cell_work_types[wid] = cell.id
    for wt in model.work_types:
        cell_id = wt.preferred_cell_id or cell_work_types.get(wt.id)
        if cell_id and any(c.id == cell_id for c in model.cells):
            work_type_events.append((cell_id, wt.id, max(0.0, float(wt.probability))))

    entropy_metrics = {
        "work_type": _conditional_entropy(work_type_events),
        "routing": _conditional_entropy(routing_events),
        "skill": _conditional_entropy(skill_events),
        "activity": _conditional_entropy(activity_events),
        "processing": _conditional_entropy(processing_events),
    }

    cell_rows = []
    demand_by_cell: dict[str, float] = defaultdict(float)
    capacity_by_cell: dict[str, float] = defaultdict(float)
    weighted_covered = 0.0
    weighted_required = 0.0
    uncovered_details: list[dict[str, str]] = []

    for cell in model.cells:
        for rid, cap in (cell.resource_capacities or {}).items():
            capacity_by_cell[cell.id] += max(0.0, float(cap)) * 60.0

    for aid in enabled:
        a = activity_map[aid]
        if a.terminal:
            continue
        cell_id = activity_to_cell[aid]
        activity_weight = max(0.0, visits.get(aid, 0.0))
        service_mean = max(0.0, float(a.service_time.mean_minutes or 0.0))
        demand_by_cell[cell_id] += float(model.arrival_rate_per_hour) * activity_weight * service_mean

        if not (a.resource_pool or a.required_skills or a.eligible_resource_pools):
            continue
        weighted_required += activity_weight
        cell = next(c for c in model.cells if c.id == cell_id)
        eligible = [
            r for r in model.resources
            if max(0, int(cell.resource_capacities.get(r.id, 0))) > 0 and _resource_can_serve(a, r)
        ]
        if eligible:
            weighted_covered += activity_weight
        else:
            uncovered_details.append({"activity_id": a.id, "activity": a.name, "cell_id": cell_id})

    loads = []
    total_demand = sum(demand_by_cell.values())
    overflow_pressure = 0.0
    for cell in model.cells:
        demand = float(demand_by_cell.get(cell.id, 0.0))
        capacity = float(capacity_by_cell.get(cell.id, 0.0))
        utilization_proxy = demand / capacity if capacity > 0 else (float("inf") if demand > 0 else 0.0)
        if np.isfinite(utilization_proxy):
            loads.append(demand)
            pressure = min(1.0, max(0.0, (utilization_proxy - 0.85) / 0.15))
        else:
            loads.append(demand)
            pressure = 1.0
        if total_demand > 0:
            overflow_pressure += (demand / total_demand) * pressure
        cell_rows.append({
            "cell_id": cell.id,
            "cell_name": cell.name,
            "activity_count": int(sum(1 for aid in enabled if activity_to_cell[aid] == cell.id)),
            "expected_service_demand_minutes_per_hour": demand,
            "assigned_capacity_minutes_per_hour": capacity,
            "structural_utilization_proxy": None if not np.isfinite(utilization_proxy) else float(utilization_proxy),
        })

    mean_load = float(np.mean(loads)) if loads else 0.0
    load_cv = float(np.std(loads) / mean_load) if len(loads) > 1 and mean_load > 0 else 0.0
    capacity_imbalance_penalty = min(1.0, load_cv / 1.0)

    n_cells = len(model.cells)
    n_activities = max(1, len(enabled))
    fragmentation_penalty = 0.0 if n_activities <= 1 else min(1.0, max(0.0, (n_cells - 1) / (n_activities - 1)))
    small_cell_count = sum(1 for row in cell_rows if row["activity_count"] < 2 or (total_demand > 0 and row["expected_service_demand_minutes_per_hour"] / total_demand < 0.10))
    small_cell_fraction = small_cell_count / max(n_cells, 1)

    # Pooling-loss proxy: splitting the same baseline pool across more cells increases fragmentation.
    pool_weights = 0.0
    pool_loss_weighted = 0.0
    for r in model.resources:
        cap = max(0.0, float(r.capacity or 0))
        active_cells = sum(1 for c in model.cells if max(0, int(c.resource_capacities.get(r.id, 0))) > 0)
        if cap <= 0:
            continue
        pool_weights += cap
        if n_cells > 1:
            pool_loss_weighted += cap * max(0.0, (active_cells - 1) / (n_cells - 1))
    pooling_loss_penalty = pool_loss_weighted / pool_weights if pool_weights > 0 else 0.0

    # Scarce-skill duplication: a skill supplied by only one baseline resource pool but split across cells.
    all_required_skills = sorted({s for a in model.activities if a.id in enabled for s in (a.required_skills or [])})
    scarce_skill_details = []
    duplicated_scarce = 0
    for skill in all_required_skills:
        suppliers = [r for r in model.resources if skill in set(r.skills or [])]
        if len(suppliers) != 1:
            continue
        supplier = suppliers[0]
        placed = [c.id for c in model.cells if max(0, int(c.resource_capacities.get(supplier.id, 0))) > 0]
        if len(placed) > 1:
            duplicated_scarce += 1
            scarce_skill_details.append({"skill": skill, "resource_pool": supplier.name or supplier.id, "cell_count": len(placed)})
    scarce_skill_count = sum(1 for skill in all_required_skills if len([r for r in model.resources if skill in set(r.skills or [])]) == 1)
    skill_duplication_penalty = duplicated_scarce / scarce_skill_count if scarce_skill_count > 0 else 0.0

    skill_coverage = weighted_covered / weighted_required if weighted_required > 0 else None
    uncovered_fraction = 0.0 if skill_coverage is None else 1.0 - skill_coverage
    overflow_pressure = min(1.0, max(0.0, overflow_pressure + uncovered_fraction))

    weights_out = dict(DEFAULT_WEIGHTS)
    if weights:
        for key, value in weights.items():
            if key in weights_out:
                weights_out[key] = max(0.0, float(value))

    entropy_component_map = {
        "work_type_entropy": entropy_metrics["work_type"]["normalized_conditional_entropy"],
        "routing_entropy": entropy_metrics["routing"]["normalized_conditional_entropy"],
        "skill_entropy": entropy_metrics["skill"]["normalized_conditional_entropy"],
        "activity_entropy": entropy_metrics["activity"]["normalized_conditional_entropy"],
        "processing_entropy": entropy_metrics["processing"]["normalized_conditional_entropy"],
    }
    available_entropy = [(key, value) for key, value in entropy_component_map.items() if value is not None and weights_out[key] > 0]
    entropy_weight_sum = sum(weights_out[key] for key, _ in available_entropy)
    structural_complexity = (
        sum(weights_out[key] * float(value) for key, value in available_entropy) / entropy_weight_sum
        if entropy_weight_sum > 0 else None
    )

    penalties = {
        "fragmentation_penalty": float(fragmentation_penalty),
        "capacity_imbalance_penalty": float(capacity_imbalance_penalty),
        "skill_duplication_penalty": float(skill_duplication_penalty),
        "pooling_loss_penalty": float(pooling_loss_penalty),
        "overflow_pressure_penalty": float(overflow_pressure),
    }
    penalty_weight_sum = sum(weights_out[key] for key in penalties if weights_out[key] > 0)
    weighted_penalty = (
        sum(weights_out[key] * penalties[key] for key in penalties) / penalty_weight_sum
        if penalty_weight_sum > 0 else 0.0
    )

    decision_support_score = None
    if structural_complexity is not None:
        decision_support_score = 100.0 * (float(structural_complexity) + float(weighted_penalty))

    notes = []
    if not work_type_events:
        notes.append("Work-type entropy is unavailable because the current model does not map work types to cells with usable probabilities.")
    if not skill_events:
        notes.append("Skill entropy is unavailable because enabled activities do not contain explicit required-skill demand.")
    notes.append("The overflow-pressure value is a structural load/coverage proxy, not simulated overflow. Use the Phase 2 experiment for realized overflow performance.")
    notes.append("The decision-support score is lower-is-better and is not an operational optimum; simulation remains the arbiter of process performance.")

    return {
        "architecture_id": architecture_id,
        "cell_count": n_cells,
        "enabled_activity_count": len(enabled),
        "expected_visits_per_case": visits,
        "entropy": entropy_metrics,
        "processing_classes": processing_bins,
        "routing_localization": {
            "cross_cell_transition_fraction": float(cross_flow / transition_flow) if transition_flow > 0 else 0.0,
            "within_cell_transition_fraction": float(1.0 - cross_flow / transition_flow) if transition_flow > 0 else 1.0,
        },
        "resource_fit": {
            "skill_coverage_fraction": None if skill_coverage is None else float(skill_coverage),
            "uncovered_activities": uncovered_details,
            "scarce_skill_duplication_count": int(duplicated_scarce),
            "scarce_skill_count": int(scarce_skill_count),
            "scarce_skill_duplication_details": scarce_skill_details,
        },
        "balance": {
            "workload_cv": float(load_cv),
            "small_cell_count": int(small_cell_count),
            "small_cell_fraction": float(small_cell_fraction),
            "cells": cell_rows,
        },
        "penalties": penalties,
        "weights": weights_out,
        "score": {
            "weighted_structural_complexity": None if structural_complexity is None else float(structural_complexity),
            "weighted_penalty": float(weighted_penalty),
            "decision_support_score": None if decision_support_score is None else float(decision_support_score),
            "interpretation": "Lower is structurally cleaner under the selected weights. Do not treat this score as an operational optimum.",
        },
        "notes": notes,
    }
