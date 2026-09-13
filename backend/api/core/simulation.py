from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math
import numpy as np

from .model import ProcessModel


def _rng_service_minutes(rng: np.random.Generator, distribution: str, mean: float, std: float) -> float:
    mean = max(mean, 0.01)
    std = max(std, 0.0)

    if distribution == "constant" or std == 0:
        return mean
    if distribution == "normal":
        return max(0.01, float(rng.normal(mean, std)))
    if distribution == "exponential":
        return max(0.01, float(rng.exponential(mean)))

    # lognormal from arithmetic mean/std
    variance = std * std
    sigma2 = math.log(1.0 + variance / (mean * mean))
    sigma = math.sqrt(max(sigma2, 0.0))
    mu = math.log(mean) - 0.5 * sigma2
    return max(0.01, float(rng.lognormal(mu, sigma)))


def _capacity_variable_name(resource_id: str) -> str:
    return f"resource_capacity__{resource_id}"


def _routing_variable_parts(name: str):
    prefix = "routing_probability__"
    if not name.startswith(prefix):
        return None
    rest = name[len(prefix):]
    parts = rest.split("__", 1)
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


def apply_design(model: ProcessModel, architecture_id: str, design: dict[str, float]) -> tuple[dict, dict]:
    """Apply a numeric design to any ProcessModel.

    v0.12 removes the core dependency on demo-specific resource names. Capacity
    variables now follow ``resource_capacity__<resource_id>``. Legacy
    ``<resource_id>_capacity`` names are still accepted so older saved models
    continue to run.

    Routing probabilities can be parameterized generically with
    ``routing_probability__<source>__<target>``. When one edge is changed, the
    remaining outgoing probability mass is proportionally rescaled.
    """
    arch = next(a for a in model.architectures if a.id == architecture_id)

    resources = {r.id: int(r.capacity) for r in model.resources}

    for r in model.resources:
        generic_name = _capacity_variable_name(r.id)
        legacy_name = f"{r.id}_capacity"
        if generic_name in design:
            resources[r.id] = max(1, int(round(float(design[generic_name]))))
        elif legacy_name in design:
            resources[r.id] = max(1, int(round(float(design[legacy_name]))))

    # Extra compatibility for v0.11-era demo JSON.
    legacy_aliases = {
        "analyst_capacity": "analyst",
        "senior_capacity": "senior",
        "qa_capacity": "qa",
    }
    for var_name, rid in legacy_aliases.items():
        if var_name in design and rid in resources:
            resources[rid] = max(1, int(round(float(design[var_name]))))

    automation = float(design.get("automation_level", 0.0))
    service_multiplier = max(0.30, 1.0 - 0.65 * automation)

    transitions = [t.model_copy(deep=True) for t in arch.transitions]

    # Generic routing-probability overrides.
    overrides = []
    for name, value in design.items():
        parsed = _routing_variable_parts(str(name))
        if parsed:
            source, target = parsed
            overrides.append((source, target, float(value)))

    # Backward compatibility with the original demonstration variable.
    if "qa_rework_rate" in design:
        overrides.append(("qa", "review", float(design["qa_rework_rate"])))

    for source, target, requested in overrides:
        edges = [t for t in transitions if t.source == source]
        chosen = next((t for t in edges if t.target == target), None)
        if chosen is None:
            continue

        requested = min(1.0, max(0.0, requested))
        others = [t for t in edges if t is not chosen]
        chosen.probability = requested

        if others:
            remaining = max(0.0, 1.0 - requested)
            old_other_total = sum(max(0.0, float(t.probability)) for t in others)
            if old_other_total > 0:
                for t in others:
                    t.probability = remaining * max(0.0, float(t.probability)) / old_other_total
            else:
                share = remaining / len(others)
                for t in others:
                    t.probability = share

    return {
        "architecture": arch,
        "resources": resources,
        "automation": automation,
        "service_multiplier": service_multiplier,
        "transitions": transitions,
    }, resources


