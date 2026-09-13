from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from math import sqrt
from typing import Literal
import numpy as np

from .model import ProcessModel, DesignVariable
from .simulation import simulate, apply_design


ConstraintKind = Literal["eq", "ge", "le"]


@dataclass
class Constraint:
    metric: str
    kind: ConstraintKind
    value: float
    tolerance: float = 0.0
    weight: float = 1.0
    active_band: float = 0.10


@dataclass
class NumericVar:
    var: DesignVariable

    @property
    def name(self):
        return self.var.name

    def project(self, value: float) -> float:
        return self.var.numeric_project(value)

    def perturb(self) -> float:
        assert self.var.lower is not None and self.var.upper is not None
        if self.var.kind == "quantized":
            return float(self.var.step or 1.0)
        return max((self.var.upper - self.var.lower) * 1e-3, 1e-5)


def _numeric_vars(model: ProcessModel):
    return [
        NumericVar(v)
        for v in model.variables
        if v.kind in ("continuous", "quantized")
    ]


def _dict_from_x(vars_, x):
    return {
        v.name: v.project(float(x[i]))
        for i, v in enumerate(vars_)
    }


def calculate_structural_capacity(
    model: ProcessModel,
    architecture_id: str,
    design: dict[str, float],
) -> dict:
    cfg, capacities = apply_design(
        model,
        architecture_id,
        design,
    )

    arch = cfg["architecture"]
    enabled = list(arch.enabled_activities)

    transient = [
        aid
        for aid in enabled
        if aid != model.end_activity
    ]

    idx = {
        aid: i
        for i, aid in enumerate(transient)
    }

    n = len(transient)
    Q = np.zeros((n, n), dtype=float)
    outgoing = {}

    for t in cfg["transitions"]:
        outgoing.setdefault(t.source, []).append(t)

    for source in transient:
        edges = outgoing.get(source, [])
        total = sum(
            max(0.0, float(e.probability))
            for e in edges
        )

        if total <= 0:
            continue

        for e in edges:
            if e.target in idx:
                Q[idx[source], idx[e.target]] += (
                    max(0.0, float(e.probability))
                    / total
                )

    e0 = np.zeros(n, dtype=float)

    if model.start_activity in idx:
        e0[idx[model.start_activity]] = 1.0

    A = np.eye(n) - Q.T

    try:
        visits = np.linalg.solve(A, e0)
    except np.linalg.LinAlgError:
        visits = np.linalg.pinv(A) @ e0

    visits = np.maximum(visits, 0.0)

    amap = model.activity_map()
    service_multiplier = float(
        cfg["service_multiplier"]
    )

    workload = {
        rid: 0.0
        for rid in capacities
    }

    activity_visits = {}

    for aid, i in idx.items():
        visit_ratio = float(visits[i])
        activity_visits[aid] = visit_ratio

        act = amap[aid]
        rid = act.resource_pool

        if not rid:
            continue

        mean_service = (
            float(act.service_time.mean_minutes)
            * service_multiplier
        )

        workload[rid] = (
            workload.get(rid, 0.0)
            + model.arrival_rate_per_hour
            * visit_ratio
            * mean_service
        )

    resource_utilizations = {}

    for rid, cap in capacities.items():
        available = (
            max(float(cap), 1e-9)
            * 60.0
        )

        resource_utilizations[rid] = float(
            workload.get(rid, 0.0)
            / available
        )

    if resource_utilizations:
        bottleneck = max(
            resource_utilizations,
            key=resource_utilizations.get,
        )

        max_util = float(
            resource_utilizations[bottleneck]
        )
    else:
        bottleneck = None
        max_util = 0.0

    if max_util <= 0.90:
        status = "STABLE"
    elif max_util <= 0.95:
        status = "MARGINAL"
    else:
        status = "OVERLOADED"

    return {
        "max_resource_utilization": max_util,
        "bottleneck_resource": bottleneck,
        "resource_utilizations": {
            str(k): float(v)
            for k, v in resource_utilizations.items()
        },
        "activity_visit_ratios": {
            str(k): float(v)
            for k, v in activity_visits.items()
        },
        "capacity_status": status,
    }


