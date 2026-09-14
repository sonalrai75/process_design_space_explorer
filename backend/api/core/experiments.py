from __future__ import annotations

from collections import Counter, defaultdict
import numpy as np

from .model import ProcessModel
from .simulation import simulate


PHASE1_SCENARIOS = [
    {
        "id": "global_fcfs",
        "name": "Global Pooling + FCFS",
        "operating_mode": "global",
        "scheduling_policy": "fcfs",
    },
    {
        "id": "cellular_no_overflow_fcfs",
        "name": "Cellular / No Overflow + FCFS",
        "operating_mode": "cellular_no_overflow",
        "scheduling_policy": "fcfs",
    },
]

SCALAR_METRICS = [
    "mean_cycle_minutes",
    "median_cycle_minutes",
    "p95_cycle_minutes",
    "mean_wait_minutes",
    "avg_wip",
    "throughput_per_hour",
    "sla_attainment",
    "max_resource_utilization",
    "backlog_growth_per_hour",
    "annual_cost",
]


def validate_phase1_cells(model: ProcessModel) -> list[str]:
    errors: list[str] = []
    if not model.cells:
        return ["Define at least one cell before running the cellular scenario."]

    cell_ids = {c.id for c in model.cells}
    activity_ids = {a.id for a in model.activities}
    resource_ids = {r.id for r in model.resources}

    allocated_by_resource: dict[str, int] = defaultdict(int)
    for cell in model.cells:
        if not cell.id.strip():
            errors.append("Every cell requires a Cell ID.")
        for aid in cell.activity_ids:
            if aid not in activity_ids:
                errors.append(f"Cell {cell.name}: unknown activity {aid}.")

        ids = set(cell.resource_ids or []) | set((cell.resource_capacities or {}).keys())
        cell_capacity = 0
        for rid in ids:
            if rid not in resource_ids:
                errors.append(f"Cell {cell.name}: unknown resource {rid}.")
                continue
            pool = next(r for r in model.resources if r.id == rid)
            alloc = (cell.resource_capacities or {}).get(rid)
            if alloc is None:
                alloc = int(pool.capacity)
            alloc = int(alloc)
            if alloc <= 0:
                errors.append(f"Cell {cell.name}: allocation for {rid} must be positive.")
                continue
            allocated_by_resource[rid] += alloc
            cell_capacity += alloc

        if cell.capacity_limit is not None and cell_capacity > int(cell.capacity_limit):
            errors.append(
                f"Cell {cell.name}: assigned capacity {cell_capacity} exceeds "
                f"the configured cell capacity limit {cell.capacity_limit}."
            )

    # Fair Phase 1 comparison: the cellular structure must partition the same
    # nominal resource capacity used by global pooling.
    for pool in model.resources:
        allocated = allocated_by_resource.get(pool.id, 0)
        if allocated != int(pool.capacity):
            errors.append(
                f"Resource pool {pool.name}: allocate exactly {pool.capacity} capacity units "
                f"across cells for a like-for-like comparison (currently {allocated})."
            )

    if not model.work_types:
        errors.append("Define at least one work type and assign it to a preferred cell.")
    else:
        total_prob = sum(max(0.0, float(w.probability)) for w in model.work_types)
        if total_prob <= 0:
            errors.append("Work-type probabilities must include at least one positive value.")
        for wt in model.work_types:
            preferred = wt.preferred_cell_id
            if not preferred:
                matches = [c.id for c in model.cells if wt.id in (c.preferred_work_types or [])]
                preferred = matches[0] if matches else None
            if not preferred:
                errors.append(f"Work type {wt.name} has no preferred cell.")
            elif preferred not in cell_ids:
                errors.append(f"Work type {wt.name} references unknown preferred cell {preferred}.")

    # For no-overflow, every resource-using activity needs a feasible local resource in
    # every cell that can receive work of a preferred type.
    preferred_cells = set()
    for wt in model.work_types:
        if wt.preferred_cell_id:
            preferred_cells.add(wt.preferred_cell_id)
        else:
            preferred_cells.update(c.id for c in model.cells if wt.id in (c.preferred_work_types or []))

    rmap = model.resource_map()
    for cid in preferred_cells:
        cell = next((c for c in model.cells if c.id == cid), None)
        if cell is None:
            continue
        local_ids = set(cell.resource_ids or []) | {
            rid for rid, cap in (cell.resource_capacities or {}).items() if int(cap) > 0
        }
        local_resources = [rmap[rid] for rid in local_ids if rid in rmap]
        for act in model.activities:
            needs_resource = bool(act.resource_pool or act.required_skills or act.eligible_resource_pools)
            if not needs_resource:
                continue
            if act.id not in cell.activity_ids:
                errors.append(f"Cell {cell.name}: activity {act.name} is not assigned to the cell.")
                continue
            required = set(act.required_skills or [])
            explicit = set(act.eligible_resource_pools or [])
            feasible = False
            for pool in local_resources:
                if explicit and pool.id not in explicit:
                    continue
                if required and not required.issubset(set(pool.skills or [])):
                    continue
                if not required and not explicit and act.resource_pool and pool.id != act.resource_pool:
                    continue
                feasible = True
                break
            if not feasible:
                errors.append(
                    f"Cell {cell.name}: no locally assigned resource is eligible for activity {act.name}."
                )
    return sorted(set(errors))


