from __future__ import annotations

from collections import defaultdict
from math import exp, log1p
from typing import Any

import numpy as np

from .model import CellDefinition, ProcessModel
from .structural_analysis import analyze_cell_structure


PROFILE_WEIGHTS = {
    "balanced": {
        "routing": 0.40,
        "topology": 0.25,
        "processing": 0.20,
        "resource": 0.15,
    },
    "topology_first": {
        "routing": 0.55,
        "topology": 0.30,
        "processing": 0.10,
        "resource": 0.05,
    },
    "processing_first": {
        "routing": 0.25,
        "topology": 0.15,
        "processing": 0.45,
        "resource": 0.15,
    },
}

PROFILE_LABELS = {
    "balanced": "Balanced similarity",
    "topology_first": "Routing / topology emphasis",
    "processing_first": "Processing-character emphasis",
}


def _architecture(model: ProcessModel, architecture_id: str):
    arch = next((a for a in model.architectures if a.id == architecture_id), None)
    if arch is None:
        raise ValueError(f"Unknown architecture '{architecture_id}'.")
    return arch


def _enabled_ids(model: ProcessModel, arch) -> list[str]:
    enabled = set(arch.enabled_activities or [a.id for a in model.activities])
    return [a.id for a in model.activities if a.id in enabled]


def _normalized_outgoing(arch, enabled: set[str]) -> dict[str, list[tuple[str, float]]]:
    outgoing: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for t in arch.transitions:
        if t.source in enabled and t.target in enabled:
            outgoing[t.source].append((t.target, max(0.0, float(t.probability))))
    result: dict[str, list[tuple[str, float]]] = {}
    for src, rows in outgoing.items():
        total = sum(p for _, p in rows)
        if total > 0:
            result[src] = [(t, p / total) for t, p in rows]
    return result


def _expected_visits(model: ProcessModel, arch, ids: list[str]) -> dict[str, float]:
    if not ids:
        return {}
    enabled = set(ids)
    index = {aid: i for i, aid in enumerate(ids)}
    pmat = np.zeros((len(ids), len(ids)), dtype=float)
    for src, rows in _normalized_outgoing(arch, enabled).items():
        for tgt, p in rows:
            pmat[index[src], index[tgt]] += p

    b = np.zeros(len(ids), dtype=float)
    start = model.start_activity if model.start_activity in index else ids[0]
    b[index[start]] = 1.0
    try:
        visits = np.linalg.solve(np.eye(len(ids)) - pmat.T, b)
        if not np.all(np.isfinite(visits)) or np.any(visits < -1e-8):
            raise np.linalg.LinAlgError("invalid expected visits")
        visits = np.maximum(visits, 0.0)
    except np.linalg.LinAlgError:
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


def _activity_resource_signature(model: ProcessModel, activity) -> set[str]:
    if activity.eligible_resource_pools:
        return set(activity.eligible_resource_pools)
    if activity.required_skills:
        required = set(activity.required_skills)
        return {
            r.id
            for r in model.resources
            if required.issubset(set(r.skills or []))
        }
    if activity.resource_pool:
        return {activity.resource_pool}
    return set()


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a | b), 1)


def _feature_similarity(model: ProcessModel, arch, ids: list[str]) -> dict[tuple[str, str], dict[str, float]]:
    enabled = set(ids)
    outgoing = _normalized_outgoing(arch, enabled)
    incoming: dict[str, set[str]] = defaultdict(set)
    outgoing_neighbors: dict[str, set[str]] = defaultdict(set)
    routing_strength: dict[tuple[str, str], float] = defaultdict(float)
    visits = _expected_visits(model, arch, ids)

    max_flow = 0.0
    for src, rows in outgoing.items():
        for tgt, p in rows:
            flow = max(0.0, visits.get(src, 0.0)) * p
            routing_strength[(src, tgt)] += flow
            routing_strength[(tgt, src)] += flow
            max_flow = max(max_flow, flow)
            outgoing_neighbors[src].add(tgt)
            incoming[tgt].add(src)

    activity_map = model.activity_map()
    result: dict[tuple[str, str], dict[str, float]] = {}
    for i, aid in enumerate(ids):
        a = activity_map[aid]
        a_context = set(incoming.get(aid, set())) | set(outgoing_neighbors.get(aid, set()))
        a_res = _activity_resource_signature(model, a)
        a_mean = max(0.0, float(a.service_time.mean_minutes or 0.0))
        for bid in ids[i + 1 :]:
            b = activity_map[bid]
            b_context = set(incoming.get(bid, set())) | set(outgoing_neighbors.get(bid, set()))
            b_res = _activity_resource_signature(model, b)
            b_mean = max(0.0, float(b.service_time.mean_minutes or 0.0))

            direct = routing_strength.get((aid, bid), 0.0)
            routing = direct / max_flow if max_flow > 0 else 0.0
            topology = _jaccard(a_context, b_context)
            processing = exp(-abs(log1p(a_mean) - log1p(b_mean)))
            resource = _jaccard(a_res, b_res)
            result[(aid, bid)] = {
                "routing": float(min(1.0, max(0.0, routing))),
                "topology": float(min(1.0, max(0.0, topology))),
                "processing": float(min(1.0, max(0.0, processing))),
                "resource": float(min(1.0, max(0.0, resource))),
            }
    return result