def _constraint_value(
    metrics: dict,
    c: Constraint,
) -> float:
    m = float(metrics[c.metric])

    if c.kind == "eq":
        scale = max(
            c.tolerance,
            abs(c.value) * 0.01,
            1e-9,
        )

        return (
            abs(m - c.value)
            - c.tolerance
        ) / scale

    if c.kind == "ge":
        scale = max(
            abs(c.value) * 0.05,
            c.tolerance,
            1e-9,
        )

        return (
            c.value - m
        ) / scale

    if c.kind == "le":
        scale = max(
            abs(c.value) * 0.05,
            c.tolerance,
            1e-9,
        )

        return (
            m - c.value
        ) / scale

    raise ValueError(
        f"Unsupported constraint kind: {c.kind}"
    )


def _constraint_residual(
    metrics,
    constraints,
):
    return np.asarray(
        [
            c.weight
            * _constraint_value(metrics, c)
            for c in constraints
        ],
        dtype=float,
    )


def _active_indices(
    metrics,
    constraints,
):
    active = []

    for i, c in enumerate(constraints):
        if c.kind == "eq":
            active.append(i)
            continue

        m = float(metrics[c.metric])

        band = max(
            abs(c.value) * c.active_band,
            c.tolerance,
            1e-9,
        )

        slack = (
            m - c.value
            if c.kind == "ge"
            else c.value - m
        )

        if slack <= band:
            active.append(i)

    return active


def _add_flow_balance(metrics: dict, model: ProcessModel) -> dict:
    """
    Add demand-normalized flow balance to a metrics dictionary.

    Flow balance compares completed throughput with the realized arrival
    rate in the same simulation window. This avoids penalizing a design
    merely because a finite stochastic run happened to realize fewer than
    the nominal number of arrivals.
    """
    realized = metrics.get(
        "realized_arrival_rate_per_hour",
        metrics.get(
            "realized_arrival_rate",
            float(model.arrival_rate_per_hour),
        ),
    )

    realized = float(realized)
    throughput = float(metrics["throughput_per_hour"])

    metrics["realized_arrival_rate_per_hour"] = realized

    # User-facing demand satisfaction ratio. In a finite measurement window,
    # completions can slightly exceed arrivals because cases that entered
    # before the window may complete inside it. For process-design purposes,
    # satisfaction above 100% has no additional meaning, so cap it at 1.0.
    raw_flow_balance = float(
        throughput / max(realized, 1e-9)
    )

    metrics["raw_flow_balance"] = raw_flow_balance
    metrics["flow_balance"] = float(
        min(raw_flow_balance, 1.0)
    )

    return metrics


def _evaluate(
    model,
    arch,
    vars_,
    x,
    constraints,
    cases,
    seed,
):
    design = _dict_from_x(
        vars_,
        x,
    )

    sim_result = simulate(
        model,
        arch,
        design,
        cases=cases,
        seed=seed,
        emit_log=False,
    )

    metrics = {
        k: float(v)
        for k, v
        in sim_result["metrics"].items()
    }

    metrics = _add_flow_balance(
        metrics,
        model,
    )

    capacity = calculate_structural_capacity(
        model,
        arch,
        design,
    )

    metrics[
        "max_resource_utilization"
    ] = float(
        capacity[
            "max_resource_utilization"
        ]
    )

    raw = _constraint_residual(
        metrics,
        constraints,
    )

    vio = np.maximum(
        raw,
        0.0,
    )

    return (
        design,
        metrics,
        raw,
        vio,
        capacity,
    )


def _jacobian(
    model,
    arch,
    vars_,
    x,
    constraints,
    cases,
    seed,
    indices=None,
):
    if indices is None:
        indices = list(
            range(len(constraints))
        )

    _, _, r0, _, _ = _evaluate(
        model,
        arch,
        vars_,
        x,
        constraints,
        cases,
        seed,
    )

    y0 = r0[indices]

    J = np.zeros(
        (
            len(indices),
            len(vars_),
        ),
        dtype=float,
    )

    for j, v in enumerate(vars_):
        h = v.perturb()

        xp = x.copy()
        xm = x.copy()

        xp[j] = v.project(
            x[j] + h
        )

        xm[j] = v.project(
            x[j] - h
        )

        dp = xp[j] - x[j]
        dm = x[j] - xm[j]

        if dp > 0 and dm > 0:
            _, _, rp, _, _ = _evaluate(
                model,
                arch,
                vars_,
                xp,
                constraints,
                cases,
                seed,
            )

            _, _, rm, _, _ = _evaluate(
                model,
                arch,
                vars_,
                xm,
                constraints,
                cases,
                seed,
            )

            J[:, j] = (
                rp[indices]
                - rm[indices]
            ) / (dp + dm)

        elif dp > 0:
            _, _, rp, _, _ = _evaluate(
                model,
                arch,
                vars_,
                xp,
                constraints,
                cases,
                seed,
            )

            J[:, j] = (
                rp[indices]
                - y0
            ) / dp

        elif dm > 0:
            _, _, rm, _, _ = _evaluate(
                model,
                arch,
                vars_,
                xm,
                constraints,
                cases,
                seed,
            )

            J[:, j] = (
                y0
                - rm[indices]
            ) / dm

    return J


