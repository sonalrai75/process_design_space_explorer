from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math
import numpy as np

from .model import ProcessModel, ServiceTime, ResourcePool


def _rng_service_minutes(rng: np.random.Generator, service_time: ServiceTime, multiplier: float = 1.0) -> float:
    multiplier = max(float(multiplier), 0.0)
    distribution = service_time.distribution
    mean = max(float(service_time.mean_minutes) * multiplier, 0.01)
    std = max(float(service_time.std_minutes) * multiplier, 0.0)

    if distribution == 'empirical':
        samples = [float(x) * multiplier for x in (service_time.samples_minutes or []) if np.isfinite(x) and float(x) > 0]
        if samples:
            return max(0.01, float(rng.choice(np.asarray(samples, dtype=float))))
        return mean

    if distribution == 'triangular':
        lo, mode, hi = service_time.min_minutes, service_time.mode_minutes, service_time.max_minutes
        if lo is not None and mode is not None and hi is not None:
            lo = max(0.01, float(lo) * multiplier)
            mode = max(lo, float(mode) * multiplier)
            hi = max(mode, float(hi) * multiplier)
            if hi > lo:
                return max(0.01, float(rng.triangular(lo, mode, hi)))
        return mean

    if distribution == 'constant' or std == 0:
        return mean
    if distribution == 'normal':
        return max(0.01, float(rng.normal(mean, std)))
    if distribution == 'exponential':
        return max(0.01, float(rng.exponential(mean)))

    variance = std * std
    sigma2 = math.log(1.0 + variance / (mean * mean))
    sigma = math.sqrt(max(sigma2, 0.0))
    mu = math.log(mean) - 0.5 * sigma2
    return max(0.01, float(rng.lognormal(mu, sigma)))


def _capacity_variable_name(resource_id: str) -> str:
    return f'resource_capacity__{resource_id}'


def _routing_variable_parts(name: str):
    prefix = 'routing_probability__'
    if not name.startswith(prefix):
        return None
    rest = name[len(prefix):]
    parts = rest.split('__', 1)
    return (parts[0], parts[1]) if len(parts) == 2 else None


def apply_design(model: ProcessModel, architecture_id: str, design: dict[str, float]) -> tuple[dict, dict]:
    arch = next(a for a in model.architectures if a.id == architecture_id)
    resources = {r.id: int(r.capacity) for r in model.resources}

    for r in model.resources:
        generic_name = _capacity_variable_name(r.id)
        legacy_name = f'{r.id}_capacity'
        if generic_name in design:
            resources[r.id] = max(1, int(round(float(design[generic_name]))))
        elif legacy_name in design:
            resources[r.id] = max(1, int(round(float(design[legacy_name]))))

    legacy_aliases = {'analyst_capacity': 'analyst', 'senior_capacity': 'senior', 'qa_capacity': 'qa'}
    for var_name, rid in legacy_aliases.items():
        if var_name in design and rid in resources:
            resources[rid] = max(1, int(round(float(design[var_name]))))

    automation = float(design.get('automation_level', 0.0))
    service_multiplier = max(0.30, 1.0 - 0.65 * automation)
    transitions = [t.model_copy(deep=True) for t in arch.transitions]

    overrides = []
    for name, value in design.items():
        parsed = _routing_variable_parts(str(name))
        if parsed:
            overrides.append((parsed[0], parsed[1], float(value)))
    if 'qa_rework_rate' in design:
        overrides.append(('qa', 'review', float(design['qa_rework_rate'])))

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
                for t in others:
                    t.probability = remaining / len(others)

    return {
        'architecture': arch,
        'resources': resources,
        'automation': automation,
        'service_multiplier': service_multiplier,
        'transitions': transitions,
    }, resources


def _profile_position(t: float, repeat_minutes: float) -> float:
    repeat = max(float(repeat_minutes), 1e-9)
    return float(t % repeat)