def _pair_features(features, a: str, b: str) -> dict[str, float]:
    return features.get((a, b)) or features.get((b, a)) or {
        "routing": 0.0,
        "topology": 0.0,
        "processing": 0.0,
        "resource": 0.0,
    }


def _pair_score(features, a: str, b: str, profile: dict[str, float]) -> float:
    f = _pair_features(features, a, b)
    return float(sum(profile[k] * f[k] for k in profile))


def _cluster_similarity(features, left: list[str], right: list[str], profile: dict[str, float]) -> float:
    vals = [_pair_score(features, a, b, profile) for a in left for b in right]
    return float(np.mean(vals)) if vals else 0.0


def _agglomerative_partition(ids: list[str], k: int, features, profile: dict[str, float]) -> list[list[str]]:
    clusters = [[aid] for aid in ids]
    while len(clusters) > k:
        best = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                sim = _cluster_similarity(features, clusters[i], clusters[j], profile)
                # Small deterministic size regularizer discourages one giant cluster swallowing singletons.
                balance = -0.01 * abs(len(clusters[i]) - len(clusters[j]))
                key = (sim + balance, -max(len(clusters[i]), len(clusters[j])), -i, -j)
                if best is None or key > best[0]:
                    best = (key, i, j)
        _, i, j = best
        merged = sorted(clusters[i] + clusters[j], key=ids.index)
        clusters = [c for n, c in enumerate(clusters) if n not in (i, j)] + [merged]
        clusters.sort(key=lambda c: min(ids.index(x) for x in c))
    return clusters


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


def _largest_remainder(total: int, weights: list[float]) -> list[int]:
    total = max(0, int(total))
    if total == 0:
        return [0] * len(weights)
    arr = np.asarray([max(0.0, float(x)) for x in weights], dtype=float)
    if arr.sum() <= 0:
        out = [0] * len(weights)
        out[0] = total
        return out
    quotas = arr / arr.sum() * total
    base = np.floor(quotas).astype(int)
    remainder = total - int(base.sum())
    order = sorted(range(len(weights)), key=lambda i: (quotas[i] - base[i], arr[i], -i), reverse=True)
    for i in order[:remainder]:
        base[i] += 1
    return [int(x) for x in base]


def _assign_resources(model: ProcessModel, clusters: list[list[str]], visits: dict[str, float]) -> list[dict[str, int]]:
    activity_map = model.activity_map()
    allocations = [defaultdict(int) for _ in clusters]

    for resource in model.resources:
        demand = []
        for cluster in clusters:
            total = 0.0
            for aid in cluster:
                a = activity_map[aid]
                if a.terminal or not _resource_can_serve(a, resource):
                    continue
                total += max(0.0, visits.get(aid, 0.0)) * max(0.0, float(a.service_time.mean_minutes or 0.0))
            demand.append(total)
        alloc = _largest_remainder(int(resource.capacity or 0), demand)
        for i, value in enumerate(alloc):
            allocations[i][resource.id] = int(value)

    return [dict(x) for x in allocations]