def _objective_grad(
    model,
    arch,
    vars_,
    x,
    objective,
    sense,
    cases,
    seed,
):
    sign = (
        1.0
        if sense == "min"
        else -1.0
    )

    g = np.zeros(
        len(vars_),
        dtype=float,
    )

    design0 = _dict_from_x(
        vars_,
        x,
    )

    m0 = simulate(
        model,
        arch,
        design0,
        cases=cases,
        seed=seed,
        emit_log=False,
    )["metrics"]

    f0 = (
        sign
        * float(
            m0[objective]
        )
    )

    for j, v in enumerate(vars_):
        h = v.perturb()
        xp = x.copy()

        xp[j] = v.project(
            x[j] + h
        )

        dp = xp[j] - x[j]

        if dp > 0:
            designp = _dict_from_x(
                vars_,
                xp,
            )

            mp = simulate(
                model,
                arch,
                designp,
                cases=cases,
                seed=seed,
                emit_log=False,
            )["metrics"]

            g[j] = (
                sign
                * float(
                    mp[objective]
                )
                - f0
            ) / dp

    return g


def _grid_values(
    v: NumericVar,
):
    lo = float(v.var.lower)
    hi = float(v.var.upper)

    if v.var.kind == "quantized":
        step = float(
            v.var.step or 1.0
        )

        vals = np.arange(
            lo,
            hi + 0.5 * step,
            step,
        )

        if len(vals) > 5:
            idx = (
                np.linspace(
                    0,
                    len(vals) - 1,
                    5,
                )
                .round()
                .astype(int)
            )

            vals = vals[idx]

        return [
            v.project(float(x))
            for x in vals
        ]

    return [
        v.project(float(x))
        for x in np.linspace(
            lo,
            hi,
            5,
        )
    ]


def _wilson_interval(
    successes: int,
    n: int,
    z: float = 1.96,
):
    if n <= 0:
        return 0.0, 1.0

    p = successes / n
    denom = 1.0 + z * z / n

    center = (
        p
        + z * z / (2.0 * n)
    ) / denom

    half = (
        z
        * sqrt(
            p * (1.0 - p) / n
            + z * z / (4.0 * n * n)
        )
        / denom
    )

    return (
        max(0.0, center - half),
        min(1.0, center + half),
    )


