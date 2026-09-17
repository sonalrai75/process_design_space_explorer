from __future__ import annotations

from typing import Any

import numpy as np

from .cellularization import (
    PHASE1_METRICS,
    build_cellular_no_overflow_model,
    build_cellular_controlled_overflow_model,
)
from .model import CellDefinition, ProcessModel
from .simulation import simulate
from .structural_analysis import analyze_cell_structure


def _mean_metrics(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    return {
        metric: float(np.mean([float(row[metric]) for row in rows]))
        for metric in PHASE1_METRICS
    }


def _cells_from_candidate(candidate: dict[str, Any], *, receive_overflow: bool) -> list[CellDefinition]:
    cells: list[CellDefinition] = []
    for raw in candidate.get("cells") or []:
        data = dict(raw)
        # Candidate generation deliberately creates strict cells. For the controlled-overflow
        # evaluation arm we enable symmetric receiving across every generated cell without
        # changing its capacity allocation.
        data["cross_cell_eligible"] = bool(receive_overflow)
        cells.append(CellDefinition(**data))
    if not cells:
        raise ValueError(f"Candidate '{candidate.get('id', 'unknown')}' contains no cells.")
    return cells


def evaluate_cell_candidates(
    model: ProcessModel,
    architecture_id: str,
    candidates: list[dict[str, Any]],
    *,
    structural_weights: dict[str, float] | None = None,
    cases: int = 600,
    seed: int = 1300,
    replications: int = 6,
    local_wait_threshold_minutes: float = 30.0,
    max_overflow_fraction: float = 1.0,
) -> dict[str, Any]:
    if not candidates:
        raise ValueError("Generate candidate cells before running candidate evaluation.")

    cases = max(100, int(cases))
    replications = max(1, int(replications))
    threshold = max(0.0, float(local_wait_threshold_minutes))
    max_fraction = min(1.0, max(0.0, float(max_overflow_fraction)))
    seeds = [int(seed) + i for i in range(replications)]

    # Run the global baseline once. Every candidate then sees the exact same baseline cases,
    # arrivals and random-number seeds.
    global_rows: list[dict[str, float]] = []
    for s in seeds:
        out = simulate(model, architecture_id, {}, cases=cases, seed=s, emit_log=False)
        global_rows.append({m: float(out["metrics"][m]) for m in PHASE1_METRICS})
    global_mean = _mean_metrics(global_rows)

    evaluated: list[dict[str, Any]] = []

    for candidate in candidates:
        strict_model = model.model_copy(deep=True)
        strict_model.cells = _cells_from_candidate(candidate, receive_overflow=False)
        no_model, validation = build_cellular_no_overflow_model(strict_model, architecture_id)

        overflow_source = model.model_copy(deep=True)
        overflow_source.cells = _cells_from_candidate(candidate, receive_overflow=True)
        overflow_model, _, policy_metadata = build_cellular_controlled_overflow_model(
            overflow_source,
            architecture_id,
        )

        structural = analyze_cell_structure(strict_model, architecture_id, structural_weights)
        no_rows: list[dict[str, float]] = []
        controlled_rows: list[dict[str, float]] = []
        overflow_rows: list[dict[str, Any]] = []

        for s in seeds:
            no_out = simulate(no_model, architecture_id, {}, cases=cases, seed=s, emit_log=False)
            controlled_out = simulate(
                overflow_model,
                architecture_id,
                {},
                cases=cases,
                seed=s,
                emit_log=False,
                overflow_policy={
                    "enabled": True,
                    "local_wait_threshold_minutes": threshold,
                    "max_overflow_fraction": max_fraction,
                    **policy_metadata,
                },
            )
            no_rows.append({m: float(no_out["metrics"][m]) for m in PHASE1_METRICS})
            controlled_rows.append({m: float(controlled_out["metrics"][m]) for m in PHASE1_METRICS})
            overflow_rows.append(dict(controlled_out.get("overflow") or {}))

        no_mean = _mean_metrics(no_rows)
        controlled_mean = _mean_metrics(controlled_rows)
        delta_controlled_global = {
            m: float(controlled_mean[m] - global_mean[m]) for m in PHASE1_METRICS
        }
        delta_no_global = {
            m: float(no_mean[m] - global_mean[m]) for m in PHASE1_METRICS
        }

        evaluated.append({
            "id": candidate.get("id"),
            "k": candidate.get("k"),
            "profile": candidate.get("profile"),
            "profile_label": candidate.get("profile_label") or candidate.get("id"),
            "cells": [c.model_dump() for c in strict_model.cells],
            "validation": validation,
            "structural_analysis": structural,
            "global": {"metrics": global_mean},
            "cellular_no_overflow": {"metrics": no_mean},
            "cellular_controlled_overflow": {"metrics": controlled_mean},
            "delta_no_overflow_minus_global": delta_no_global,
            "delta_controlled_minus_global": delta_controlled_global,
            "overflow": {
                "mean_fraction": float(np.mean([float(x.get("overflow_fraction", 0.0)) for x in overflow_rows])),
                "mean_count": float(np.mean([float(x.get("overflow_count", 0.0)) for x in overflow_rows])),
                "mean_wait_saved_minutes": float(np.mean([float(x.get("mean_wait_saved_minutes", 0.0)) for x in overflow_rows])),
            },
        })

    return {
        "architecture_id": architecture_id,
        "cases_per_replication": cases,
        "replications": replications,
        "seeds": seeds,
        "overflow_policy": {
            "local_wait_threshold_minutes": threshold,
            "max_overflow_fraction": max_fraction,
            "receiver_rule": "all generated cells may receive overflow during candidate evaluation",
        },
        "global": {"metrics": global_mean},
        "candidate_count": len(evaluated),
        "candidates": evaluated,
        "notes": [
            "All candidates use the same arrivals, service-time draws, routing probabilities, cases, and random-number seeds.",
            "Generated resource capacity is not duplicated. No-overflow uses the strict candidate partition; controlled overflow temporarily allows every generated cell to receive eligible overflow while preserving the same total capacity.",
            "The matrix does not select an operational winner. Structural coherence and simulated performance are shown together for decision support.",
            "Mean waiting time is not shown because the current baseline simulator does not emit a general waiting-time metric; realized overflow wait savings are reported where available.",
        ],
    }
