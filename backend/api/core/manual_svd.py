from __future__ import annotations

import numpy as np

from .model import ProcessModel
from .optimization import NumericVar, _numeric_vars, calculate_structural_capacity
from .simulation import simulate

DEFAULT_METRICS = [
    "throughput_per_hour",
    "mean_cycle_minutes",
    "median_cycle_minutes",
    "p95_cycle_minutes",
    "sla_attainment",
    "annual_cost",
    "max_resource_utilization",
]


def _design_from_model(model: ProcessModel) -> dict[str, float]:
    return {
        v.name: float(v.value)
        for v in model.variables
        if v.kind in ("continuous", "quantized")
    }


def _project_design(vars_: list[NumericVar], design: dict[str, float]) -> dict[str, float]:
    result = dict(design)
    for v in vars_:
        if v.name in result:
            result[v.name] = v.project(float(result[v.name]))
        else:
            result[v.name] = v.project(float(v.var.value))
    return result


def _metrics_once(
    model: ProcessModel,
    architecture_id: str,
    design: dict[str, float],
    cases: int,
    seed: int,
) -> dict[str, float]:
    out = simulate(
        model,
        architecture_id,
        design,
        cases=cases,
        seed=seed,
        emit_log=False,
    )

    metrics = {
        k: float(v)
        for k, v in out["metrics"].items()
        if isinstance(v, (int, float, np.number))
    }

    realized = float(
        metrics.get(
            "realized_arrival_rate_per_hour",
            metrics.get(
                "realized_arrival_rate",
                model.arrival_rate_per_hour,
            ),
        )
    )
    metrics["realized_arrival_rate_per_hour"] = realized
    metrics["flow_balance"] = min(
        float(metrics["throughput_per_hour"]) / max(realized, 1e-9),
        1.0,
    )

    capacity = calculate_structural_capacity(
        model,
        architecture_id,
        design,
    )
    metrics["max_resource_utilization"] = float(
        capacity["max_resource_utilization"]
    )
    return metrics


