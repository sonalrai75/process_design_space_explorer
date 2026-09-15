from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math
import numpy as np

from .model import ProcessModel, ServiceTime, ResourcePool


def _rng_service_minutes(
    rng: np.random.Generator,
    distribution: str,
    mean: float,
    std: float,
    *,
    minimum=None,
    mode=None,
    maximum=None,
    samples=None,
) -> float:
    mean = max(float(mean), 0.01)
    std = max(float(std), 0.0)

    if distribution == "unresolved":
        raise ValueError(
            "Activity has unresolved service-time data. Mark it terminal, "
            "define a triangular/fixed distribution, enter manual samples, "
            "or borrow another activity distribution before simulation."
        )
    if distribution == "constant":
        return mean
    if distribution == "triangular":
        lo = float(minimum if minimum is not None else mean)
        md = float(mode if mode is not None else mean)
        hi = float(maximum if maximum is not None else mean)
        if not (0 <= lo <= md <= hi):
            raise ValueError(
                f"Invalid triangular parameters: require 0 <= minimum <= mode <= maximum, "
                f"got {lo}, {md}, {hi}"
            )
        return max(0.01, float(rng.triangular(lo, md, hi)))
    if distribution == "empirical":
        vals = [float(x) for x in (samples or []) if float(x) > 0]
        if not vals:
            raise ValueError("Empirical service-time model has no positive samples.")
        return max(0.01, float(rng.choice(vals)))
    if distribution == "normal":
        return max(0.01, float(rng.normal(mean, std)))
    if distribution == "exponential":
        return max(0.01, float(rng.exponential(mean)))
    if std == 0:
        return mean

    variance = std * std
    sigma2 = math.log(1.0 + variance / (mean * mean))
    sigma = math.sqrt(max(sigma2, 0.0))
    mu = math.log(mean) - 0.5 * sigma2
    return max(0.01, float(rng.lognormal(mu, sigma)))


def _activity_service_minutes(
    rng: np.random.Generator,
    model: ProcessModel,
    activity_id: str,
    service_multiplier: float,
    stack=None,
) -> float:
    stack = set(stack or [])
    if activity_id in stack:
        raise ValueError(f"Borrowed service-time cycle detected at activity '{activity_id}'.")
    stack.add(activity_id)

    act = model.activity_map()[activity_id]
    if getattr(act, "terminal", False):
        return 0.01

    st = act.service_time
    if st.distribution == "borrowed":
        source = st.source_activity_id
        if not source or source not in model.activity_map():
            raise ValueError(
                f"Activity '{act.name}' borrows a distribution but no valid source activity is selected."
            )
        return max(
            0.01,
            float(st.scale or 1.0)
            * _activity_service_minutes(
                rng, model, source, service_multiplier, stack
            ),
        )

    return _rng_service_minutes(
        rng,
        st.distribution,
        st.mean_minutes * service_multiplier,
        st.std_minutes * service_multiplier,
        minimum=None if st.minimum_minutes is None else st.minimum_minutes * service_multiplier,
        mode=None if st.mode_minutes is None else st.mode_minutes * service_multiplier,
        maximum=None if st.maximum_minutes is None else st.maximum_minutes * service_multiplier,
        samples=None if not st.samples_minutes else [x * service_multiplier for x in st.samples_minutes],
    )

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


def _agent_slots(model: ProcessModel, capacities: dict[str, int]):
    # Returns explicit/synthetic one-server slots grouped by pool. Existing
    # individual agents are preserved; additional design capacity receives
    # anonymous slots carrying the pool's aggregate skill set.
    grouped = defaultdict(list)
    for agent in model.agents:
        if agent.active and agent.resource_pool in capacities:
            grouped[agent.resource_pool].append(agent)

    slots = {}
    for rid, cap in capacities.items():
        pool = model.resource_map().get(rid)
        if pool is None:
            continue
        listed = sorted(grouped.get(rid, []), key=lambda a: a.id)
        target = _max_staffing_capacity(model, pool, int(cap))
        rows = []
        for idx, agent in enumerate(listed):
            rows.append({
                'id': agent.id,
                'name': agent.name or agent.id,
                'pool': rid,
                'slot_idx': idx,
                'skills': set(agent.skills or []),
                'proficiency': dict(agent.skill_proficiency or {}),
                'synthetic': bool(agent.synthetic),
            })
        for idx in range(len(rows), target):
            rows.append({
                'id': f'{rid}__design_slot_{idx+1:02d}',
                'name': f'{pool.name} design slot {idx+1}',
                'pool': rid,
                'slot_idx': idx,
                'skills': set(pool.skills or []),
                'proficiency': {skill: 1.0 for skill in (pool.skills or [])},
                'synthetic': True,
            })
        slots[rid] = rows
    return slots


def _next_active_time_for_agent(model: ProcessModel, pool: ResourcePool, slot_idx: int, earliest: float, designed_capacity: int) -> float:
    return _next_active_time_for_slot(model, pool, slot_idx, earliest, designed_capacity)