def _arrival_rate_at(model: ProcessModel, t: float) -> float:
    if not model.arrival_profile:
        return max(float(model.arrival_rate_per_hour), 0.0)
    pos = _profile_position(t, model.arrival_profile_repeat_minutes)
    for iv in model.arrival_profile:
        if float(iv.start_minute) <= pos < float(iv.end_minute):
            return max(float(iv.rate_per_hour), 0.0)
    return 0.0


def _next_profile_boundary(t: float, intervals, repeat_minutes: float) -> float:
    repeat = max(float(repeat_minutes), 1e-9)
    cycle = math.floor(t / repeat)
    pos = t - cycle * repeat
    future = [float(x) for iv in intervals for x in (iv.start_minute, iv.end_minute) if float(x) > pos + 1e-9]
    if future:
        return cycle * repeat + min(future)
    return (cycle + 1.0) * repeat


def _next_arrival_time(rng: np.random.Generator, model: ProcessModel, t: float) -> float:
    if not model.arrival_profile:
        return t + float(rng.exponential(60.0 / max(model.arrival_rate_per_hour, 1e-9)))

    hazard = float(rng.exponential(1.0))
    cur = float(t)
    for _ in range(100000):
        rate = _arrival_rate_at(model, cur)
        boundary = _next_profile_boundary(cur, model.arrival_profile, model.arrival_profile_repeat_minutes)
        span = max(boundary - cur, 1e-9)
        if rate > 0:
            available_hazard = rate * span / 60.0
            if hazard <= available_hazard:
                return cur + hazard * 60.0 / rate
            hazard -= available_hazard
        cur = boundary + 1e-9
    raise RuntimeError('Arrival profile contains no usable positive-rate intervals.')


def _scaled_staffing_capacity(model: ProcessModel, pool: ResourcePool, t: float, designed_capacity: int) -> int:
    if not pool.staffing_profile:
        return max(0, int(designed_capacity))
    pos = _profile_position(t, model.staffing_profile_repeat_minutes)
    base = 0
    for iv in pool.staffing_profile:
        if float(iv.start_minute) <= pos < float(iv.end_minute):
            base = max(0, int(iv.capacity))
            break
    nominal = max(int(pool.capacity), 1)
    scale = float(designed_capacity) / nominal
    return max(0, int(round(base * scale)))


def _max_staffing_capacity(model: ProcessModel, pool: ResourcePool, designed_capacity: int) -> int:
    if not pool.staffing_profile:
        return max(1, int(designed_capacity))
    nominal = max(int(pool.capacity), 1)
    scale = float(designed_capacity) / nominal
    return max(1, max(int(round(max(0, iv.capacity) * scale)) for iv in pool.staffing_profile))


def _next_staffing_boundary(model: ProcessModel, pool: ResourcePool, t: float) -> float:
    if not pool.staffing_profile:
        return float('inf')
    return _next_profile_boundary(t, pool.staffing_profile, model.staffing_profile_repeat_minutes)


def _next_active_time_for_slot(model: ProcessModel, pool: ResourcePool, slot_idx: int, earliest: float, designed_capacity: int) -> float:
    cur = max(float(earliest), 0.0)
    if not pool.staffing_profile:
        return cur if slot_idx < max(0, designed_capacity) else float('inf')
    for _ in range(10000):
        if slot_idx < _scaled_staffing_capacity(model, pool, cur, designed_capacity):
            return cur
        boundary = _next_staffing_boundary(model, pool, cur)
        if not np.isfinite(boundary):
            return float('inf')
        cur = boundary + 1e-9
    return float('inf')