def _replicated_robustness(
    model,
    arch,
    design,
    constraints,
    seeds,
    cases,
):
    feasible_count = 0

    throughput = []
    realized_arrivals = []
    flow_balance = []
    sla = []
    p95 = []
    backlog = []

    capacity = calculate_structural_capacity(
        model,
        arch,
        design,
    )

    max_util = float(
        capacity[
            "max_resource_utilization"
        ]
    )

    for seed in seeds:
        out = simulate(
            model,
            arch,
            design,
            cases=cases,
            seed=int(seed),
            emit_log=False,
        )

        metrics = {
            k: float(v)
            for k, v
            in out["metrics"].items()
        }

        metrics = _add_flow_balance(
            metrics,
            model,
        )

        metrics[
            "max_resource_utilization"
        ] = max_util

        raw = _constraint_residual(
            metrics,
            constraints,
        )

        vio = np.maximum(
            raw,
            0.0,
        )

        if np.max(vio) <= 0:
            feasible_count += 1

        throughput.append(
            float(
                metrics[
                    "throughput_per_hour"
                ]
            )
        )

        realized_arrivals.append(
            float(
                metrics[
                    "realized_arrival_rate_per_hour"
                ]
            )
        )

        flow_balance.append(
            float(
                metrics[
                    "flow_balance"
                ]
            )
        )

        sla.append(
            float(
                metrics[
                    "sla_attainment"
                ]
            )
        )

        p95.append(
            float(
                metrics[
                    "p95_cycle_minutes"
                ]
            )
        )

        backlog.append(
            float(
                metrics[
                    "backlog_growth_per_hour"
                ]
            )
        )

    lo, hi = _wilson_interval(
        feasible_count,
        len(seeds),
    )

    return {
        "successes": int(
            feasible_count
        ),
        "replications": int(
            len(seeds)
        ),
        "cases_per_replication": int(
            cases
        ),
        "probability": float(
            feasible_count
            / max(len(seeds), 1)
        ),
        "probability_ci95": {
            "lower": float(lo),
            "upper": float(hi),
        },
        "mean_throughput": float(
            np.mean(throughput)
        ),
        "mean_realized_arrival_rate": float(
            np.mean(realized_arrivals)
        ),
        "mean_flow_balance": float(
            np.mean(flow_balance)
        ),
        "std_flow_balance": float(
            np.std(
                flow_balance,
                ddof=1,
            )
            if len(flow_balance) > 1
            else 0.0
        ),
        "flow_balance_p05": float(
            np.percentile(
                flow_balance,
                5,
            )
        ),
        "std_throughput": float(
            np.std(
                throughput,
                ddof=1,
            )
            if len(throughput) > 1
            else 0.0
        ),
        "mean_sla": float(
            np.mean(sla)
        ),
        "mean_p95": float(
            np.mean(p95)
        ),
        "mean_backlog_growth": float(
            np.mean(backlog)
        ),
        "backlog_p05": float(
            np.percentile(
                backlog,
                5,
            )
        ),
        "backlog_p95": float(
            np.percentile(
                backlog,
                95,
            )
        ),
        "probability_backlog_growth_above_0_05": float(
            sum(
                1
                for x in backlog
                if x > 0.05
            )
            / max(len(backlog), 1)
        ),
        "max_resource_utilization": max_util,
    }


def feasibility_envelope(
    model,
    arch,
    constraints,
    cases=250,
    seed=19,
):
    vars_ = _numeric_vars(model)

    grids = [
        _grid_values(v)
        for v in vars_
    ]

    combos = list(
        product(*grids)
    )

    max_points = 240

    if len(combos) > max_points:
        idx = (
            np.linspace(
                0,
                len(combos) - 1,
                max_points,
            )
            .round()
            .astype(int)
        )

        combos = [
            combos[int(i)]
            for i in idx
        ]

    best_feasible = None
    best_feasible_cost = float("inf")

    least_infeasible = None
    least_violation = float("inf")

    max_throughput = -float("inf")
    max_flow_balance = -float("inf")
    min_p95 = float("inf")
    max_sla = -float("inf")
    min_max_util = float("inf")

    feasible_candidates = []

    for combo in combos:
        x = np.asarray(
            combo,
            dtype=float,
        )

        (
            design,
            metrics,
            raw,
            vio,
            capacity,
        ) = _evaluate(
            model,
            arch,
            vars_,
            x,
            constraints,
            cases,
            seed,
        )

        vnorm = float(
            np.linalg.norm(vio)
        )

        max_throughput = max(
            max_throughput,
            float(
                metrics[
                    "throughput_per_hour"
                ]
            ),
        )

        max_flow_balance = max(
            max_flow_balance,
            float(
                metrics[
                    "flow_balance"
                ]
            ),
        )

        min_p95 = min(
            min_p95,
            float(
                metrics[
                    "p95_cycle_minutes"
                ]
            ),
        )

        max_sla = max(
            max_sla,
            float(
                metrics[
                    "sla_attainment"
                ]
            ),
        )

        min_max_util = min(
            min_max_util,
            float(
                metrics[
                    "max_resource_utilization"
                ]
            ),
        )

        if vnorm <= 1e-12:
            cost = float(
                metrics[
                    "annual_cost"
                ]
            )

            feasible_candidates.append(
                {
                    "x": x.copy(),
                    "design": design,
                    "metrics": metrics,
                    "cost": cost,
                }
            )

            if cost < best_feasible_cost:
                best_feasible_cost = cost
                best_feasible = (
                    x.copy(),
                    design,
                    metrics,
                )

        elif vnorm < least_violation:
            least_violation = vnorm
            least_infeasible = (
                x.copy(),
                design,
                metrics,
            )

    seed_choice = (
        best_feasible
        if best_feasible is not None
        else least_infeasible
    )

    return {
        "feasible_found": bool(
            best_feasible is not None
        ),
        "seed_x": (
            seed_choice[0].tolist()
            if seed_choice is not None
            else None
        ),
        "seed_design": (
            {
                k: float(v)
                for k, v
                in seed_choice[1].items()
            }
            if seed_choice is not None
            else None
        ),
        "seed_metrics": (
            {
                k: float(v)
                for k, v
                in seed_choice[2].items()
            }
            if seed_choice is not None
            else None
        ),
        "feasible_candidates": [
            {
                "x": c["x"].tolist(),
                "design": {
                    k: float(v)
                    for k, v
                    in c["design"].items()
                },
                "metrics": {
                    k: float(v)
                    for k, v
                    in c["metrics"].items()
                },
                "cost": float(
                    c["cost"]
                ),
            }
            for c in sorted(
                feasible_candidates,
                key=lambda z: z["cost"],
            )[:40]
        ],
        "envelope": {
            "max_throughput_per_hour": float(
                max_throughput
            ),
            "max_flow_balance": float(
                max_flow_balance
            ),
            "min_p95_cycle_minutes": float(
                min_p95
            ),
            "max_sla_attainment": float(
                max_sla
            ),
            "min_max_resource_utilization": float(
                min_max_util
            ),
            "points_evaluated": int(
                len(combos)
            ),
        },
    }