def _cell_explanation(model: ProcessModel, arch, cluster: list[str], allocation: dict[str, int], profile_key: str) -> str:
    activity_map = model.activity_map()
    enabled = set(cluster)
    transition_total = 0.0
    internal = 0.0
    all_enabled = set(arch.enabled_activities or [a.id for a in model.activities])
    for t in arch.transitions:
        if t.source not in all_enabled or t.target not in all_enabled:
            continue
        if t.source in enabled:
            p = max(0.0, float(t.probability))
            transition_total += p
            if t.target in enabled:
                internal += p
    locality = internal / transition_total if transition_total > 0 else 1.0

    means = [max(0.0, float(activity_map[a].service_time.mean_minutes or 0.0)) for a in cluster if not activity_map[a].terminal]
    mean_service = float(np.mean(means)) if means else 0.0
    resources = [
        (next((r.name for r in model.resources if r.id == rid), rid), cap)
        for rid, cap in allocation.items() if cap > 0
    ]
    resources.sort(key=lambda x: (-x[1], x[0]))
    resource_text = ", ".join(f"{name}×{cap}" for name, cap in resources[:3]) or "no dedicated resource capacity"

    profile_phrase = {
        "balanced": "routing, topology, processing-time and resource similarity",
        "topology_first": "routing and process-graph proximity",
        "processing_first": "processing-time similarity, with routing and resource compatibility retained",
    }[profile_key]
    return (
        f"Grouped primarily by {profile_phrase}. "
        f"The cell contains {len(cluster)} activities, keeps about {100.0 * locality:.0f}% of its outgoing routing probability inside the cell, "
        f"has mean activity service time {mean_service:.1f} min, and is assigned {resource_text}."
    )


def generate_cell_candidates(
    model: ProcessModel,
    architecture_id: str,
    k_values: list[int] | None = None,
    structural_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    arch = _architecture(model, architecture_id)
    ids = _enabled_ids(model, arch)
    if len(ids) < 2:
        raise ValueError("Candidate generation requires at least two enabled activities.")

    requested = k_values or [2, 3]
    k_values_clean = sorted({int(k) for k in requested if 2 <= int(k) <= len(ids)})
    if not k_values_clean:
        raise ValueError("No feasible candidate cell counts were requested.")

    features = _feature_similarity(model, arch, ids)
    visits = _expected_visits(model, arch, ids)
    candidates = []
    seen_partitions = set()

    for k in k_values_clean:
        for profile_key, profile in PROFILE_WEIGHTS.items():
            clusters = _agglomerative_partition(ids, k, features, profile)
            canonical = tuple(sorted(tuple(sorted(c)) for c in clusters))
            if canonical in seen_partitions:
                continue
            seen_partitions.add(canonical)

            allocations = _assign_resources(model, clusters, visits)
            cells = []
            for idx, cluster in enumerate(clusters):
                cells.append(CellDefinition(
                    id=f"candidate_{k}_{profile_key}_cell_{idx + 1}",
                    name=f"Cell {idx + 1}",
                    activity_ids=list(cluster),
                    resource_capacities=allocations[idx],
                    preferred_work_types=[],
                    cross_cell_eligible=False,
                ))

            candidate_model = model.model_copy(deep=True)
            candidate_model.cells = cells
            analysis = analyze_cell_structure(candidate_model, architecture_id, structural_weights)
            explanations = [
                {
                    "cell_id": cells[i].id,
                    "cell_name": cells[i].name,
                    "text": _cell_explanation(model, arch, clusters[i], allocations[i], profile_key),
                }
                for i in range(len(cells))
            ]
            candidates.append({
                "id": f"k{k}_{profile_key}",
                "k": k,
                "profile": profile_key,
                "profile_label": PROFILE_LABELS[profile_key],
                "similarity_weights": profile,
                "cells": [c.model_dump() for c in cells],
                "structural_analysis": analysis,
                "explanations": explanations,
            })

    return {
        "architecture_id": architecture_id,
        "candidate_count": len(candidates),
        "k_values": k_values_clean,
        "candidates": candidates,
        "notes": [
            "Candidates are generated heuristically from routing, topology, processing-time, and resource-compatibility similarity.",
            "No candidate is automatically recommended. Structural scores are decision-support measures only; simulation is required before judging operational performance.",
            "Resource capacity is partitioned without duplication using estimated activity demand and baseline pool capacities.",
        ],
    }