def _eligible_agent_slots(model: ProcessModel, activity, capacities: dict[str, int], slots_by_pool: dict):
    required = set(activity.required_skills or [])
    explicit_pools = set(activity.eligible_resource_pools or [])
    candidates = []
    for rid, rows in slots_by_pool.items():
        # When required skills exist, individual skills are authoritative and
        # explicit pool eligibility is treated as derived metadata. Without a
        # skill requirement, preserve the configured pool restriction.
        if not required:
            if explicit_pools and rid not in explicit_pools:
                continue
            if not explicit_pools and activity.resource_pool and rid != activity.resource_pool:
                continue
        for row in rows:
            if required and not required.issubset(row['skills']):
                continue
            candidates.append(row)
    return candidates


def _agent_proficiency_multiplier(activity, slot: dict) -> float:
    required = list(activity.required_skills or [])
    if not required:
        return 1.0
    profs = [float(slot['proficiency'].get(skill, 1.0)) for skill in required]
    # Proficiency=1 is baseline. Lower proficiency lengthens service time.
    p = min(profs) if profs else 1.0
    p = min(1.0, max(0.25, p))
    return 1.0 / p


def _integrated_agent_minutes(model: ProcessModel, pool: ResourcePool, slot_idx: int, designed_capacity: int, start: float, end: float) -> float:
    if end <= start:
        return 0.0
    if not pool.staffing_profile:
        return (end - start) if slot_idx < max(0, designed_capacity) else 0.0
    total = 0.0
    cur = start
    while cur < end - 1e-9:
        boundary = min(end, _next_staffing_boundary(model, pool, cur))
        if slot_idx < _scaled_staffing_capacity(model, pool, cur, designed_capacity):
            total += max(0.0, boundary - cur)
        cur = boundary + 1e-9
    return total


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


