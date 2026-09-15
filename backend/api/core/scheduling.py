from __future__ import annotations

from collections import defaultdict
import heapq
import math
from typing import Any

import numpy as np

from .model import ProcessModel
from .simulation import _activity_service_minutes, _next_arrival_time
from .cellularization import (
    PHASE1_METRICS,
    build_cellular_no_overflow_model,
    build_cellular_controlled_overflow_model,
    validate_phase1_cells,
)

SCHEDULING_METRICS = PHASE1_METRICS + ["mean_wait_minutes"]


def _validate_scheduling_model(model: ProcessModel) -> None:
    if model.agents:
        raise ValueError(
            "Phase 3 scheduling currently supports pooled resources only. "
            "Individual-agent scheduling will be added separately."
        )
    profiled = [r.name or r.id for r in model.resources if r.staffing_profile]
    if profiled:
        raise ValueError(
            "Phase 3 queue scheduling currently requires fixed staffing capacity. "
            "Time-varying staffing is present for: " + ", ".join(profiled)
        )


def _eligible_resource_ids(model: ProcessModel, activity) -> list[str]:
    rmap = model.resource_map()
    explicit = list(activity.eligible_resource_pools or [])
    required = set(activity.required_skills or [])

    if explicit:
        candidates = explicit
    elif activity.resource_pool:
        candidates = [activity.resource_pool]
    elif required:
        candidates = [r.id for r in model.resources]
    else:
        return []

    out = []
    for rid in candidates:
        r = rmap.get(rid)
        if r is None or int(r.capacity) <= 0:
            continue
        if required and not required.issubset(set(r.skills or [])):
            continue
        out.append(rid)
    return out


def _build_workload(model: ProcessModel, architecture_id: str, cases: int, seed: int) -> list[dict[str, Any]]:
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        raise ValueError(f"Unknown architecture '{architecture_id}'.")

    by_source = defaultdict(list)
    for t in arch.transitions:
        by_source[t.source].append(t)

    arrival_rng = np.random.default_rng(int(seed))
    arrivals = []
    now = 0.0
    for i in range(cases):
        if i > 0:
            now = _next_arrival_time(arrival_rng, model, now)
        arrivals.append(float(now))

    workload = []
    for i, arrival in enumerate(arrivals):
        # Per-case RNG makes routing/service draws independent of scheduling order.
        case_seed = (int(seed) * 1000003 + (i + 1) * 9176 + 12345) % (2**63 - 1)
        rng = np.random.default_rng(case_seed)
        current = model.start_activity
        steps = []
        visited = 0
        while True:
            visited += 1
            if visited > 100:
                raise ValueError(f"Case trajectory exceeded 100 activities at '{current}'.")
            service = float(_activity_service_minutes(rng, model, current, 1.0))
            steps.append({"activity_id": current, "service_minutes": service})
            if current == model.end_activity:
                break
            choices = by_source.get(current, [])
            if not choices:
                break
            probs = np.asarray([max(0.0, float(x.probability)) for x in choices], dtype=float)
            if probs.sum() <= 0:
                break
            probs /= probs.sum()
            current = choices[int(rng.choice(len(choices), p=probs))].target

        remaining = 0.0
        for step in reversed(steps):
            remaining += float(step["service_minutes"])
            step["remaining_service_minutes"] = remaining

        workload.append({
            "case_idx": i,
            "case_id": f"C{i+1:06d}",
            "arrival": arrival,
            "due": arrival + float(model.sla_minutes),
            "steps": steps,
        })
    return workload


def _annual_cost(model: ProcessModel) -> float:
    total = 0.0
    for r in model.resources:
        if r.cost_per_hour is not None:
            hourly = float(r.cost_per_hour)
        else:
            costs = [float(a.cost_per_hour) for a in model.activities if a.resource_pool == r.id]
            hourly = float(np.mean(costs)) if costs else 75.0
        total += int(r.capacity) * hourly * 2080.0
    return float(total)