def _augment_safety_candidates(
    model,
    arch,
    constraints,
    base_candidates,
    cases,
    seed,
):
    vars_ = _numeric_vars(model)
    augmented = []
    seen = set()

    def add_design(design):
        key = tuple(
            sorted(
                (
                    k,
                    round(float(v), 8),
                )
                for k, v
                in design.items()
            )
        )

        if key in seen:
            return

        seen.add(key)

        x = np.asarray(
            [
                design[v.name]
                for v in vars_
            ],
            dtype=float,
        )

        (
            d,
            m,
            raw,
            vio,
            cap,
        ) = _evaluate(
            model,
            arch,
            vars_,
            x,
            constraints,
            cases,
            seed,
        )

        if np.max(vio) <= 0:
            augmented.append(
                {
                    "design": d,
                    "metrics": m,
                }
            )

    for item in base_candidates:
        add_design(item["design"])

    for item in base_candidates[:10]:
        base = dict(
            item["design"]
        )

        combined = dict(base)

        for nv in vars_:
            name = nv.name
            current = float(base[name])

            if "capacity" in name:
                step = float(
                    nv.var.step or 1.0
                )

                combined[name] = nv.project(
                    current + step
                )

                d = dict(base)
                d[name] = nv.project(
                    current + step
                )
                add_design(d)

            elif "automation" in name:
                span = float(
                    nv.var.upper
                    - nv.var.lower
                )

                combined[name] = nv.project(
                    current
                    + 0.10 * span
                )

                d = dict(base)
                d[name] = nv.project(
                    current
                    + 0.10 * span
                )
                add_design(d)

            elif "rework" in name:
                span = float(
                    nv.var.upper
                    - nv.var.lower
                )

                combined[name] = nv.project(
                    current
                    - 0.10 * span
                )

                d = dict(base)
                d[name] = nv.project(
                    current
                    - 0.10 * span
                )
                add_design(d)

        add_design(combined)

    return augmented