def _eligible_resource_ids(model: ProcessModel, activity, capacities: dict[str, int]) -> list[str]:
    if activity.routing_policy != 'earliest_available_skill' and not activity.required_skills and not activity.eligible_resource_pools:
        return [activity.resource_pool] if activity.resource_pool else []

    rmap = model.resource_map()
    required = set(activity.required_skills or [])
    explicit = set(activity.eligible_resource_pools or [])
    candidates = []
    for rid in capacities:
        pool = rmap.get(rid)
        if pool is None:
            continue
        if explicit and rid not in explicit:
            continue
        if required and not required.issubset(set(pool.skills or [])):
            continue
        candidates.append(rid)

    if activity.resource_pool and activity.resource_pool in capacities and activity.resource_pool not in candidates:
        pool = rmap.get(activity.resource_pool)
        if pool and (not required or required.issubset(set(pool.skills or []))) and (not explicit or activity.resource_pool in explicit):
            candidates.insert(0, activity.resource_pool)
    return candidates


def _pool_service_start(model: ProcessModel, pool: ResourcePool, server_free: dict, rid: str, earliest: float, designed_capacity: int):
    best = (float('inf'), None)
    for idx, free_at in enumerate(server_free[rid]):
        candidate = _next_active_time_for_slot(model, pool, idx, max(earliest, free_at), designed_capacity)
        if candidate < best[0]:
            best = (candidate, idx)
    return best


def _integrated_staff_minutes(model: ProcessModel, pool: ResourcePool, designed_capacity: int, start: float, end: float) -> float:
    if end <= start:
        return 0.0
    if not pool.staffing_profile:
        return max(0, designed_capacity) * (end - start)
    total = 0.0
    cur = start
    while cur < end - 1e-9:
        boundary = min(end, _next_staffing_boundary(model, pool, cur))
        total += _scaled_staffing_capacity(model, pool, cur, designed_capacity) * max(0.0, boundary - cur)
        cur = boundary + 1e-9
    return total


