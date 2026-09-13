from __future__ import annotations

from io import BytesIO, StringIO
import re
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

from .model import (
    Activity,
    Architecture,
    DesignVariable,
    ProcessModel,
    ResourcePool,
    ServiceTime,
    Transition,
)


def read_event_log_bytes(filename: str, content: bytes) -> pd.DataFrame:
    name = (filename or "").lower()
    if name.endswith(".csv"):
        return pd.read_csv(StringIO(content.decode("utf-8-sig")))
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(BytesIO(content))
    raise ValueError("Supported event-log formats are CSV, XLSX, and XLS.")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")


def _pretty(s: str) -> str:
    return str(s).replace("_", " ").strip().title()


def guess_event_columns(columns) -> dict:
    cols = list(columns)
    lower = {c: _norm(c) for c in cols}

    def pick(patterns):
        for pattern in patterns:
            for c, n in lower.items():
                if pattern in n:
                    return c
        return None

    return {
        "case_id": pick(["case_id", "caseid", "case", "process_instance", "instance_id"]),
        "activity": pick(["activity", "event_name", "event", "task", "step"]),
        "start_time": pick(["start_timestamp", "start_time", "start_datetime", "timestamp", "time"]),
        "end_time": pick(["complete_timestamp", "completion_timestamp", "end_timestamp", "end_time", "finish_time"]),
        "resource": pick(["resource", "performer", "user", "agent", "owner"]),
    }


def preview_event_log(filename: str, content: bytes) -> dict:
    df = read_event_log_bytes(filename, content)
    return {
        "filename": filename,
        "rows": int(len(df)),
        "columns": [str(c) for c in df.columns],
        "guesses": guess_event_columns(df.columns),
        "sample": df.head(8).replace({np.nan: None}).to_dict(orient="records"),
    }


def _resource_prefix(label: str) -> str:
    """Infer a reusable pool id from a performer label.

    Examples: Analyst_1 -> analyst, QA-2 -> qa, Manager 03 -> manager.
    Personal names usually remain unique; those are handled by the per-activity
    fallback below instead of becoming one-person resource pools.
    """
    n = _norm(label)
    n = re.sub(r"_?\d+$", "", n).strip("_")
    return n or "resource"


def _is_system_resource(label: str) -> bool:
    n = _norm(label)
    return n in {"system", "automation", "automated", "robot", "bot", "rpa", "machine"}


def _activity_resource_assignment(work: pd.DataFrame, activity_ids: dict[str, str]):
    assignment: dict[str, str | None] = {}
    pool_performers: dict[str, set[str]] = defaultdict(set)
    pool_activities: dict[str, set[str]] = defaultdict(set)

    for activity, g in work.groupby("activity"):
        labels = [
            str(x).strip()
            for x in g["resource"].dropna().tolist()
            if str(x).strip() not in {"", "nan", "None"}
        ]

        aid = activity_ids[str(activity)]
        if not labels:
            pool = f"pool_{aid}"
            assignment[str(activity)] = pool
            pool_activities[pool].add(str(activity))
            continue

        if all(_is_system_resource(x) for x in labels):
            assignment[str(activity)] = None
            continue

        human = [x for x in labels if not _is_system_resource(x)]
        prefixes = [_resource_prefix(x) for x in human]
        counts = Counter(prefixes)
        top_prefix, top_count = counts.most_common(1)[0]

        # If performer names do not expose a shared group prefix, infer a pool
        # from the activity and use distinct observed performers as capacity.
        share = top_count / max(len(prefixes), 1)
        if share >= 0.40 or len(counts) <= 2:
            pool = top_prefix
        else:
            pool = f"pool_{aid}"

        assignment[str(activity)] = pool
        pool_activities[pool].add(str(activity))
        for performer in human:
            pool_performers[pool].add(performer)

    return assignment, pool_performers, pool_activities