def _make_frontier(
    model,
    arch,
    constraints,
    candidate_designs,
    quick_seeds,
    quick_cases,
    robustness_target,
):
    scored = []
    seen = set()

    for item in candidate_designs:
        design = item["design"]

        key = tuple(
            sorted(
                (
                    k,
                    round(float(v), 8),
                )
                for k, v
                in design.items()
            )
        )

        if key in seen:
            continue

        seen.add(key)

        robust = _replicated_robustness(
            model,
            arch,
            design,
            constraints,
            seeds=quick_seeds,
            cases=quick_cases,
        )

        cost = float(
            item[
                "metrics"
            ][
                "annual_cost"
            ]
        )

        scored.append(
            {
                "design": {
                    k: float(v)
                    for k, v
                    in design.items()
                },
                "metrics": {
                    k: float(v)
                    for k, v
                    in item["metrics"].items()
                },
                "cost": cost,
                "robustness_probability": float(
                    robust[
                        "probability"
                    ]
                ),
                "robustness_ci95": robust[
                    "probability_ci95"
                ],
                "quick_robustness": robust,
                "target_met": bool(
                    robust[
                        "probability"
                    ]
                    >= robustness_target
                ),
            }
        )

    frontier = []

    for a in scored:
        dominated = False

        for b in scored:
            if a is b:
                continue

            if (
                b["cost"] <= a["cost"]
                and b[
                    "robustness_probability"
                ]
                >= a[
                    "robustness_probability"
                ]
                and (
                    b["cost"] < a["cost"]
                    or b[
                        "robustness_probability"
                    ]
                    > a[
                        "robustness_probability"
                    ]
                )
            ):
                dominated = True
                break

        if not dominated:
            frontier.append(a)

    frontier.sort(
        key=lambda z: (
            z["cost"],
            -z[
                "robustness_probability"
            ],
        )
    )

    qualifying = [
        x
        for x in frontier
        if x["target_met"]
    ]

    lowest_cost = (
        min(
            frontier,
            key=lambda z: z["cost"],
        )
        if frontier
        else None
    )

    most_robust = (
        max(
            frontier,
            key=lambda z: (
                z[
                    "robustness_probability"
                ],
                -z["cost"],
            ),
        )
        if frontier
        else None
    )

    balanced = (
        min(
            qualifying,
            key=lambda z: z["cost"],
        )
        if qualifying
        else None
    )

    return {
        "target_probability": float(
            robustness_target
        ),
        "target_met": bool(
            balanced is not None
        ),
        "frontier": frontier,
        "lowest_cost": lowest_cost,
        "balanced": balanced,
        "most_robust": most_robust,
    }