def simulate(
    model: ProcessModel,
    architecture_id: str,
    design: dict[str, float] | None = None,
    cases: int = 1500,
    seed: int = 7,
    emit_log: bool = True,
    warmup_fraction: float = 0.25,
) -> dict:
    """
    Lightweight FCFS multi-server simulation.

    Key v0.4 change:
    performance is measured only on a post-warmup cohort, rather than by
    dividing all cases by the full startup+drain horizon.
    """
    design = design or {}
    cfg, capacities = apply_design(model, architecture_id, design)
    rng = np.random.default_rng(seed)
    amap = model.activity_map()

    by_source = defaultdict(list)
    for t in cfg["transitions"]:
        by_source[t.source].append(t)

    server_free = {
        rid: [0.0 for _ in range(max(1, int(cap)))]
        for rid, cap in capacities.items()
    }

    arrivals = []
    completions = []
    cycles = []
    events = []
    activity_busy = defaultdict(float)
    activity_count = defaultdict(int)

    now_arrival = 0.0
    base_dt = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)

    for case_idx in range(cases):
        if case_idx > 0:
            now_arrival += float(
                rng.exponential(60.0 / max(model.arrival_rate_per_hour, 1e-9))
            )

        case_id = f"C{case_idx+1:06d}"
        t = now_arrival
        first_t = t
        current = model.start_activity
        visited = 0

        while True:
            visited += 1
            if visited > 100:
                break

            act = amap[current]
            resource = act.resource_pool

            start = t
            server_idx = None
            if resource:
                servers = server_free[resource]
                server_idx = int(np.argmin(servers))
                start = max(t, servers[server_idx])

            svc = _rng_service_minutes(
                rng,
                act.service_time.distribution,
                act.service_time.mean_minutes * cfg["service_multiplier"],
                act.service_time.std_minutes * cfg["service_multiplier"],
            )
            end = start + svc

            if resource:
                server_free[resource][server_idx] = end

            activity_busy[current] += svc
            activity_count[current] += 1

            if emit_log:
                events.append({
                    "case_id": case_id,
                    "activity": current,
                    "start_time": (base_dt + timedelta(minutes=float(start))).isoformat(),
                    "end_time": (base_dt + timedelta(minutes=float(end))).isoformat(),
                    "resource": resource or "",
                })

            t = end

            if current == model.end_activity:
                break

            choices = by_source.get(current, [])
            if not choices:
                break

            probs = np.asarray([max(0.0, x.probability) for x in choices], dtype=float)
            if probs.sum() <= 0:
                break
            probs = probs / probs.sum()
            current = choices[int(rng.choice(len(choices), p=probs))].target

        arrivals.append(first_t)
        completions.append(t)
        cycles.append(t - first_t)

    arrivals = np.asarray(arrivals, dtype=float)
    completions = np.asarray(completions, dtype=float)
    cycles = np.asarray(cycles, dtype=float)

    warm_idx = min(max(int(cases * warmup_fraction), 1), cases - 2)
    measurement_start = arrivals[warm_idx]
    measurement_end = arrivals[-1]
    measurement_hours = max((measurement_end - measurement_start) / 60.0, 1e-9)

    cohort_mask = arrivals >= measurement_start
    cohort_cycles = cycles[cohort_mask]

    completed_in_window = np.sum(
        (completions >= measurement_start) & (completions <= measurement_end)
    )
    throughput_per_hour = float(completed_in_window / measurement_hours)

    arrivals_in_window = np.sum(
        (arrivals >= measurement_start) & (arrivals <= measurement_end)
    )
    realized_arrival_rate = float(arrivals_in_window / measurement_hours)

    backlog_start = int(np.sum((arrivals <= measurement_start) & (completions > measurement_start)))
    backlog_end = int(np.sum((arrivals <= measurement_end) & (completions > measurement_end)))
    backlog_growth_per_hour = float((backlog_end - backlog_start) / measurement_hours)

    # WIP over the measured cohort via Little's-law style time-in-system accumulation
    avg_wip = float(np.sum(cohort_cycles) / max(measurement_end - measurement_start, 1e-9))

    sla = float(np.mean(cohort_cycles <= model.sla_minutes)) if len(cohort_cycles) else 0.0

    annual_resource_cost = 0.0
    rmap = model.resource_map()
    for rid, cap in capacities.items():
        if rid in rmap:
            explicit_cost = rmap[rid].cost_per_hour
            if explicit_cost is not None:
                hourly_cost = float(explicit_cost)
            else:
                costs = [a.cost_per_hour for a in model.activities if a.resource_pool == rid]
                hourly_cost = float(np.mean(costs)) if costs else 75.0
            annual_resource_cost += cap * hourly_cost * 2080

    annual_resource_cost += 350_000 * float(cfg["automation"]) ** 1.25

    result = {
        "metrics": {
            "throughput_per_hour": throughput_per_hour,
            "realized_arrival_rate_per_hour": realized_arrival_rate,
            "mean_cycle_minutes": float(np.mean(cohort_cycles)),
            "p95_cycle_minutes": float(np.percentile(cohort_cycles, 95)),
            "sla_attainment": sla,
            "avg_wip": avg_wip,
            "annual_cost": annual_resource_cost,
            "backlog_growth_per_hour": backlog_growth_per_hour,
        },
        "measurement": {
            "warmup_cases": warm_idx,
            "measured_cases": int(np.sum(cohort_mask)),
            "measurement_hours": measurement_hours,
            "backlog_start": backlog_start,
            "backlog_end": backlog_end,
        },
        "activity_stats": [
            {
                "activity": aid,
                "events": int(activity_count[aid]),
                "busy_minutes": float(activity_busy[aid]),
            }
            for aid in activity_count
        ],
    }

    if emit_log:
        result["event_log"] = events

    return result