def calibrate_event_log(
    filename: str,
    content: bytes,
    template_model: ProcessModel,
    case_col: str,
    activity_col: str,
    start_col: str,
    end_col: str | None = None,
    resource_col: str | None = None,
    sla_minutes: float = 360.0,
    analyst_unit_cost: float = 120000.0,  # retained for API backward compatibility
    default_resource_cost_per_hour: float = 75.0,
) -> dict:
    df = read_event_log_bytes(filename, content).copy()

    for c, label in [(case_col, "Case ID"), (activity_col, "Activity"), (start_col, "Start Time")]:
        if not c or c not in df.columns:
            raise ValueError(f"Missing required mapping: {label}")

    if end_col and end_col not in df.columns:
        end_col = None
    if resource_col and resource_col not in df.columns:
        resource_col = None

    work = pd.DataFrame({
        "case_id": df[case_col].astype(str),
        "activity": df[activity_col].astype(str),
        "start": pd.to_datetime(df[start_col], errors="coerce", utc=True),
    })
    work["end"] = pd.to_datetime(df[end_col], errors="coerce", utc=True) if end_col else pd.NaT
    work["resource"] = df[resource_col].astype(str) if resource_col else None
    work = work.dropna(subset=["case_id", "activity", "start"]).sort_values(["case_id", "start"]).reset_index(drop=True)

    if work.empty:
        raise ValueError("No usable event rows remain after parsing the selected columns.")

    if end_col:
        work["service_minutes"] = (work["end"] - work["start"]).dt.total_seconds() / 60.0
    else:
        work["next_start"] = work.groupby("case_id")["start"].shift(-1)
        work["service_minutes"] = (work["next_start"] - work["start"]).dt.total_seconds() / 60.0

    work.loc[(work["service_minutes"] <= 0) | (work["service_minutes"] > 60 * 24 * 30), "service_minutes"] = np.nan
    global_service = float(work["service_minutes"].median())
    if not np.isfinite(global_service):
        global_service = 5.0

    stats = (
        work.groupby("activity")
        .agg(
            events=("case_id", "size"),
            mean_service_minutes=("service_minutes", "mean"),
            median_service_minutes=("service_minutes", "median"),
            std_service_minutes=("service_minutes", "std"),
        )
        .reset_index()
    )
    stats["mean_service_minutes"] = stats["mean_service_minutes"].fillna(global_service).clip(lower=0.01)
    stats["median_service_minutes"] = stats["median_service_minutes"].fillna(stats["mean_service_minutes"])
    stats["std_service_minutes"] = stats["std_service_minutes"].fillna(0.0).clip(lower=0.0)

    # Stable activity ids.
    id_map: dict[str, str] = {}
    used: set[str] = set()
    for name in stats["activity"].astype(str):
        base = _norm(name) or "activity"
        aid = base
        i = 2
        while aid in used:
            aid = f"{base}_{i}"
            i += 1
        used.add(aid)
        id_map[name] = aid

    process_end_id = "process_end"
    i = 2
    while process_end_id in used:
        process_end_id = f"process_end_{i}"
        i += 1

    # Generic resource-pool inference.
    if resource_col:
        assignment, pool_performers, pool_activities = _activity_resource_assignment(work, id_map)
    else:
        assignment = {name: f"pool_{aid}" for name, aid in id_map.items()}
        pool_performers = defaultdict(set)
        pool_activities = defaultdict(set)
        for name, pool in assignment.items():
            pool_activities[pool].add(name)

    resources: list[ResourcePool] = []
    for pool in sorted({p for p in assignment.values() if p}):
        performers = pool_performers.get(pool, set())
        capacity = max(1, len(performers)) if performers else 1
        resources.append(
            ResourcePool(
                id=pool,
                name=_pretty(pool.removeprefix("pool_")),
                capacity=capacity,
                cost_per_hour=float(default_resource_cost_per_hour),
            )
        )

    resource_capacity = {r.id: r.capacity for r in resources}

    activities: list[Activity] = []
    for _, row in stats.iterrows():
        name = str(row["activity"])
        pool = assignment.get(name)
        activities.append(
            Activity(
                id=id_map[name],
                name=name,
                resource_pool=pool,
                service_time=ServiceTime(
                    distribution="lognormal" if float(row["std_service_minutes"]) > 0 else "constant",
                    mean_minutes=float(row["mean_service_minutes"]),
                    std_minutes=float(row["std_service_minutes"]),
                ),
                cost_per_hour=float(default_resource_cost_per_hour) if pool else 0.0,
            )
        )

    activities.append(
        Activity(
            id=process_end_id,
            name="Process End",
            resource_pool=None,
            service_time=ServiceTime(distribution="constant", mean_minutes=0.01, std_minutes=0.0),
            cost_per_hour=0.0,
        )
    )

    first_acts = work.groupby("case_id").first()["activity"]
    last_acts = work.groupby("case_id").last()["activity"]
    start_activity_name = str(first_acts.value_counts().index[0])

    route_counts: Counter[tuple[str, str]] = Counter()
    variants: list[tuple[str, ...]] = []
    rework_cases = 0

    for _, g in work.groupby("case_id", sort=False):
        acts = g["activity"].astype(str).tolist()
        variants.append(tuple(acts))
        if len(set(acts)) < len(acts):
            rework_cases += 1
        for a, b in zip(acts[:-1], acts[1:]):
            route_counts[(a, b)] += 1

    for a in last_acts.astype(str):
        route_counts[(a, "__PROCESS_END__")] += 1

    outgoing_totals: Counter[str] = Counter()
    for (source, _), count in route_counts.items():
        outgoing_totals[source] += count

    transitions: list[Transition] = []
    for (source_name, target_name), count in sorted(route_counts.items()):
        source_id = id_map.get(source_name)
        target_id = process_end_id if target_name == "__PROCESS_END__" else id_map.get(target_name)
        if source_id is None or target_id is None:
            continue
        transitions.append(
            Transition(
                source=source_id,
                target=target_id,
                probability=float(count / max(outgoing_totals[source_name], 1)),
            )
        )

    architecture = Architecture(
        id="baseline",
        name="Calibrated baseline",
        enabled_activities=[a.id for a in activities],
        transitions=transitions,
    )

    # Arrival rate based on observed case starts.
    case_starts = work.groupby("case_id")["start"].min().sort_values()
    if len(case_starts) > 1:
        horizon_hours = float((case_starts.iloc[-1] - case_starts.iloc[0]).total_seconds() / 3600.0)
        arrival_rate = float((len(case_starts) - 1) / max(horizon_hours, 1e-9))
    else:
        arrival_rate = float(template_model.arrival_rate_per_hour)

    # Generic capacity variables, one per inferred human resource pool.
    variables: list[DesignVariable] = []
    for r in resources:
        cap = int(r.capacity)
        lower = max(1, int(np.floor(cap * 0.5)))
        upper = max(cap + 2, int(np.ceil(cap * 2.0)))
        variables.append(
            DesignVariable(
                name=f"resource_capacity__{r.id}",
                kind="quantized",
                lower=float(lower),
                upper=float(upper),
                step=1.0,
                value=float(cap),
            )
        )

    # Keep a generic automation dimension, but start calibrated operational
    # models at zero because an event log alone does not identify automation potential.
    variables.append(
        DesignVariable(
            name="automation_level",
            kind="continuous",
            lower=0.0,
            upper=0.8,
            value=0.0,
        )
    )
    variables.append(
        DesignVariable(
            name="architecture",
            kind="discrete",
            choices=["baseline"],
            value="baseline",
        )
    )

    calibrated = ProcessModel(
        id=f"calibrated-{_norm(filename) or 'event-log'}",
        name=f"Calibrated from {filename}",
        start_activity=id_map[start_activity_name],
        end_activity=process_end_id,
        activities=activities,
        resources=resources,
        architectures=[architecture],
        variables=variables,
        arrival_rate_per_hour=max(arrival_rate, 0.01),
        sla_minutes=float(sla_minutes),
    )

    # Empirical AS-IS summary directly from the event log.
    case_bounds = work.groupby("case_id").agg(first_start=("start", "min"), last_start=("start", "max"))
    if end_col:
        last_end = work.groupby("case_id")["end"].max()
        case_bounds["finish"] = last_end.fillna(case_bounds["last_start"])
    else:
        case_bounds["finish"] = case_bounds["last_start"]
    cycles = (case_bounds["finish"] - case_bounds["first_start"]).dt.total_seconds() / 60.0
    cycles = cycles[np.isfinite(cycles)]

    variant_counts = Counter(variants)
    top_variant_count = variant_counts.most_common(1)[0][1] if variant_counts else 0
    case_count = int(work["case_id"].nunique())

    resource_summary = []
    for r in resources:
        resource_summary.append({
            "id": r.id,
            "name": r.name,
            "capacity": int(r.capacity),
            "cost_per_hour": float(r.cost_per_hour or 0.0),
            "activities": sorted(pool_activities.get(r.id, set())),
            "observed_performers": int(len(pool_performers.get(r.id, set()))),
        })

    return {
        "model": calibrated.model_dump(),
        "summary": {
            "filename": filename,
            "rows_used": int(len(work)),
            "cases": case_count,
            "activities": int(work["activity"].nunique()),
            "resource_pools": int(len(resources)),
            "arrival_rate_per_hour": float(calibrated.arrival_rate_per_hour),
            "repeat_event_count": int(len(work) - work[["case_id", "activity"]].drop_duplicates().shape[0]),
            "rework_case_rate": float(rework_cases / max(case_count, 1)),
            "most_common_variant_share": float(top_variant_count / max(case_count, 1)),
            "mean_cycle_minutes_observed": float(cycles.mean()) if len(cycles) else 0.0,
            "p95_cycle_minutes_observed": float(np.percentile(cycles, 95)) if len(cycles) else 0.0,
            "sla_attainment_observed": float(np.mean(cycles <= sla_minutes)) if len(cycles) else 0.0,
            "start_activity": start_activity_name,
            "terminal_activity": "Process End",
            "estimated_resource_capacities": resource_capacity,
            "resources": resource_summary,
            "service_times": stats[[
                "activity", "events", "mean_service_minutes", "median_service_minutes", "std_service_minutes"
            ]].replace({np.nan: None}).to_dict(orient="records"),
            "routing": [
                {
                    "source": source,
                    "target": "Process End" if target == "__PROCESS_END__" else target,
                    "count": int(count),
                    "probability": float(count / max(outgoing_totals[source], 1)),
                }
                for (source, target), count in sorted(route_counts.items())
            ],
        },
    }
