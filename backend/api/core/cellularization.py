from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from statistics import mean
from typing import Any

import numpy as np

from .model import ProcessModel, ResourcePool, StaffingInterval
from .simulation import simulate


PHASE1_METRICS = [
    "throughput_per_hour",
    "realized_arrival_rate_per_hour",
    "mean_cycle_minutes",
    "median_cycle_minutes",
    "p95_cycle_minutes",
    "sla_attainment",
    "avg_wip",
    "annual_cost",
    "backlog_growth_per_hour",
    "max_resource_utilization",
]


def _enabled_activity_ids(model: ProcessModel, architecture_id: str) -> list[str]:
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        raise ValueError(f"Unknown architecture '{architecture_id}'.")
    return list(arch.enabled_activities or [a.id for a in model.activities])


def validate_phase1_cells(model: ProcessModel, architecture_id: str) -> dict[str, Any]:
    if not model.cells:
        raise ValueError("No cell definitions are saved in the current model.")

    if model.agents:
        raise ValueError(
            "Phase 1 no-overflow comparison currently requires pooled resources. "
            "This model contains individual resource agents; individual-to-cell assignment "
            "will be added before enabling this experiment for agent-level models."
        )

    enabled = set(_enabled_activity_ids(model, architecture_id))
    assignments: dict[str, list[str]] = defaultdict(list)
    for cell in model.cells:
        for aid in cell.activity_ids:
            if aid in enabled:
                assignments[aid].append(cell.id)

    unassigned = sorted(aid for aid in enabled if len(assignments.get(aid, [])) == 0)
    duplicated = sorted(aid for aid in enabled if len(assignments.get(aid, [])) > 1)
    if unassigned:
        raise ValueError(
            "Every enabled activity must belong to exactly one cell. Unassigned: "
            + ", ".join(unassigned)
        )
    if duplicated:
        raise ValueError(
            "Every enabled activity must belong to exactly one cell. Assigned to multiple cells: "
            + ", ".join(duplicated)
        )

    capacity_totals: dict[str, int] = defaultdict(int)
    for cell in model.cells:
        for rid, value in cell.resource_capacities.items():
            n = int(value or 0)
            if n < 0:
                raise ValueError(f"Cell '{cell.name}' has a negative capacity allocation for '{rid}'.")
            capacity_totals[rid] += n

    mismatches = []
    for resource in model.resources:
        allocated = int(capacity_totals.get(resource.id, 0))
        baseline = int(resource.capacity)
        if allocated != baseline:
            mismatches.append(f"{resource.name or resource.id}: {allocated}/{baseline}")
    if mismatches:
        raise ValueError(
            "Phase 1 requires exact partitioning of baseline resource capacity across cells. "
            "Fix: " + "; ".join(mismatches)
        )

    activity_to_cell = {aid: assignments[aid][0] for aid in enabled}
    return {
        "enabled_activity_ids": sorted(enabled),
        "activity_to_cell": activity_to_cell,
        "capacity_totals": dict(capacity_totals),
    }


def _split_staffing_profiles(model: ProcessModel) -> dict[tuple[str, str], list[StaffingInterval]]:
    """Split each time-varying resource profile across cells without creating capacity.

    Largest-remainder allocation is performed independently for each staffing interval,
    preserving the original total staffed capacity at every interval.
    """
    out: dict[tuple[str, str], list[StaffingInterval]] = defaultdict(list)
    cell_map = {c.id: c for c in model.cells}

    for resource in model.resources:
        if not resource.staffing_profile:
            continue
        allocs = [
            (c.id, max(0, int(c.resource_capacities.get(resource.id, 0))))
            for c in model.cells
        ]
        baseline = max(1, int(resource.capacity))
        for iv in resource.staffing_profile:
            staffed = max(0, int(iv.capacity))
            exact = [(cid, staffed * alloc / baseline) for cid, alloc in allocs]
            floors = {cid: int(np.floor(x)) for cid, x in exact}
            remainder = staffed - sum(floors.values())
            order = sorted(exact, key=lambda x: (x[1] - np.floor(x[1]), x[0]), reverse=True)
            for cid, _ in order[:max(0, remainder)]:
                floors[cid] += 1
            for cid, _ in allocs:
                out[(resource.id, cid)].append(
                    StaffingInterval(
                        start_minute=iv.start_minute,
                        end_minute=iv.end_minute,
                        capacity=floors[cid],
                        label=iv.label,
                    )
                )
    return out