def optimize_architecture(
    model: ProcessModel,
    arch: str,
    constraints: list[Constraint],
    objective: str = "annual_cost",
    sense: str = "min",
    optimization_iterations: int = 24,
    cases: int = 500,
    seed: int = 11,
    robustness_target: float = 0.90,
    quick_replications: int = 12,
    quick_cases: int = 500,
    robustness_replications: int = 40,
    robustness_cases: int = 1200,
):
    vars_ = _numeric_vars(model)

    env = feasibility_envelope(
        model,
        arch,
        constraints,
        cases=max(
            150,
            cases // 2,
        ),
        seed=seed + 8,
    )

    if env["seed_x"] is None:
        return {
            "architecture": arch,
            "feasible": False,
            "robust_target_met": False,
            "best": None,
            "history": [],
            "score": 1e15,
            "feasibility_envelope": env,
            "robustness": None,
            "robust_frontier": None,
        }

    quick_seeds = [
        6000 + i
        for i in range(
            quick_replications
        )
    ]

    final_seeds = [
        1000 + i
        for i in range(
            robustness_replications
        )
    ]

    x = np.asarray(
        env["seed_x"],
        dtype=float,
    )

    spans = np.asarray(
        [
            (
                v.var.upper or 1
            )
            - (
                v.var.lower or 0
            )
            for v in vars_
        ],
        dtype=float,
    )

    trust = (
        0.06
        * np.linalg.norm(spans)
        / max(
            np.sqrt(len(spans)),
            1.0,
        )
    )

    history = []
    candidate_designs = []

    sign = (
        1.0
        if sense == "min"
        else -1.0
    )

    for k in range(
        optimization_iterations + 1
    ):
        (
            design,
            metrics,
            raw,
            vio,
            capacity,
        ) = _evaluate(
            model,
            arch,
            vars_,
            x,
            constraints,
            cases,
            seed,
        )

        active = _active_indices(
            metrics,
            constraints,
        )

        if active:
            J = _jacobian(
                model,
                arch,
                vars_,
                x,
                constraints,
                cases,
                seed,
                indices=active,
            )
        else:
            J = np.zeros(
                (
                    0,
                    len(vars_),
                ),
                dtype=float,
            )

        if J.size:
            _, s, Vt = np.linalg.svd(
                J,
                full_matrices=True,
            )

            rank = int(
                np.sum(
                    s
                    > max(
                        (
                            s[0]
                            if len(s)
                            else 0.0
                        )
                        * 1e-7,
                        1e-8,
                    )
                )
            )

            V = Vt.T
            null = V[:, rank:]

            cond = (
                float(
                    s[0]
                    / max(
                        s[
                            rank - 1
                        ],
                        1e-12,
                    )
                )
                if rank
                else float("inf")
            )

        else:
            s = np.asarray([])
            rank = 0

            null = np.eye(
                len(vars_),
                dtype=float,
            )

            cond = 1.0

        quick = _replicated_robustness(
            model,
            arch,
            design,
            constraints,
            seeds=quick_seeds,
            cases=quick_cases,
        )

        state = {
            "phase": (
                "statistical_robust_manifold"
                if env[
                    "feasible_found"
                ]
                else "best_infeasible_seed"
            ),
            "iteration": int(k),
            "design": {
                k2: float(v2)
                for k2, v2
                in design.items()
            },
            "metrics": {
                k2: float(v2)
                for k2, v2
                in metrics.items()
            },
            "constraint_residuals": [
                float(v)
                for v
                in raw.tolist()
            ],
            "violation_norm": float(
                np.linalg.norm(vio)
            ),
            "max_violation": (
                float(
                    np.max(vio)
                )
                if len(vio)
                else 0.0
            ),
            "active_constraints": [
                constraints[i].metric
                for i in active
            ],
            "rank": int(rank),
            "null_dim": int(
                null.shape[1]
            ),
            "singular_values": [
                float(v)
                for v
                in s.tolist()
            ],
            "condition_number": float(
                cond
            ),
            "capacity": capacity,
            "trust_radius": float(
                trust
            ),
            "quick_robustness": quick,
        }

        history.append(state)

        if (
            state[
                "max_violation"
            ] <= 0
        ):
            candidate_designs.append(
                {
                    "design": state[
                        "design"
                    ],
                    "metrics": state[
                        "metrics"
                    ],
                }
            )

        if (
            not env[
                "feasible_found"
            ]
            or k
            == optimization_iterations
            or state[
                "max_violation"
            ] > 0
        ):
            break

        g = _objective_grad(
            model,
            arch,
            vars_,
            x,
            objective,
            sense,
            cases,
            seed,
        )

        d = -null @ (
            null.T @ g
        )

        dn = np.linalg.norm(d)

        if dn < 1e-12:
            trust *= 0.5

            if trust < 1e-5:
                break

            continue

        d /= dn

        candidate = (
            x + trust * d
        )

        for i, v in enumerate(vars_):
            candidate[i] = v.project(
                candidate[i]
            )

        (
            design_c,
            mc,
            _,
            vc,
            _,
        ) = _evaluate(
            model,
            arch,
            vars_,
            candidate,
            constraints,
            cases,
            seed,
        )

        quick_c = _replicated_robustness(
            model,
            arch,
            design_c,
            constraints,
            seeds=quick_seeds,
            cases=quick_cases,
        )

        old_obj = (
            sign
            * float(
                metrics[
                    objective
                ]
            )
        )

        new_obj = (
            sign
            * float(
                mc[
                    objective
                ]
            )
        )

        current_p = float(
            quick[
                "probability"
            ]
        )

        candidate_p = float(
            quick_c[
                "probability"
            ]
        )

        robust_ok = (
            (
                current_p
                >= robustness_target
                and candidate_p
                >= robustness_target
            )
            or (
                current_p
                < robustness_target
                and candidate_p
                >= current_p
            )
        )

        if (
            np.max(vc) <= 0
            and robust_ok
            and new_obj < old_obj
        ):
            x = candidate
            trust *= 1.12
        else:
            trust *= 0.5

        if trust < 1e-5:
            break

    for item in env.get(
        "feasible_candidates",
        [],
    )[:30]:
        candidate_designs.append(
            {
                "design": item["design"],
                "metrics": item["metrics"],
            }
        )

    candidate_designs = _augment_safety_candidates(
        model,
        arch,
        constraints,
        candidate_designs,
        cases=max(
            250,
            cases // 2,
        ),
        seed=seed + 33,
    )

    robust_frontier = _make_frontier(
        model,
        arch,
        constraints,
        candidate_designs,
        quick_seeds=quick_seeds,
        quick_cases=quick_cases,
        robustness_target=robustness_target,
    )

    selected = (
        robust_frontier[
            "balanced"
        ]
        if robust_frontier[
            "target_met"
        ]
        else robust_frontier[
            "most_robust"
        ]
    )

    if selected is None:
        best = min(
            history,
            key=lambda h: h[
                "violation_norm"
            ],
        )

        feasible = False
        robustness = None
        final_target_met = False

        score = (
            1e12
            + best[
                "violation_norm"
            ]
        )

    else:
        selected_design = selected[
            "design"
        ]

        x_selected = np.asarray(
            [
                selected_design[
                    v.name
                ]
                for v in vars_
            ],
            dtype=float,
        )

        (
            design,
            metrics,
            raw,
            vio,
            capacity,
        ) = _evaluate(
            model,
            arch,
            vars_,
            x_selected,
            constraints,
            cases,
            seed,
        )

        active = _active_indices(
            metrics,
            constraints,
        )

        best = {
            "phase": (
                "robust_target_selection"
                if robust_frontier[
                    "target_met"
                ]
                else "best_available_below_target"
            ),
            "iteration": -1,
            "design": design,
            "metrics": metrics,
            "constraint_residuals": [
                float(v)
                for v
                in raw.tolist()
            ],
            "violation_norm": float(
                np.linalg.norm(vio)
            ),
            "max_violation": (
                float(
                    np.max(vio)
                )
                if len(vio)
                else 0.0
            ),
            "active_constraints": [
                constraints[i].metric
                for i in active
            ],
            "rank": None,
            "null_dim": None,
            "singular_values": [],
            "condition_number": None,
            "capacity": capacity,
            "trust_radius": None,
            "quick_robustness": selected[
                "quick_robustness"
            ],
        }

        feasible = (
            best[
                "max_violation"
            ] <= 0
        )

        robustness = _replicated_robustness(
            model,
            arch,
            best["design"],
            constraints,
            seeds=final_seeds,
            cases=robustness_cases,
        )

        final_target_met = bool(
            robustness[
                "probability"
            ]
            >= robustness_target
        )

        robust_penalty = max(
            0.0,
            robustness_target
            - robustness[
                "probability"
            ],
        )

        score = (
            float(
                best[
                    "metrics"
                ][
                    objective
                ]
            )
            + robust_penalty
            * 1e9
        )

    return {
        "architecture": arch,
        "feasible": bool(feasible),
        "robust_target_met": bool(
            final_target_met
            if robustness is not None
            else False
        ),
        "best": best,
        "history": history,
        "score": float(score),
        "feasibility_envelope": env,
        "robustness": robustness,
        "robust_frontier": robust_frontier,
    }