def _mean_dict(samples: list[dict[str, float]]) -> dict[str, float]:
    keys = sorted({k for d in samples for k in d})
    return {
        k: float(np.mean([float(d[k]) for d in samples if k in d]))
        for k in keys
        if any(k in d for d in samples)
    }


def run_phase1_experiment(
    model: ProcessModel,
    architecture_id: str,
    design: dict[str, float] | None = None,
    cases: int = 1200,
    replications: int = 12,
    seed_start: int = 4200,
) -> dict:
    errors = validate_phase1_cells(model)
    if errors:
        return {"ok": False, "validation_errors": errors, "scenarios": []}

    replications = max(2, int(replications))
    cases = max(100, int(cases))
    seeds = [int(seed_start) + i for i in range(replications)]
    scenario_results = []

    for scenario in PHASE1_SCENARIOS:
        metric_samples = defaultdict(list)
        resource_util_samples: dict[str, list[float]] = defaultdict(list)
        cell_util_samples: dict[str, list[float]] = defaultdict(list)
        cell_wait_samples: dict[str, list[float]] = defaultdict(list)
        cell_queue_samples: dict[str, list[float]] = defaultdict(list)
        bottleneck_resources = Counter()
        bottleneck_cells = Counter()

        for seed in seeds:
            out = simulate(
                model,
                architecture_id,
                design or {},
                cases=cases,
                seed=seed,
                emit_log=False,
                operating_mode=scenario["operating_mode"],
                scheduling_policy=scenario["scheduling_policy"],
            )
            for metric in SCALAR_METRICS:
                if metric in out["metrics"]:
                    metric_samples[metric].append(float(out["metrics"][metric]))
            for rs in out.get("resource_stats", []):
                resource_util_samples[rs["resource"]].append(float(rs.get("utilization", 0.0)))
            for cid, cs in out.get("cell_stats", {}).items():
                cell_util_samples[cid].append(float(cs.get("utilization", 0.0)))
                cell_wait_samples[cid].append(float(cs.get("mean_wait_minutes", 0.0)))
                cell_queue_samples[cid].append(float(cs.get("avg_queue_length", 0.0)))
            if out.get("bottleneck_resource"):
                bottleneck_resources[out["bottleneck_resource"]] += 1
            if out.get("bottleneck_cell"):
                bottleneck_cells[out["bottleneck_cell"]] += 1

        summary = {
            metric: float(np.mean(values))
            for metric, values in metric_samples.items()
            if values
        }
        spread = {
            metric: float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
            for metric, values in metric_samples.items()
            if values
        }
        scenario_results.append({
            **scenario,
            "replications": replications,
            "cases_per_replication": cases,
            "seed_start": int(seed_start),
            "metrics": summary,
            "metric_std": spread,
            "resource_utilization": {
                rid: float(np.mean(vals)) for rid, vals in resource_util_samples.items() if vals
            },
            "cell_utilization": {
                cid: float(np.mean(vals)) for cid, vals in cell_util_samples.items() if vals
            },
            "cell_mean_wait_minutes": {
                cid: float(np.mean(vals)) for cid, vals in cell_wait_samples.items() if vals
            },
            "cell_avg_queue_length": {
                cid: float(np.mean(vals)) for cid, vals in cell_queue_samples.items() if vals
            },
            "bottleneck_resource": bottleneck_resources.most_common(1)[0][0] if bottleneck_resources else None,
            "bottleneck_cell": bottleneck_cells.most_common(1)[0][0] if bottleneck_cells else None,
        })

    return {
        "ok": True,
        "phase": 1,
        "common_random_numbers": True,
        "seeds": seeds,
        "scenarios": scenario_results,
    }
