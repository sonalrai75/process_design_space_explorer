from __future__ import annotations

from copy import deepcopy
from io import BytesIO, StringIO
import re

import numpy as np
import pandas as pd

from .model import ProcessModel


def read_event_log_bytes(filename: str, content: bytes) -> pd.DataFrame:
    name = (filename or "").lower()

    if name.endswith(".csv"):
        return pd.read_csv(
            StringIO(
                content.decode(
                    "utf-8-sig"
                )
            )
        )

    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(
            BytesIO(content)
        )

    raise ValueError(
        "Supported event-log formats in v0.11 are CSV, XLSX, and XLS."
    )


def _norm(s: str) -> str:
    return re.sub(
        r"[^a-z0-9]+",
        "_",
        str(s).strip().lower(),
    ).strip("_")


def guess_event_columns(columns) -> dict:
    cols = list(columns)
    lower = {
        c: _norm(c)
        for c in cols
    }

    def pick(patterns):
        for pattern in patterns:
            for c, n in lower.items():
                if pattern in n:
                    return c
        return None

    return {
        "case_id": pick([
            "case_id",
            "caseid",
            "case",
            "process_instance",
            "instance_id",
        ]),
        "activity": pick([
            "activity",
            "event_name",
            "event",
            "task",
            "step",
        ]),
        "start_time": pick([
            "start_timestamp",
            "start_time",
            "start_datetime",
            "timestamp",
            "time",
        ]),
        "end_time": pick([
            "complete_timestamp",
            "completion_timestamp",
            "end_timestamp",
            "end_time",
            "finish_time",
        ]),
        "resource": pick([
            "resource",
            "performer",
            "user",
            "agent",
            "owner",
        ]),
    }


def preview_event_log(
    filename: str,
    content: bytes,
) -> dict:
    df = read_event_log_bytes(
        filename,
        content,
    )

    guesses = guess_event_columns(
        df.columns
    )

    sample = (
        df.head(8)
        .replace({
            np.nan: None
        })
        .to_dict(
            orient="records"
        )
    )

    return {
        "filename": filename,
        "rows": int(len(df)),
        "columns": [
            str(c)
            for c in df.columns
        ],
        "guesses": guesses,
        "sample": sample,
    }


def _clone_with_updates(
    template: dict,
    **updates,
) -> dict:
    out = deepcopy(template)

    for k, v in updates.items():
        if k in out:
            out[k] = v

    return out


def _set_cost_fields(
    obj: dict,
    value: float,
):
    for k in list(obj.keys()):
        if (
            "cost" in k.lower()
            and isinstance(
                obj[k],
                (int, float),
            )
        ):
            obj[k] = float(value)