def optimize_families(
    model: ProcessModel,
    constraints: list[Constraint],
    objective: str = "annual_cost",
    sense: str = "min",
    optimization_iterations: int = 24,
    cases: int = 500,
    robustness_target: float = 0.90,
    quick_replications: int = 12,
    quick_cases: int = 500,
    robustness_replications: int = 40,
    robustness_cases: int = 1200,
):
    results = [
        optimize_architecture(
            model,
            a.id,
            constraints,
            objective,
            sense,
            optimization_iterations=optimization_iterations,
            cases=cases,
            seed=11,
            robustness_target=robustness_target,
            quick_replications=quick_replications,
            quick_cases=quick_cases,
            robustness_replications=robustness_replications,
            robustness_cases=robustness_cases,
        )
        for a in model.architectures
    ]

    def ranking_key(r):
        target_met = bool(
            r.get("robust_target_met")
        )

        feasible = bool(
            r.get("feasible")
        )

        best = r.get("best") or {}
        metrics = best.get("metrics") or {}

        cost = float(
            metrics.get(
                objective,
                float("inf"),
            )
        )

        robustness_probability = float(
            r.get("robustness", {}).get(
                "probability",
                0.0,
            )
            if r.get("robustness")
            else 0.0
        )

        if target_met:
            # Once the required robustness level is achieved, this is a
            # constrained cost-minimization problem: lowest cost ranks first.
            return (
                0,
                cost,
                -robustness_probability,
            )

        # Below the robustness target, prefer the most robust available
        # design, then use cost as the tie-breaker.
        return (
            1 if feasible else 2,
            -robustness_probability,
            cost,
        )

    results.sort(
        key=ranking_key
    )

    return results