def replicated_manual_svd(
    model: ProcessModel,
    architecture_id: str,
    design: dict[str, float] | None = None,
    metric_names: list[str] | None = None,
    replications: int = 6,
    cases: int = 500,
    seed_start: int = 3100,
) -> dict:
    """Estimate a local stochastic sensitivity matrix and its SVD.

    Every baseline/perturbation comparison uses the same seed within each
    replication (common random numbers).  The Jacobian is the mean of the
    paired finite-difference derivatives across replications.

    The returned normalized Jacobian scales design coordinates by their
    allowable spans and performance coordinates by their current replicated
    mean magnitudes.  The SVD therefore describes locally important design
    *directions* without allowing units such as dollars or minutes to dominate
    solely because of numerical scale.
    """
    vars_ = _numeric_vars(model)
    if not vars_:
        raise ValueError("The model has no continuous or quantized design variables")

    if architecture_id not in {a.id for a in model.architectures}:
        raise ValueError(f"Unknown architecture: {architecture_id}")

    metric_names = list(metric_names or DEFAULT_METRICS)
    if not metric_names:
        raise ValueError("Select at least one performance metric")

    replications = max(2, int(replications))
    cases = max(50, int(cases))
    seeds = [int(seed_start) + i for i in range(replications)]

    current = _design_from_model(model)
    current.update(design or {})
    current = _project_design(vars_, current)

    baseline_samples = {m: [] for m in metric_names}
    jacobian_samples: list[np.ndarray] = []

    for seed in seeds:
        base = _metrics_once(model, architecture_id, current, cases, seed)
        for m in metric_names:
            if m not in base:
                raise ValueError(f"Metric is not available from simulation: {m}")
            baseline_samples[m].append(float(base[m]))

        J_seed = np.zeros((len(metric_names), len(vars_)), dtype=float)

        for j, v in enumerate(vars_):
            x0 = float(current[v.name])
            h = float(v.perturb())
            xp = v.project(x0 + h)
            xm = v.project(x0 - h)
            dp = xp - x0
            dm = x0 - xm

            if dp > 0 and dm > 0:
                plus_design = dict(current)
                minus_design = dict(current)
                plus_design[v.name] = xp
                minus_design[v.name] = xm
                mp = _metrics_once(model, architecture_id, plus_design, cases, seed)
                mm = _metrics_once(model, architecture_id, minus_design, cases, seed)
                denom = dp + dm
                for i, m in enumerate(metric_names):
                    J_seed[i, j] = (float(mp[m]) - float(mm[m])) / denom
            elif dp > 0:
                plus_design = dict(current)
                plus_design[v.name] = xp
                mp = _metrics_once(model, architecture_id, plus_design, cases, seed)
                for i, m in enumerate(metric_names):
                    J_seed[i, j] = (float(mp[m]) - float(base[m])) / dp
            elif dm > 0:
                minus_design = dict(current)
                minus_design[v.name] = xm
                mm = _metrics_once(model, architecture_id, minus_design, cases, seed)
                for i, m in enumerate(metric_names):
                    J_seed[i, j] = (float(base[m]) - float(mm[m])) / dm

        jacobian_samples.append(J_seed)

    jac_stack = np.stack(jacobian_samples, axis=0)
    J = np.mean(jac_stack, axis=0)
    J_std = np.std(jac_stack, axis=0, ddof=1)

    baseline_mean = {
        m: float(np.mean(baseline_samples[m]))
        for m in metric_names
    }
    baseline_std = {
        m: float(np.std(baseline_samples[m], ddof=1))
        for m in metric_names
    }

    variable_scales = np.asarray([
        max(float(v.var.upper) - float(v.var.lower), abs(float(current[v.name])), 1e-9)
        for v in vars_
    ])
    metric_scales = np.asarray([
        max(abs(baseline_mean[m]), baseline_std[m], 1e-6)
        for m in metric_names
    ])

    Jn = (J * variable_scales[np.newaxis, :]) / metric_scales[:, np.newaxis]
    U, singular_values, Vt = np.linalg.svd(Jn, full_matrices=True)

    # Stability diagnostic: recompute singular vectors for every replicated
    # Jacobian and compare each mode with the mean-Jacobian mode.  Sign is
    # arbitrary, so use absolute dot products (1 = identical direction).
    stability = []
    for mode_idx in range(len(vars_)):
        reference = Vt[mode_idx, :]
        dots = []
        for Js in jacobian_samples:
            Jsn = (Js * variable_scales[np.newaxis, :]) / metric_scales[:, np.newaxis]
            _, _, Vts = np.linalg.svd(Jsn, full_matrices=True)
            dots.append(abs(float(np.dot(reference, Vts[mode_idx, :]))))
        stability.append(float(np.mean(dots)))

    modes = []
    for k in range(len(vars_)):
        sigma = float(singular_values[k]) if k < len(singular_values) else 0.0
        vector = Vt[k, :]
        modes.append({
            "mode": k + 1,
            "singular_value": sigma,
            "eigenvalue_jtj": sigma * sigma,
            "stability": stability[k],
            "components": {
                vars_[j].name: float(vector[j])
                for j in range(len(vars_))
            },
        })

    return {
        "architecture_id": architecture_id,
        "design": current,
        "variable_names": [v.name for v in vars_],
        "variable_kinds": {v.name: v.var.kind for v in vars_},
        "variable_bounds": {
            v.name: {
                "lower": float(v.var.lower),
                "upper": float(v.var.upper),
                "step": float(v.var.step) if v.var.step is not None else None,
            }
            for v in vars_
        },
        "metric_names": metric_names,
        "baseline_mean": baseline_mean,
        "baseline_std": baseline_std,
        "raw_jacobian": J.tolist(),
        "raw_jacobian_std": J_std.tolist(),
        "normalized_jacobian": Jn.tolist(),
        "singular_values": [float(x) for x in singular_values],
        "right_singular_vectors": Vt.tolist(),
        "left_singular_vectors": U.tolist(),
        "modes": modes,
        "method": {
            "replications": replications,
            "cases_per_replication": cases,
            "seed_start": int(seed_start),
            "common_random_numbers": True,
            "finite_difference": "central when both bounds permit; one-sided at a bound",
            "normalization": "variable span / current metric scale",
        },
    }


def apply_manual_mode_step(
    model: ProcessModel,
    design: dict[str, float],
    components: dict[str, float],
    step_fraction: float,
) -> dict:
    """Move along an SVD direction and project onto allowable design values.

    ``step_fraction=0.25`` means a unit-vector move equal to 25% of each
    variable's allowable span before projection.  Quantized variables are
    projected to their permitted grid after the move.
    """
    vars_ = _numeric_vars(model)
    proposed = dict(design)
    raw = {}

    for v in vars_:
        x0 = float(design.get(v.name, v.var.value))
        span = max(float(v.var.upper) - float(v.var.lower), 1e-9)
        delta = float(step_fraction) * float(components.get(v.name, 0.0)) * span
        raw_value = x0 + delta
        raw[v.name] = float(raw_value)
        proposed[v.name] = v.project(raw_value)

    return {
        "raw_design": raw,
        "projected_design": proposed,
    }