def _run_queue_schedule(
    model: ProcessModel,
    architecture_id: str,
    workload: list[dict[str, Any]],
    *,
    policy: str,
    overflow_policy: dict[str, Any] | None = None,
    warmup_fraction: float = 0.25,
) -> dict[str, Any]:
    _validate_scheduling_model(model)
    if policy not in {"fcfs", "sla_risk"}:
        raise ValueError(f"Unsupported scheduling policy '{policy}'.")

    amap = model.activity_map()
    rmap = model.resource_map()
    free_slots = {r.id: list(range(max(0, int(r.capacity)))) for r in model.resources}
    busy = {r.id: 0 for r in model.resources}

    # events: (time, sequence, type, payload)
    events = []
    seq = 0
    for case in workload:
        heapq.heappush(events, (float(case["arrival"]), seq, "arrival", case["case_idx"]))
        seq += 1

    cases = {c["case_idx"]: c for c in workload}
    waiting = []
    completion = {}
    wait_minutes = []
    resource_intervals = []

    overflow_policy = overflow_policy or {}
    overflow_enabled = bool(overflow_policy.get("enabled"))
    threshold = max(0.0, float(overflow_policy.get("local_wait_threshold_minutes", 0.0)))
    max_fraction = min(1.0, max(0.0, float(overflow_policy.get("max_overflow_fraction", 1.0))))
    activity_home_cell = dict(overflow_policy.get("activity_home_cell") or {})
    resource_cell = dict(overflow_policy.get("resource_cell") or {})
    allowed_receive = set(overflow_policy.get("allowed_receive_cells") or [])
    overflow_count = 0
    assignments = 0

    def enqueue(case_idx: int, step_idx: int, ready: float) -> None:
        nonlocal seq
        case = cases[case_idx]
        step = case["steps"][step_idx]
        job = {
            "case_idx": case_idx,
            "step_idx": step_idx,
            "activity_id": step["activity_id"],
            "service_minutes": float(step["service_minutes"]),
            "remaining_service_minutes": float(step["remaining_service_minutes"]),
            "ready": float(ready),
            "queue_seq": seq,
        }
        seq += 1
        act = amap[job["activity_id"]]
        # Preserve the existing simulator's treatment of milestones/unresourced steps:
        # they consume their modeled duration but do not wait for a resource pool.
        if not _eligible_resource_ids(model, act):
            end = float(ready) + float(job["service_minutes"])
            heapq.heappush(events, (end, seq, "complete_unresourced", job))
            seq += 1
        else:
            waiting.append(job)

    def allowed_resources(job, now: float) -> tuple[list[str], set[str]]:
        act = amap[job["activity_id"]]
        elig = _eligible_resource_ids(model, act)
        if not overflow_enabled:
            return elig, set()
        home = activity_home_cell.get(act.id)
        if not home:
            return elig, set()
        local = [rid for rid in elig if resource_cell.get(rid) == home]
        remote = [
            rid for rid in elig
            if resource_cell.get(rid) not in (None, home)
            and (not allowed_receive or resource_cell.get(rid) in allowed_receive)
        ]
        waited = max(0.0, now - float(job["ready"]))
        if waited <= threshold:
            return local, set()
        return local + remote, set(remote)

    def priority(job, now: float):
        case = cases[job["case_idx"]]
        if policy == "fcfs":
            return (float(job["ready"]), float(case["arrival"]), int(job["queue_seq"]))
        projected_slack = float(case["due"]) - now - float(job["remaining_service_minutes"])
        return (projected_slack, float(job["ready"]), float(case["arrival"]), int(job["queue_seq"]))

    def dispatch(now: float) -> None:
        nonlocal overflow_count, assignments, seq
        while True:
            candidate = None
            for j_idx, job in enumerate(waiting):
                elig, remote = allowed_resources(job, now)
                available = [rid for rid in elig if free_slots.get(rid)]
                if not available:
                    continue

                # Prefer the activity's primary resource when equally available; otherwise stable ID.
                act = amap[job["activity_id"]]
                available.sort(key=lambda rid: (0 if rid == act.resource_pool else 1, rid))
                rid = available[0]
                is_overflow = rid in remote
                if is_overflow and max_fraction < 1.0:
                    projected = (overflow_count + 1) / max(assignments + 1, 1)
                    if projected > max_fraction + 1e-12:
                        local_available = [x for x in available if x not in remote]
                        if not local_available:
                            continue
                        rid = local_available[0]
                        is_overflow = False
                rank = priority(job, now)
                item = (rank, j_idx, rid, is_overflow)
                if candidate is None or item[0] < candidate[0]:
                    candidate = item

            if candidate is None:
                return

            _, j_idx, rid, is_overflow = candidate
            job = waiting.pop(j_idx)
            slot = free_slots[rid].pop()
            busy[rid] += 1
            start = float(now)
            end = start + float(job["service_minutes"])
            wait_minutes.append(max(0.0, start - float(job["ready"])))
            resource_intervals.append((rid, start, end))
            assignments += 1
            if is_overflow:
                overflow_count += 1
            heapq.heappush(events, (end, seq, "complete", (job, rid, slot)))
            seq += 1

    while events:
        now, _, kind, payload = heapq.heappop(events)
        if kind == "arrival":
            enqueue(int(payload), 0, now)
        elif kind == "complete":
            job, rid, slot = payload
            free_slots[rid].append(slot)
            busy[rid] = max(0, busy[rid] - 1)
            case = cases[job["case_idx"]]
            nxt = int(job["step_idx"]) + 1
            if nxt < len(case["steps"]):
                enqueue(job["case_idx"], nxt, now)
            else:
                completion[job["case_idx"]] = float(now)
        else:
            job = payload
            case = cases[job["case_idx"]]
            nxt = int(job["step_idx"]) + 1
            if nxt < len(case["steps"]):
                enqueue(job["case_idx"], nxt, now)
            else:
                completion[job["case_idx"]] = float(now)
        dispatch(float(now))

    if waiting:
        raise RuntimeError("Scheduling simulation ended with jobs still waiting and no future capacity events.")

    arrivals = np.asarray([float(c["arrival"]) for c in workload], dtype=float)
    completions = np.asarray([float(completion.get(c["case_idx"], c["arrival"])) for c in workload], dtype=float)
    cycles = completions - arrivals
    ncases = len(workload)
    warm_idx = min(max(int(ncases * warmup_fraction), 1), ncases - 2)
    measurement_start = arrivals[warm_idx]
    measurement_end = arrivals[-1]
    measurement_hours = max((measurement_end - measurement_start) / 60.0, 1e-9)
    cohort = arrivals >= measurement_start
    cohort_cycles = cycles[cohort]
    completed_in_window = np.sum((completions >= measurement_start) & (completions <= measurement_end))
    throughput = float(completed_in_window / measurement_hours)
    arrival_rate = float(np.sum((arrivals >= measurement_start) & (arrivals <= measurement_end)) / measurement_hours)
    backlog_start = int(np.sum((arrivals <= measurement_start) & (completions > measurement_start)))
    backlog_end = int(np.sum((arrivals <= measurement_end) & (completions > measurement_end)))
    backlog_growth = float((backlog_end - backlog_start) / measurement_hours)
    avg_wip = float(np.sum(cohort_cycles) / max(measurement_end - measurement_start, 1e-9))

    resource_busy = defaultdict(float)
    for rid, start, end in resource_intervals:
        resource_busy[rid] += max(0.0, min(end, measurement_end) - max(start, measurement_start))
    utils = {
        rid: float(resource_busy[rid] / max((measurement_end - measurement_start) * int(r.capacity), 1e-9))
        for rid, r in rmap.items()
    }

    return {
        "metrics": {
            "throughput_per_hour": throughput,
            "realized_arrival_rate_per_hour": arrival_rate,
            "mean_cycle_minutes": float(np.mean(cohort_cycles)),
            "median_cycle_minutes": float(np.median(cohort_cycles)),
            "p95_cycle_minutes": float(np.percentile(cohort_cycles, 95)),
            "sla_attainment": float(np.mean(cohort_cycles <= float(model.sla_minutes))),
            "avg_wip": avg_wip,
            "annual_cost": _annual_cost(model),
            "backlog_growth_per_hour": backlog_growth,
            "max_resource_utilization": max(utils.values()) if utils else 0.0,
            "mean_wait_minutes": float(np.mean(wait_minutes)) if wait_minutes else 0.0,
        },
        "overflow": {
            "assignments": int(assignments),
            "overflow_count": int(overflow_count),
            "overflow_fraction": float(overflow_count / max(assignments, 1)),
        },
    }