def simulate(model: ProcessModel, architecture_id: str, design: dict[str, float] | None = None, cases: int = 1500, seed: int = 7, emit_log: bool = True, warmup_fraction: float = 0.25, overflow_policy: dict | None = None) -> dict:
    design = design or {}
    cfg, capacities = apply_design(model, architecture_id, design)
    rng = np.random.default_rng(seed)
    amap = model.activity_map()
    rmap = model.resource_map()

    by_source = defaultdict(list)
    for t in cfg['transitions']:
        by_source[t.source].append(t)

    use_individual_agents = bool(model.agents)
    slots_by_pool = _agent_slots(model, capacities) if use_individual_agents else {}
    agent_free = {
        row['id']: 0.0
        for rows in slots_by_pool.values()
        for row in rows
    }
    server_free = {
        rid: [0.0 for _ in range(_max_staffing_capacity(model, rmap[rid], int(cap)))]
        for rid, cap in capacities.items()
        if rid in rmap
    }

    arrivals, completions, cycles, events = [], [], [], []
    activity_busy = defaultdict(float)
    activity_count = defaultdict(int)
    resource_service_intervals = []
    agent_service_intervals = []

    overflow_policy = overflow_policy or {}
    overflow_enabled = bool(overflow_policy.get('enabled'))
    overflow_threshold = max(0.0, float(overflow_policy.get('local_wait_threshold_minutes', 0.0)))
    max_overflow_fraction = min(1.0, max(0.0, float(overflow_policy.get('max_overflow_fraction', 1.0))))
    activity_home_cell = dict(overflow_policy.get('activity_home_cell') or {})
    resource_cell = dict(overflow_policy.get('resource_cell') or {})
    allowed_receive_cells = set(overflow_policy.get('allowed_receive_cells') or [])
    overflow_count = 0
    resource_assignment_count = 0
    overflow_by_destination = defaultdict(int)
    overflow_by_source = defaultdict(int)
    overflow_wait_saved = []

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

            selected_agent = None
            if use_individual_agents:
                eligible_agents = _eligible_agent_slots(model, act, capacities, slots_by_pool)
                if eligible_agents:
                    best = (float('inf'), None)
                    for row in eligible_agents:
                        rid = row['pool']
                        if rid not in rmap:
                            continue
                        candidate = _next_active_time_for_agent(
                            model,
                            rmap[rid],
                            row['slot_idx'],
                            max(t, agent_free.get(row['id'], 0.0)),
                            int(capacities[rid]),
                        )
                        tie = 0 if rid == act.resource_pool else 1
                        current_tie = 0 if best[1] and best[1]['pool'] == act.resource_pool else 1
                        if (candidate, tie, row['id']) < (best[0], current_tie, best[1]['id'] if best[1] else ''):
                            best = (candidate, row)
                    if best[1] is None or not np.isfinite(best[0]):
                        raise RuntimeError(f'No staffed eligible individual resource is available for activity {act.id}.')
                    start, selected_agent = best
                    resource = selected_agent['pool']
            else:
                eligible = _eligible_resource_ids(model, act, capacities)
                overflow_used = False
                overflow_source_cell = None
                overflow_destination_cell = None
                if eligible:
                    candidates = []
                    for rid in eligible:
                        if rid not in server_free or rid not in rmap:
                            continue
                        candidate, idx = _pool_service_start(model, rmap[rid], server_free, rid, t, int(capacities[rid]))
                        tie = 0 if rid == act.resource_pool else 1
                        candidates.append((candidate, tie, rid, idx))

                    best = min(candidates, default=(float('inf'), 1, None, None))
                    home_cell = activity_home_cell.get(act.id) if overflow_enabled else None
                    if home_cell and candidates:
                        local = [x for x in candidates if resource_cell.get(x[2]) == home_cell]
                        remote = [
                            x for x in candidates
                            if resource_cell.get(x[2]) not in (None, home_cell)
                            and (not allowed_receive_cells or resource_cell.get(x[2]) in allowed_receive_cells)
                        ]
                        best_local = min(local, default=None)
                        best_remote = min(remote, default=None)
                        if best_local is not None:
                            best = best_local
                            local_wait = max(0.0, float(best_local[0] - t))
                            can_overflow = (
                                best_remote is not None
                                and local_wait > overflow_threshold
                                and best_remote[0] < best_local[0]
                            )
                            if can_overflow and max_overflow_fraction < 1.0:
                                projected = (overflow_count + 1) / max(resource_assignment_count + 1, 1)
                                can_overflow = projected <= max_overflow_fraction + 1e-12
                            if can_overflow:
                                best = best_remote
                                overflow_used = True
                                overflow_source_cell = home_cell
                                overflow_destination_cell = resource_cell.get(best_remote[2])
                                overflow_wait_saved.append(max(0.0, float(best_local[0] - best_remote[0])))

                    if best[2] is None or not np.isfinite(best[0]):
                        raise RuntimeError(f'No staffed eligible resource is available for activity {act.id}.')
                    start, _, resource, server_idx = best
                    resource_assignment_count += 1
                    if overflow_used:
                        overflow_count += 1
                        overflow_by_source[str(overflow_source_cell)] += 1
                        overflow_by_destination[str(overflow_destination_cell)] += 1

            svc = _activity_service_minutes(rng, model, current, cfg['service_multiplier'])
            if selected_agent is not None:
                svc *= _agent_proficiency_multiplier(act, selected_agent)
            end = start + svc

            if selected_agent is not None:
                agent_free[selected_agent['id']] = end
                resource_service_intervals.append((selected_agent['pool'], start, end))
                agent_service_intervals.append((selected_agent['id'], selected_agent['pool'], selected_agent['slot_idx'], start, end))
            elif resource:
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
                    'resource': selected_agent['id'] if selected_agent is not None else (resource or ''),
                    'resource_pool': selected_agent['pool'] if selected_agent is not None else (resource or ''),
                    'overflow': bool((not use_individual_agents) and locals().get('overflow_used', False)),
                    'home_cell': locals().get('overflow_source_cell'),
                    'served_cell': locals().get('overflow_destination_cell'),
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

    agent_busy = defaultdict(float)
    for aid, rid, slot_idx, start, end in agent_service_intervals:
        overlap = max(0.0, min(end, measurement_end) - max(start, measurement_start))
        agent_busy[aid] += overlap

    agent_utilizations = {}
    if use_individual_agents:
        for rid, rows in slots_by_pool.items():
            pool = rmap.get(rid)
            if pool is None:
                continue
            for row in rows:
                available = _integrated_agent_minutes(
                    model, pool, row['slot_idx'], int(capacities[rid]), measurement_start, measurement_end
                )
                agent_utilizations[row['id']] = float(agent_busy[row['id']] / available) if available > 0 else 0.0

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
        'agent_stats': [
            {
                'agent': row['id'],
                'name': row['name'],
                'resource_pool': rid,
                'skills': sorted(row['skills']),
                'busy_minutes': float(agent_busy[row['id']]),
                'utilization': float(agent_utilizations.get(row['id'], 0.0)),
                'synthetic': bool(row['synthetic']),
            }
            for rid, rows in slots_by_pool.items()
            for row in rows
        ] if use_individual_agents else [],
        'activity_stats': [
            {'activity': aid, 'events': int(activity_count[aid]), 'busy_minutes': float(activity_busy[aid])}
            for aid in activity_count
        ],
        'bottleneck_resource': bottleneck,
        'overflow': {
            'enabled': overflow_enabled,
            'assignments': int(resource_assignment_count),
            'overflow_count': int(overflow_count),
            'overflow_fraction': float(overflow_count / max(resource_assignment_count, 1)),
            'mean_wait_saved_minutes': float(np.mean(overflow_wait_saved)) if overflow_wait_saved else 0.0,
            'by_source_cell': {str(k): int(v) for k, v in overflow_by_source.items()},
            'by_destination_cell': {str(k): int(v) for k, v in overflow_by_destination.items()},
        },
    }

    if emit_log:
        result['event_log'] = events
    return result