def build_cellular_no_overflow_model(model: ProcessModel, architecture_id: str) -> tuple[ProcessModel, dict[str, Any]]:
    validation = validate_phase1_cells(model, architecture_id)
    activity_to_cell = validation["activity_to_cell"]
    original_resource_map = model.resource_map()
    profile_splits = _split_staffing_profiles(model)

    cloned = model.model_copy(deep=True)
    cloned.agents = []

    # Preserve original hourly cost even for models where the resource-pool cost
    # was inferred from activities rather than explicitly stored on the pool.
    fallback_cost: dict[str, float] = {}
    for resource in model.resources:
        costs = [float(a.cost_per_hour) for a in model.activities if a.resource_pool == resource.id]
        fallback_cost[resource.id] = float(mean(costs)) if costs else 75.0

    synthetic_resources: list[ResourcePool] = []
    synthetic_for: dict[tuple[str, str], str] = {}
    for cell in model.cells:
        for resource in model.resources:
            alloc = max(0, int(cell.resource_capacities.get(resource.id, 0)))
            if alloc <= 0:
                continue
            sid = f"{resource.id}__cell__{cell.id}"
            synthetic_for[(resource.id, cell.id)] = sid
            synthetic_resources.append(
                ResourcePool(
                    id=sid,
                    name=f"{resource.name} · {cell.name}",
                    capacity=alloc,
                    cost_per_hour=(
                        float(resource.cost_per_hour)
                        if resource.cost_per_hour is not None
                        else fallback_cost[resource.id]
                    ),
                    skills=list(resource.skills or []),
                    staffing_profile=profile_splits.get((resource.id, cell.id), []),
                )
            )
    cloned.resources = synthetic_resources

    for activity in cloned.activities:
        if activity.id not in activity_to_cell:
            continue
        cell_id = activity_to_cell[activity.id]
        original_activity = model.activity_map()[activity.id]

        # Terminal/unresourced milestones require no cell-local resource.
        if original_activity.terminal or not original_activity.resource_pool and not original_activity.required_skills and not original_activity.eligible_resource_pools:
            activity.resource_pool = None
            activity.eligible_resource_pools = []
            continue

        required = set(original_activity.required_skills or [])
        explicit_original = set(original_activity.eligible_resource_pools or [])
        eligible_local: list[str] = []
        for resource in model.resources:
            sid = synthetic_for.get((resource.id, cell_id))
            if not sid:
                continue
            if explicit_original and resource.id not in explicit_original:
                continue
            if required and not required.issubset(set(resource.skills or [])):
                continue
            if not required and not explicit_original and original_activity.resource_pool and resource.id != original_activity.resource_pool:
                continue
            eligible_local.append(sid)

        primary = synthetic_for.get((original_activity.resource_pool, cell_id)) if original_activity.resource_pool else None
        if primary and primary not in eligible_local:
            resource = original_resource_map.get(original_activity.resource_pool)
            if resource and (not required or required.issubset(set(resource.skills or []))):
                eligible_local.insert(0, primary)

        if not eligible_local:
            raise ValueError(
                f"Cell '{cell_id}' has no eligible local resource capacity for activity "
                f"'{original_activity.name}'."
            )

        activity.resource_pool = primary or eligible_local[0]
        activity.eligible_resource_pools = eligible_local
        if len(eligible_local) > 1 or required:
            activity.routing_policy = "earliest_available_skill"
        else:
            activity.routing_policy = "fixed_pool"

    return cloned, validation


def _mean_metrics(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    return {
        metric: float(np.mean([float(r[metric]) for r in rows]))
        for metric in PHASE1_METRICS
    }


def run_phase1_paired_comparison(
    model: ProcessModel,
    architecture_id: str,
    *,
    cases: int = 1200,
    seed: int = 700,
    replications: int = 12,
) -> dict[str, Any]:
    cellular_model, validation = build_cellular_no_overflow_model(model, architecture_id)
    replications = max(1, int(replications))
    cases = max(100, int(cases))
    seeds = [int(seed) + i for i in range(replications)]

    global_rows: list[dict[str, float]] = []
    cellular_rows: list[dict[str, float]] = []
    paired_deltas: dict[str, list[float]] = {m: [] for m in PHASE1_METRICS}

    for s in seeds:
        global_out = simulate(
            model,
            architecture_id,
            {},
            cases=cases,
            seed=s,
            emit_log=False,
        )
        cellular_out = simulate(
            cellular_model,
            architecture_id,
            {},
            cases=cases,
            seed=s,
            emit_log=False,
        )
        gm = {m: float(global_out["metrics"][m]) for m in PHASE1_METRICS}
        cm = {m: float(cellular_out["metrics"][m]) for m in PHASE1_METRICS}
        global_rows.append(gm)
        cellular_rows.append(cm)
        for m in PHASE1_METRICS:
            paired_deltas[m].append(cm[m] - gm[m])

    global_mean = _mean_metrics(global_rows)
    cellular_mean = _mean_metrics(cellular_rows)
    delta_mean = {m: float(np.mean(v)) for m, v in paired_deltas.items()}
    delta_std = {
        m: float(np.std(v, ddof=1)) if len(v) > 1 else 0.0
        for m, v in paired_deltas.items()
    }

    cell_resource_ids: dict[str, list[str]] = defaultdict(list)
    for resource in cellular_model.resources:
        if "__cell__" in resource.id:
            _, cell_id = resource.id.split("__cell__", 1)
            cell_resource_ids[cell_id].append(resource.id)

    return {
        "architecture_id": architecture_id,
        "cases_per_replication": cases,
        "replications": replications,
        "seeds": seeds,
        "validation": validation,
        "global": {"metrics": global_mean},
        "cellular_no_overflow": {"metrics": cellular_mean},
        "paired_delta_cellular_minus_global": {
            "mean": delta_mean,
            "std": delta_std,
        },
        "cells": [
            {
                "id": cell.id,
                "name": cell.name,
                "activity_ids": list(cell.activity_ids),
                "resource_capacities": dict(cell.resource_capacities),
                "synthetic_resource_ids": cell_resource_ids.get(cell.id, []),
            }
            for cell in model.cells
        ],
    }