def _mean_rows(rows: list[dict[str, float]]) -> dict[str, float]:
    return {
        m: float(np.mean([float(r[m]) for r in rows]))
        for m in SCHEDULING_METRICS
    }


def run_phase3_scheduling_matrix(
    model: ProcessModel,
    architecture_id: str,
    *,
    cases: int = 800,
    seed: int = 1100,
    replications: int = 8,
    local_wait_threshold_minutes: float = 30.0,
    max_overflow_fraction: float = 1.0,
) -> dict[str, Any]:
    validate_phase1_cells(model, architecture_id)
    _validate_scheduling_model(model)

    no_model, validation = build_cellular_no_overflow_model(model, architecture_id)
    overflow_model, _, overflow_meta = build_cellular_controlled_overflow_model(model, architecture_id)
    if not overflow_meta["allowed_receive_cells"]:
        raise ValueError("Phase 3 requires at least one cell marked 'May receive overflow'.")
    _validate_scheduling_model(no_model)
    _validate_scheduling_model(overflow_model)

    cases = max(100, int(cases))
    replications = max(1, int(replications))
    threshold = max(0.0, float(local_wait_threshold_minutes))
    max_fraction = min(1.0, max(0.0, float(max_overflow_fraction)))
    seeds = [int(seed) + i for i in range(replications)]

    keys = [
        "global_fcfs", "global_sla_risk",
        "cellular_no_overflow_fcfs", "cellular_no_overflow_sla_risk",
        "cellular_controlled_overflow_fcfs", "cellular_controlled_overflow_sla_risk",
    ]
    rows = {k: [] for k in keys}
    overflow_rows = {"fcfs": [], "sla_risk": []}

    for s in seeds:
        workload = _build_workload(model, architecture_id, cases, s)
        scenarios = [
            ("global", model, None),
            ("cellular_no_overflow", no_model, None),
            (
                "cellular_controlled_overflow",
                overflow_model,
                {
                    "enabled": True,
                    "local_wait_threshold_minutes": threshold,
                    "max_overflow_fraction": max_fraction,
                    **overflow_meta,
                },
            ),
        ]
        for structure, scenario_model, overflow_policy in scenarios:
            for policy in ("fcfs", "sla_risk"):
                out = _run_queue_schedule(
                    scenario_model,
                    architecture_id,
                    workload,
                    policy=policy,
                    overflow_policy=overflow_policy,
                )
                key = f"{structure}_{policy}"
                rows[key].append({m: float(out["metrics"][m]) for m in SCHEDULING_METRICS})
                if structure == "cellular_controlled_overflow":
                    overflow_rows[policy].append(float(out["overflow"]["overflow_fraction"]))

    means = {k: _mean_rows(v) for k, v in rows.items()}
    deltas = {}
    for structure in ("global", "cellular_no_overflow", "cellular_controlled_overflow"):
        fcfs = rows[f"{structure}_fcfs"]
        risk = rows[f"{structure}_sla_risk"]
        deltas[structure] = {
            m: float(np.mean([r[m] - f[m] for r, f in zip(risk, fcfs)]))
            for m in SCHEDULING_METRICS
        }

    return {
        "architecture_id": architecture_id,
        "cases_per_replication": cases,
        "replications": replications,
        "seeds": seeds,
        "validation": validation,
        "policies": {
            "fcfs": "First ready, first served at each resource queue.",
            "sla_risk": (
                "Minimum projected SLA slack: due time minus current time minus remaining "
                "sampled processing time. Smaller slack is dispatched first."
            ),
        },
        "note": (
            "Pure EDD is not shown separately because all cases currently share the same SLA offset; "
            "EDD therefore largely collapses to arrival order. SLA-risk adds remaining-work information."
        ),
        "overflow_policy": {
            "local_wait_threshold_minutes": threshold,
            "max_overflow_fraction": max_fraction,
            "allowed_receive_cells": overflow_meta["allowed_receive_cells"],
        },
        "matrix": {k: {"metrics": v} for k, v in means.items()},
        "paired_delta_sla_risk_minus_fcfs": deltas,
        "overflow": {
            "fcfs_mean_fraction": float(np.mean(overflow_rows["fcfs"])) if overflow_rows["fcfs"] else 0.0,
            "sla_risk_mean_fraction": float(np.mean(overflow_rows["sla_risk"])) if overflow_rows["sla_risk"] else 0.0,
        },
    }