def _resource_key(
    template: dict,
) -> str | None:
    for k, v in template.items():
        if (
            isinstance(v, list)
            and v
            and isinstance(v[0], dict)
            and "capacity" in v[0]
            and k != "variables"
        ):
            return k

    return None


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
    analyst_unit_cost: float = 120000.0,
) -> dict:
    df = read_event_log_bytes(
        filename,
        content,
    ).copy()

    required = [
        case_col,
        activity_col,
        start_col,
    ]

    missing = [
        c
        for c in required
        if not c
        or c not in df.columns
    ]

    if missing:
        raise ValueError(
            "Missing required mapping(s): "
            + ", ".join(
                str(x)
                for x in missing
            )
        )

    if (
        end_col
        and end_col not in df.columns
    ):
        end_col = None

    if (
        resource_col
        and resource_col not in df.columns
    ):
        resource_col = None

    work = pd.DataFrame({
        "case_id": df[
            case_col
        ].astype(str),
        "activity": df[
            activity_col
        ].astype(str),
        "start": pd.to_datetime(
            df[start_col],
            errors="coerce",
            utc=True,
        ),
    })

    if end_col:
        work["end"] = pd.to_datetime(
            df[end_col],
            errors="coerce",
            utc=True,
        )
    else:
        work["end"] = pd.NaT

    if resource_col:
        work["resource"] = (
            df[resource_col]
            .astype(str)
        )
    else:
        work["resource"] = None

    work = work.dropna(
        subset=[
            "case_id",
            "activity",
            "start",
        ]
    )

    if work.empty:
        raise ValueError(
            "No usable event rows remain after parsing the selected columns."
        )

    work = work.sort_values(
        [
            "case_id",
            "start",
        ]
    ).reset_index(
        drop=True
    )

    # Service time calibration.
    if end_col:
        work[
            "service_minutes"
        ] = (
            (
                work["end"]
                - work["start"]
            )
            .dt.total_seconds()
            / 60.0
        )
    else:
        work[
            "next_start"
        ] = (
            work.groupby(
                "case_id"
            )["start"]
            .shift(-1)
        )

        work[
            "service_minutes"
        ] = (
            (
                work[
                    "next_start"
                ]
                - work["start"]
            )
            .dt.total_seconds()
            / 60.0
        )

    work.loc[
        (
            work[
                "service_minutes"
            ] <= 0
        )
        | (
            work[
                "service_minutes"
            ] > 60 * 24 * 30
        ),
        "service_minutes",
    ] = np.nan

    global_service = float(
        work[
            "service_minutes"
        ].median()
    )

    if not np.isfinite(
        global_service
    ):
        global_service = 5.0

    activity_stats = (
        work.groupby(
            "activity"
        )
        .agg(
            events=(
                "case_id",
                "size",
            ),
            mean_service_minutes=(
                "service_minutes",
                "mean",
            ),
            median_service_minutes=(
                "service_minutes",
                "median",
            ),
        )
        .reset_index()
    )

    activity_stats[
        "mean_service_minutes"
    ] = (
        activity_stats[
            "mean_service_minutes"
        ]
        .fillna(
            global_service
        )
        .clip(
            lower=0.01
        )
    )

    # Routing calibration.
    first_acts = (
        work.groupby(
            "case_id"
        )
        .first()[
            "activity"
        ]
    )

    last_acts = (
        work.groupby(
            "case_id"
        )
        .last()[
            "activity"
        ]
    )

    start_activity_name = str(
        first_acts
        .value_counts()
        .index[0]
    )

    route_rows = []

    for _, g in work.groupby(
        "case_id",
        sort=False,
    ):
        acts = (
            g["activity"]
            .astype(str)
            .tolist()
        )

        for a, b in zip(
            acts[:-1],
            acts[1:],
        ):
            route_rows.append(
                (
                    a,
                    b,
                )
            )

    route_counts = {}

    for a, b in route_rows:
        route_counts[
            (
                a,
                b,
            )
        ] = (
            route_counts.get(
                (
                    a,
                    b,
                ),
                0,
            )
            + 1
        )

    terminal_name = "Complete"

    for a in last_acts.astype(
        str
    ):
        route_counts[
            (
                a,
                terminal_name,
            )
        ] = (
            route_counts.get(
                (
                    a,
                    terminal_name,
                ),
                0,
            )
            + 1
        )

    outgoing_totals = {}

    for (
        source,
        target,
    ), count in route_counts.items():
        outgoing_totals[
            source
        ] = (
            outgoing_totals.get(
                source,
                0,
            )
            + count
        )

    template = deepcopy(
        template_model.model_dump()
    )

    old_activities = template.get(
        "activities",
        [],
    )

    old_transitions = template.get(
        "transitions",
        [],
    )

    if not old_activities:
        raise ValueError(
            "The process-model template contains no activity definition to clone."
        )

    activity_template = deepcopy(
        old_activities[0]
    )

    end_template = deepcopy(
        next(
            (
                a
                for a in old_activities
                if a.get(
                    "id"
                )
                == template.get(
                    "end_activity"
                )
            ),
            old_activities[-1],
        )
    )

    transition_template = (
        deepcopy(
            old_transitions[0]
        )
        if old_transitions
        else {
            "source": "",
            "target": "",
            "probability": 1.0,
        }
    )

    names = (
        activity_stats[
            "activity"
        ]
        .astype(str)
        .tolist()
    )

    id_map = {}

    used = set()

    for name in names:
        base = (
            _norm(name)
            or "activity"
        )

        aid = base
        i = 2

        while aid in used:
            aid = f"{base}_{i}"
            i += 1

        used.add(aid)
        id_map[name] = aid

    complete_id = (
        "complete"
        if "complete" not in used
        else "complete_end"
    )

    new_activities = []

    for _, row in activity_stats.iterrows():
        name = str(
            row["activity"]
        )

        act = deepcopy(
            activity_template
        )

        if "id" in act:
            act["id"] = id_map[
                name
            ]

        if "name" in act:
            act["name"] = name

        # v0.11 deliberately uses the generic analyst pool so the current
        # simulator/optimizer can consume calibrated models without changing
        # its stable design-variable semantics. The visual modeler lets the
        # user reassign activities to other existing pools afterward.
        if "resource_pool" in act:
            act[
                "resource_pool"
            ] = "analyst"

        st = act.get(
            "service_time"
        )

        if isinstance(
            st,
            dict,
        ):
            if (
                "mean_minutes"
                in st
            ):
                st[
                    "mean_minutes"
                ] = float(
                    row[
                        "mean_service_minutes"
                    ]
                )

        new_activities.append(
            act
        )

    complete = deepcopy(
        end_template
    )

    if "id" in complete:
        complete["id"] = complete_id

    if "name" in complete:
        complete["name"] = "Complete"

    if isinstance(
        complete.get(
            "service_time"
        ),
        dict,
    ):
        if (
            "mean_minutes"
            in complete[
                "service_time"
            ]
        ):
            complete[
                "service_time"
            ][
                "mean_minutes"
            ] = 0.01

    new_activities.append(
        complete
    )

    new_transitions = []

    for (
        source_name,
        target_name,
    ), count in route_counts.items():
        t = deepcopy(
            transition_template
        )

        source_id = id_map.get(
            source_name
        )

        target_id = (
            complete_id
            if target_name
            == terminal_name
            else id_map.get(
                target_name
            )
        )

        if (
            source_id is None
            or target_id is None
        ):
            continue

        if "source" in t:
            t["source"] = source_id

        if "target" in t:
            t["target"] = target_id

        if "probability" in t:
            t["probability"] = float(
                count
                / max(
                    outgoing_totals[
                        source_name
                    ],
                    1,
                )
            )

        new_transitions.append(
            t
        )

    template[
        "activities"
    ] = new_activities

    template[
        "transitions"
    ] = new_transitions

    template[
        "start_activity"
    ] = id_map[
        start_activity_name
    ]

    template[
        "end_activity"
    ] = complete_id

    if "name" in template:
        template[
            "name"
        ] = (
            f"Calibrated from {filename}"
        )

    # Arrival rate from observed case starts.
    case_starts = (
        work.groupby(
            "case_id"
        )["start"]
        .min()
        .sort_values()
    )

    if len(case_starts) > 1:
        horizon_hours = float(
            (
                case_starts.iloc[-1]
                - case_starts.iloc[0]
            )
            .total_seconds()
            / 3600.0
        )

        arrival_rate = float(
            (
                len(case_starts)
                - 1
            )
            / max(
                horizon_hours,
                1e-9,
            )
        )
    else:
        arrival_rate = float(
            template.get(
                "arrival_rate_per_hour",
                1.0,
            )
        )

    template[
        "arrival_rate_per_hour"
    ] = max(
        arrival_rate,
        0.01,
    )

    if (
        "sla_minutes"
        in template
    ):
        template[
            "sla_minutes"
        ] = float(
            sla_minutes
        )

    # Keep the existing resource-pool schema, but calibrate analyst capacity
    # from the distinct performers if available.
    rkey = _resource_key(
        template
    )

    estimated_capacity = 1

    if resource_col:
        vals = (
            work["resource"]
            .dropna()
            .astype(str)
        )

        vals = vals[
            ~vals.isin(
                [
                    "",
                    "nan",
                    "None",
                ]
            )
        ]

        if len(vals):
            estimated_capacity = max(
                1,
                int(
                    vals.nunique()
                ),
            )

    if rkey:
        resources = deepcopy(
            template[rkey]
        )

        for resource in resources:
            rid = str(
                resource.get(
                    "id",
                    ""
                )
            )

            if rid == "analyst":
                if (
                    "capacity"
                    in resource
                ):
                    resource[
                        "capacity"
                    ] = int(
                        estimated_capacity
                    )

                _set_cost_fields(
                    resource,
                    analyst_unit_cost,
                )

        template[rkey] = resources

    # Update existing analyst-capacity variable while preserving the stable
    # demo optimization semantics.
    for var in template.get(
        "variables",
        [],
    ):
        if (
            var.get(
                "name"
            )
            == "analyst_capacity"
        ):
            if "value" in var:
                var[
                    "value"
                ] = float(
                    estimated_capacity
                )

            if "lower" in var:
                var[
                    "lower"
                ] = float(
                    max(
                        1,
                        estimated_capacity
                        // 2,
                    )
                )

            if "upper" in var:
                var[
                    "upper"
                ] = float(
                    max(
                        estimated_capacity
                        + 2,
                        estimated_capacity
                        * 2,
                    )
                )

    # Rebuild a single baseline architecture around the discovered flow.
    archs = template.get(
        "architectures",
        [],
    )

    if archs:
        arch = deepcopy(
            archs[0]
        )

        if "id" in arch:
            arch["id"] = "baseline"

        if "name" in arch:
            arch[
                "name"
            ] = "Calibrated baseline"

        if (
            "enabled_activities"
            in arch
        ):
            arch[
                "enabled_activities"
            ] = [
                a.get("id")
                for a
                in new_activities
                if a.get("id")
            ]

        for k in list(
            arch.keys()
        ):
            kl = k.lower()

            if (
                k
                not in {
                    "id",
                    "name",
                    "enabled_activities",
                }
                and (
                    "override" in kl
                    or "disabled" in kl
                )
            ):
                if isinstance(
                    arch[k],
                    list,
                ):
                    arch[k] = []
                elif isinstance(
                    arch[k],
                    dict,
                ):
                    arch[k] = {}

        template[
            "architectures"
        ] = [
            arch
        ]

    calibrated = (
        ProcessModel
        .model_validate(
            template
        )
    )

    repeat_events = int(
        len(work)
        - work[
            [
                "case_id",
                "activity",
            ]
        ]
        .drop_duplicates()
        .shape[0]
    )

    routing_summary = [
        {
            "source": (
                source
            ),
            "target": (
                target
            ),
            "count": int(
                count
            ),
            "probability": float(
                count
                / max(
                    outgoing_totals[
                        source
                    ],
                    1,
                )
            ),
        }
        for (
            source,
            target,
        ), count
        in sorted(
            route_counts.items()
        )
    ]

    resource_summary = []

    if resource_col:
        for act, g in work.groupby(
            "activity"
        ):
            resource_summary.append(
                {
                    "activity": str(
                        act
                    ),
                    "unique_resources": int(
                        g[
                            "resource"
                        ]
                        .dropna()
                        .nunique()
                    ),
                }
            )

    return {
        "model": calibrated.model_dump(),
        "summary": {
            "filename": filename,
            "rows_used": int(
                len(work)
            ),
            "cases": int(
                work[
                    "case_id"
                ].nunique()
            ),
            "activities": int(
                work[
                    "activity"
                ].nunique()
            ),
            "arrival_rate_per_hour": float(
                template[
                    "arrival_rate_per_hour"
                ]
            ),
            "estimated_analyst_capacity": int(
                estimated_capacity
            ),
            "repeat_event_count": repeat_events,
            "start_activity": (
                start_activity_name
            ),
            "terminal_activity": (
                "Complete"
            ),
            "service_times": (
                activity_stats[
                    [
                        "activity",
                        "events",
                        "mean_service_minutes",
                        "median_service_minutes",
                    ]
                ]
                .replace({
                    np.nan: None
                })
                .to_dict(
                    orient="records"
                )
            ),
            "routing": routing_summary,
            "resources_by_activity": resource_summary,
        },
    }