def simulate(model: ProcessModel, architecture_id: str, design: dict[str, float] | None = None, cases: int = 1500, seed: int = 7, emit_log: bool = True, warmup_fraction: float = 0.25) -> dict:
    design = design or {}
    cfg, capacities = apply_design(model, architecture_id, design)
    rng = np.random.default_rng(seed)
    amap = model.activity_map()
    rmap = model.resource_map()

    by_source = defaultdict(list)
    for t in cfg['transitions']:
        by_source[t.source].append(t)

    server_free = {
        rid: [0.0 for _ in range(_max_staffing_capacity(model, rmap[rid], int(cap)))]
        for rid, cap in capacities.items()
        if rid in rmap
    }

    arrivals, completions, cycles, events = [], [], [], []
    activity_busy = defaultdict(float)
    activity_count = defaultdict(int)
    resource_service_intervals = []

    now_arrival = 0.0
    base_dt = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)

    for case_idx in range(cases):
        if case_idx > 0:
            now_arrival = _next_arrival_time(rng, model, now_arrival)

        case_id = f'C{case_idx+1:06d}'
        t = now_arrival
        first_t = t
        current = model.start_activity
        visited = 0

        while True:
            visited += 1
            if visited > 100:
                break

            act = amap[current]
            resource = None
            server_idx = None
            start = t

            eligible = _eligible_resource_ids(model, act, capacities)
            if eligible:
                best = (float('inf'), None, None)
                for rid in eligible:
                    if rid not in server_free or rid not in rmap:
                        continue
                    candidate, idx = _pool_service_start(model, rmap[rid], server_free, rid, t, int(capacities[rid]))
                    tie = 0 if rid == act.resource_pool else 1
                    if (candidate, tie) < (best[0], 0 if best[1] == act.resource_pool else 1):
                        best = (candidate, rid, idx)
                if best[1] is None or not np.isfinite(best[0]):
                    raise RuntimeError(f'No staffed eligible resource is available for activity {act.id}.')
                start, resource, server_idx = best

            svc = _rng_service_minutes(rng, act.service_time, cfg['service_multiplier'])
            end = start + svc

            if resource:
                server_free[resource][server_idx] = end
                resource_service_intervals.append((resource, start, end))

            activity_busy[current] += svc
            activity_count[current] += 1

            if emit_log:
                events.append({
                    'case_id': case_id,
                    'activity': current,
                    'start_time': (base_dt + timedelta(minutes=float(start))).isoformat(),
                    'end_time': (base_dt + timedelta(minutes=float(end))).isoformat(),
                    'resource': resource or '',
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

    completed_in_window = np.sum((completions >= measurement_start) & (completions <= measurement_end))
    throughput_per_hour = float(completed_in_window / measurement_hours)
    arrivals_in_window = np.sum((arrivals >= measurement_start) & (arrivals <= measurement_end))
    realized_arrival_rate = float(arrivals_in_window / measurement_hours)
    backlog_start = int(np.sum((arrivals <= measurement_start) & (completions > measurement_start)))
    backlog_end = int(np.sum((arrivals <= measurement_end) & (completions > measurement_end)))
    backlog_growth_per_hour = float((backlog_end - backlog_start) / measurement_hours)
    avg_wip = float(np.sum(cohort_cycles) / max(measurement_end - measurement_start, 1e-9))
    sla = float(np.mean(cohort_cycles <= model.sla_minutes)) if len(cohort_cycles) else 0.0

    resource_busy = defaultdict(float)
    for rid, start, end in resource_service_intervals:
        overlap = max(0.0, min(end, measurement_end) - max(start, measurement_start))
        resource_busy[rid] += overlap

    resource_utilizations = {}
    for rid, designed_capacity in capacities.items():
        pool = rmap.get(rid)
        if pool is None:
            continue
        staffed = _integrated_staff_minutes(model, pool, int(designed_capacity), measurement_start, measurement_end)
        resource_utilizations[rid] = float(resource_busy[rid] / staffed) if staffed > 0 else 0.0

    bottleneck = max(resource_utilizations, key=resource_utilizations.get) if resource_utilizations else None
    max_util = float(resource_utilizations[bottleneck]) if bottleneck else 0.0

    annual_resource_cost = 0.0
    for rid, cap in capacities.items():
        if rid not in rmap:
            continue
        explicit_cost = rmap[rid].cost_per_hour
        if explicit_cost is not None:
            hourly_cost = float(explicit_cost)
        else:
            costs = [a.cost_per_hour for a in model.activities if a.resource_pool == rid]
            hourly_cost = float(np.mean(costs)) if costs else 75.0

        pool = rmap[rid]
        if pool.staffing_profile:
            repeat = max(model.staffing_profile_repeat_minutes, 1e-9)
            avg_cap = _integrated_staff_minutes(model, pool, int(cap), 0.0, repeat) / repeat
        else:
            avg_cap = cap
        annual_resource_cost += avg_cap * hourly_cost * 2080

    annual_resource_cost += 350_000 * float(cfg['automation']) ** 1.25

    result = {
        'metrics': {
            'throughput_per_hour': throughput_per_hour,
            'realized_arrival_rate_per_hour': realized_arrival_rate,
            'mean_cycle_minutes': float(np.mean(cohort_cycles)),
            'median_cycle_minutes': float(np.median(cohort_cycles)),
            'p95_cycle_minutes': float(np.percentile(cohort_cycles, 95)),
            'sla_attainment': sla,
            'avg_wip': avg_wip,
            'annual_cost': annual_resource_cost,
            'backlog_growth_per_hour': backlog_growth_per_hour,
            'max_resource_utilization': max_util,
        },
        'measurement': {
            'warmup_cases': warm_idx,
            'measured_cases': int(np.sum(cohort_mask)),
            'measurement_hours': measurement_hours,
            'backlog_start': backlog_start,
            'backlog_end': backlog_end,
        },
        'resource_stats': [
            {
                'resource': rid,
                'busy_minutes': float(resource_busy[rid]),
                'utilization': float(resource_utilizations.get(rid, 0.0)),
            }
            for rid in capacities
        ],
        'activity_stats': [
            {'activity': aid, 'events': int(activity_count[aid]), 'busy_minutes': float(activity_busy[aid])}
            for aid in activity_count
        ],
        'bottleneck_resource': bottleneck,
    }

    if emit_log:
        result['event_log'] = events
    return result
