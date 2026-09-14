from __future__ import annotations

from collections import Counter, defaultdict
from io import BytesIO
import math
import re

import numpy as np
import pandas as pd

from .model import ProcessModel

REQUIRED_SHEETS = {
    "Events": ["interaction_id", "contact_leg_id", "event_time", "event_type", "queue"],
    "Agent_Skills": ["agent_id", "resource_pool", "skill"],
    "Staffing": ["resource_pool", "interval_start", "interval_end", "capacity"],
    "Arrivals": ["interval_start", "interval_end", "rate_per_hour"],
}
OPTIONAL_SHEETS = {"Settings"}


def _safe_id(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value).strip()).strip("_").lower()
    return text or "item"


def _minutes(value) -> float:
    """Convert Excel time, HH:MM text, datetime/time, or numeric minutes to minute-of-day."""
    if pd.isna(value):
        raise ValueError("Blank interval time")
    if isinstance(value, (int, float, np.integer, np.floating)):
        x = float(value)
        # Excel stores times as fractions of a day. Treat <=1 as Excel time.
        return x * 1440.0 if 0.0 <= x <= 1.0 else x
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return float(value.hour * 60 + value.minute + getattr(value, "second", 0) / 60.0)
    text = str(value).strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return float(text)
    parsed = pd.to_datetime(text, errors="coerce")
    if pd.isna(parsed):
        raise ValueError(f"Unable to parse interval time: {value}")
    return float(parsed.hour * 60 + parsed.minute + parsed.second / 60.0)


def _read_workbook(filename: str, content: bytes) -> dict[str, pd.DataFrame]:
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise ValueError("Contact Center input must be an Excel workbook (.xlsx or .xls).")
    book = pd.ExcelFile(BytesIO(content))
    actual = {name.strip().lower(): name for name in book.sheet_names}
    frames: dict[str, pd.DataFrame] = {}
    missing_sheets = []
    for expected in REQUIRED_SHEETS:
        real = actual.get(expected.lower())
        if real is None:
            missing_sheets.append(expected)
            continue
        df = pd.read_excel(book, sheet_name=real)
        df.columns = [str(c).strip() for c in df.columns]
        frames[expected] = df
    for optional in OPTIONAL_SHEETS:
        real = actual.get(optional.lower())
        if real is not None:
            df = pd.read_excel(book, sheet_name=real)
            df.columns = [str(c).strip() for c in df.columns]
            frames[optional] = df
    if missing_sheets:
        raise ValueError("Missing required sheet(s): " + ", ".join(missing_sheets))
    errors = []
    for sheet, cols in REQUIRED_SHEETS.items():
        present = {c.strip().lower() for c in frames[sheet].columns}
        missing = [c for c in cols if c.lower() not in present]
        if missing:
            errors.append(f"{sheet}: missing " + ", ".join(missing))
    if errors:
        raise ValueError("; ".join(errors))
    # Normalize required/known columns to lower-case names.
    for sheet, df in frames.items():
        rename = {c: str(c).strip().lower() for c in df.columns}
        frames[sheet] = df.rename(columns=rename)
    return frames


def preview_contact_center_workbook(filename: str, content: bytes) -> dict:
    frames = _read_workbook(filename, content)
    return {
        "filename": filename,
        "workflow_class": "contact_center",
        "valid": True,
        "sheets": {
            name: {
                "rows": int(len(df)),
                "columns": list(df.columns),
            }
            for name, df in frames.items()
        },
        "message": "Contact Center workbook matches the expected template.",
    }


def _service_time_spec(samples: list[float]) -> dict:
    clean = [float(x) for x in samples if np.isfinite(x) and float(x) > 0]
    n = len(clean)
    if n >= 10:
        return {
            "distribution": "empirical",
            "mean_minutes": float(np.mean(clean)),
            "std_minutes": float(np.std(clean, ddof=1)) if n > 1 else 0.0,
            "samples_minutes": clean,
            "sample_count": n,
            "confidence": "high" if n >= 30 else "moderate",
        }
    if n >= 3:
        med = float(np.median(clean))
        lo = max(0.01, float(np.min(clean)))
        hi = max(med, float(np.max(clean)))
        return {
            "distribution": "triangular",
            "mean_minutes": float(np.mean(clean)),
            "std_minutes": float(np.std(clean, ddof=1)) if n > 1 else 0.0,
            "minimum_minutes": lo,
            "mode_minutes": med,
            "maximum_minutes": max(hi, lo + 0.01),
            "samples_minutes": clean,
            "sample_count": n,
            "confidence": "low",
            "fallback_reason": "Fewer than 10 observed service times; triangular fallback used.",
        }
    if n == 0:
        return {
            "distribution": "unresolved",
            "mean_minutes": 0.0,
            "std_minutes": 0.0,
            "samples_minutes": None,
            "sample_count": 0,
            "confidence": "insufficient",
            "fallback_reason": "No observed service times; user must resolve this activity before simulation.",
        }

    # Very sparse: use a broad triangular estimate but flag it for review.
    center = float(np.median(clean))
    lo = max(0.01, center * 0.5)
    hi = max(lo + 0.01, center * 1.75)
    return {
        "distribution": "triangular",
        "mean_minutes": center,
        "std_minutes": 0.0,
        "minimum_minutes": lo,
        "mode_minutes": center,
        "maximum_minutes": hi,
        "sample_count": n,
        "confidence": "insufficient",
        "fallback_reason": "Fewer than 3 observed service times; broad triangular fallback requires review.",
    }


def _settings(frames: dict[str, pd.DataFrame]) -> dict[str, str]:
    df = frames.get("Settings")
    if df is None or df.empty or "key" not in df.columns or "value" not in df.columns:
        return {}
    out = {}
    for _, row in df.iterrows():
        if pd.isna(row.get("key")):
            continue
        out[str(row["key"]).strip().lower()] = str(row.get("value", "")).strip()
    return out


def import_contact_center_workbook(filename: str, content: bytes) -> dict:
    frames = _read_workbook(filename, content)
    events = frames["Events"].copy()
    skills = frames["Agent_Skills"].copy()
    staffing = frames["Staffing"].copy()
    arrivals = frames["Arrivals"].copy()
    settings = _settings(frames)

    events["event_time"] = pd.to_datetime(events["event_time"], errors="coerce")
    if events["event_time"].isna().any():
        bad = int(events["event_time"].isna().sum())
        raise ValueError(f"Events contains {bad} invalid event_time value(s).")
    events["event_type"] = events["event_type"].astype(str).str.strip().str.upper()
    events["queue"] = events["queue"].astype(str).str.strip()
    events["interaction_id"] = events["interaction_id"].astype(str).str.strip()
    events["contact_leg_id"] = events["contact_leg_id"].astype(str).str.strip()
    if "skill" not in events.columns:
        events["skill"] = ""
    if "agent_id" not in events.columns:
        events["agent_id"] = ""

    agent_pool: dict[str, str] = {}
    agent_skills: dict[str, set[str]] = defaultdict(set)
    agent_proficiency: dict[str, dict[str, float]] = defaultdict(dict)
    pool_skills: dict[str, set[str]] = defaultdict(set)
    for _, row in skills.dropna(subset=["agent_id", "resource_pool", "skill"]).iterrows():
        aid = str(row["agent_id"]).strip()
        pool = _safe_id(row["resource_pool"])
        skill = str(row["skill"]).strip()
        proficiency = 1.0
        if "proficiency" in skills.columns and pd.notna(row.get("proficiency")):
            try:
                proficiency = float(row.get("proficiency"))
            except Exception:
                proficiency = 1.0
        proficiency = min(1.0, max(0.0, proficiency))
        agent_pool[aid] = pool
        if skill:
            agent_skills[aid].add(skill)
            agent_proficiency[aid][skill] = proficiency
            pool_skills[pool].add(skill)

    pool_profiles: dict[str, list[dict]] = defaultdict(list)
    pool_costs: dict[str, list[float]] = defaultdict(list)
    for _, row in staffing.dropna(subset=["resource_pool", "interval_start", "interval_end", "capacity"]).iterrows():
        pool = _safe_id(row["resource_pool"])
        start = _minutes(row["interval_start"])
        end = _minutes(row["interval_end"])
        cap = max(0, int(round(float(row["capacity"]))))
        if end <= start:
            raise ValueError(f"Staffing interval for {pool} must have end > start within the daily profile.")
        pool_profiles[pool].append({
            "start_minute": start,
            "end_minute": end,
            "capacity": cap,
            "label": str(row.get("label", "")).strip() or None,
        })
        if "cost_per_hour" in staffing.columns and pd.notna(row.get("cost_per_hour")):
            pool_costs[pool].append(float(row["cost_per_hour"]))

    if not pool_profiles:
        raise ValueError("Staffing sheet contains no usable resource-pool intervals.")

    arrival_profile = []
    for _, row in arrivals.dropna(subset=["interval_start", "interval_end", "rate_per_hour"]).iterrows():
        start = _minutes(row["interval_start"])
        end = _minutes(row["interval_end"])
        rate = max(0.0, float(row["rate_per_hour"]))
        if end <= start:
            raise ValueError("Arrival intervals must have end > start within the daily profile.")
        label_parts = []
        for col in ("channel", "call_type", "label"):
            if col in arrivals.columns and pd.notna(row.get(col)) and str(row[col]).strip():
                label_parts.append(str(row[col]).strip())
        arrival_profile.append({
            "start_minute": start,
            "end_minute": end,
            "rate_per_hour": rate,
            "label": " / ".join(label_parts) or None,
        })
    if not arrival_profile:
        raise ValueError("Arrivals sheet contains no usable intervals.")

    # Pair SERVICE_START and SERVICE_END by interaction/leg. Queue is treated as the workflow activity.
    starts = events[events["event_type"] == "SERVICE_START"].copy()
    ends = events[events["event_type"].isin(["SERVICE_END", "COMPLETE_SERVICE"])].copy()
    if starts.empty:
        raise ValueError("Events must contain SERVICE_START rows.")
    if ends.empty:
        raise ValueError("Events must contain SERVICE_END rows.")

    end_map = {}
    for _, row in ends.sort_values("event_time").iterrows():
        key = (row["interaction_id"], row["contact_leg_id"])
        end_map.setdefault(key, row["event_time"])

    service_samples: dict[str, list[float]] = defaultdict(list)
    queue_skills: dict[str, list[str]] = defaultdict(list)
    queue_pools: dict[str, Counter] = defaultdict(Counter)
    leg_records = []
    leg_end_times: dict[tuple[str, str], object] = {}
    for _, row in starts.sort_values("event_time").iterrows():
        queue_name = str(row["queue"]).strip()
        if not queue_name or queue_name.lower() == "nan":
            continue
        qid = _safe_id(queue_name)
        key = (row["interaction_id"], row["contact_leg_id"])
        end_time = end_map.get(key)
        if end_time is not None and end_time >= row["event_time"]:
            duration = (end_time - row["event_time"]).total_seconds() / 60.0
            leg_end_times[key] = end_time
            if duration > 0:
                service_samples[qid].append(float(duration))
        skill = str(row.get("skill", "")).strip()
        if skill and skill.lower() != "nan":
            queue_skills[qid].append(skill)
        agent = str(row.get("agent_id", "")).strip()
        if agent in agent_pool:
            queue_pools[qid][agent_pool[agent]] += 1
        leg_records.append((row["interaction_id"], row["event_time"], qid))

    queue_ids = sorted({x[2] for x in leg_records})
    if not queue_ids:
        raise ValueError("No usable queue activities were found in SERVICE_START events.")

    # Build routing counts from ordered service legs per interaction.
    transition_counts: Counter = Counter()
    transition_handoff_samples: dict[tuple[str, str], list[float]] = defaultdict(list)
    by_interaction: dict[str, list[tuple]] = defaultdict(list)

    # Rebuild leg identifiers from SERVICE_START rows so the end timestamp for
    # each leg can be matched when calculating between-queue handoff time.
    for _, row in starts.sort_values("event_time").iterrows():
        queue_name = str(row["queue"]).strip()
        if not queue_name or queue_name.lower() == "nan":
            continue
        qid = _safe_id(queue_name)
        interaction_id = str(row["interaction_id"])
        leg_id = str(row["contact_leg_id"])
        by_interaction[interaction_id].append((row["event_time"], qid, leg_id))

    for interaction_id, legs in by_interaction.items():
        ordered = sorted(legs)
        if not ordered:
            continue

        transition_counts[("contact_start", ordered[0][1])] += 1

        for left, right in zip(ordered[:-1], ordered[1:]):
            source_time, source_q, source_leg = left
            target_time, target_q, _target_leg = right
            transition_counts[(source_q, target_q)] += 1

            source_end = leg_end_times.get((interaction_id, source_leg))
            if source_end is not None and target_time >= source_end:
                delay = float((target_time - source_end).total_seconds() / 60.0)
                if np.isfinite(delay) and delay >= 0:
                    transition_handoff_samples[(source_q, target_q)].append(delay)

        transition_counts[(ordered[-1][1], "contact_complete")] += 1

    outgoing_totals: Counter = Counter()
    for (source, _target), count in transition_counts.items():
        outgoing_totals[source] += count
    transitions = [
        {
            "source": source,
            "target": target,
            "probability": float(count / outgoing_totals[source]),
            "observed_count": int(count),
            "handoff_samples_minutes": (
                [
                    float(x)
                    for x in transition_handoff_samples.get(
                        (source, target),
                        [],
                    )
                ]
                or None
            ),
        }
        for (source, target), count in sorted(transition_counts.items())
    ]

    resources = []
    for pool, profile in sorted(pool_profiles.items()):
        max_capacity = max(int(x["capacity"]) for x in profile)
        resources.append({
            "id": pool,
            "name": pool.replace("_", " ").title(),
            "capacity": max(1, max_capacity),
            "cost_per_hour": float(np.mean(pool_costs[pool])) if pool_costs[pool] else None,
            "skills": sorted(pool_skills.get(pool, set())),
            "staffing_profile": sorted(profile, key=lambda x: x["start_minute"]),
        })

    # Build an individual-resource roster. Agent_Skills provides named agents.
    # If a staffing profile calls for more concurrent positions than are named,
    # create explicit 'Unspecified' slots so every modeled FTE can be cross-trained
    # and inspected in the skill matrix rather than disappearing inside pool capacity.
    agents = []
    agents_by_pool: dict[str, list[str]] = defaultdict(list)
    for aid in sorted(agent_pool):
        pool = agent_pool[aid]
        agents_by_pool[pool].append(aid)
        pool_cost = float(np.mean(pool_costs[pool])) if pool_costs[pool] else None
        agents.append({
            "id": aid,
            "name": aid,
            "resource_pool": pool,
            "skills": sorted(agent_skills.get(aid, set())),
            "skill_proficiency": {
                skill: float(agent_proficiency.get(aid, {}).get(skill, 1.0))
                for skill in sorted(agent_skills.get(aid, set()))
            },
            "cost_per_hour": pool_cost,
            "active": True,
            "synthetic": False,
        })

    for r in resources:
        pool = r["id"]
        required_slots = max(1, int(r["capacity"]))
        current = len(agents_by_pool.get(pool, []))
        for slot in range(current + 1, required_slots + 1):
            aid = f"{pool}__unspecified_{slot:02d}"
            agents_by_pool[pool].append(aid)
            skills_for_slot = sorted(pool_skills.get(pool, set()))
            agents.append({
                "id": aid,
                "name": f"Unspecified {r['name']} #{slot}",
                "resource_pool": pool,
                "skills": skills_for_slot,
                "skill_proficiency": {skill: 1.0 for skill in skills_for_slot},
                "cost_per_hour": r.get("cost_per_hour"),
                "active": True,
                "synthetic": True,
            })

    activities = [
        {
            "id": "contact_start",
            "name": "Contact Start",
            "resource_pool": None,
            "service_time": {"distribution": "constant", "mean_minutes": 0.01, "std_minutes": 0.0},
            "cost_per_hour": 0.0,
            "required_skills": [],
            "eligible_resource_pools": [],
            "routing_policy": "fixed_pool",
            "model_source": "configured",
            "confidence": "defined",
            "terminal": False,
        }
    ]

    warnings = []
    for qid in queue_ids:
        skills_for_q = [s for s in queue_skills[qid] if s]
        required = Counter(skills_for_q).most_common(1)[0][0] if skills_for_q else ""
        eligible = [
            rid for rid, skills_set in pool_skills.items()
            if (not required or required in skills_set)
        ]
        primary = queue_pools[qid].most_common(1)[0][0] if queue_pools[qid] else (eligible[0] if eligible else None)
        spec = _service_time_spec(service_samples.get(qid, []))
        if spec.get("confidence") in ("low", "insufficient"):
            warnings.append({
                "activity": qid,
                "sample_count": spec.get("sample_count", 0),
                "message": spec.get("fallback_reason"),
            })
        activities.append({
            "id": qid,
            "name": qid.replace("_", " ").title(),
            "resource_pool": primary,
            "service_time": spec,
            "cost_per_hour": 75.0,
            "required_skills": [required] if required else [],
            "eligible_resource_pools": eligible,
            "routing_policy": "earliest_available_skill" if len(eligible) > 1 or required else "fixed_pool",
            "model_source": "event_log" if spec.get("sample_count", 0) > 0 else "unresolved",
            "confidence": spec.get("confidence") or "insufficient",
            "terminal": False,
        })

    activities.append({
        "id": "contact_complete",
        "name": "Contact Complete",
        "resource_pool": None,
        "service_time": {"distribution": "constant", "mean_minutes": 0.01, "std_minutes": 0.0},
        "cost_per_hour": 0.0,
        "required_skills": [],
        "eligible_resource_pools": [],
        "routing_policy": "fixed_pool",
        "model_source": "terminal",
        "confidence": "defined",
        "terminal": True,
    })

    variables = []
    for r in resources:
        c = int(r["capacity"])
        variables.append({
            "name": f"resource_capacity__{r['id']}",
            "kind": "quantized",
            "lower": 1.0,
            "upper": float(max(c * 2, c + 3)),
            "step": 1.0,
            "value": float(c),
        })

    weighted_rate = sum(
        float(x["rate_per_hour"]) * max(0.0, float(x["end_minute"]) - float(x["start_minute"]))
        for x in arrival_profile
    ) / max(sum(max(0.0, float(x["end_minute"]) - float(x["start_minute"])) for x in arrival_profile), 1e-9)

    model_dict = {
        "id": _safe_id(settings.get("model_id", "contact_center_model")),
        "name": settings.get("name", "Contact Center Model") or "Contact Center Model",
        "workflow_class": "contact_center",
        "start_activity": "contact_start",
        "end_activity": "contact_complete",
        "activities": activities,
        "resources": resources,
        "agents": agents,
        "architectures": [{
            "id": "baseline",
            "name": "Observed Contact Center",
            "enabled_activities": [a["id"] for a in activities],
            "transitions": transitions,
        }],
        "variables": variables,
        "arrival_rate_per_hour": float(weighted_rate),
        "sla_minutes": float(settings.get("sla_minutes", 20.0) or 20.0),
        "arrival_profile": arrival_profile,
        "arrival_profile_repeat_minutes": 1440.0,
        "staffing_profile_repeat_minutes": 1440.0,
    }

    model = ProcessModel.model_validate(model_dict)
    return {
        "model": model.model_dump(),
        "summary": {
            "workflow_class": "contact_center",
            "interactions": int(events["interaction_id"].nunique()),
            "service_legs": int(len(starts)),
            "activities": len(queue_ids),
            "resource_pools": len(resources),
            "individual_resources": len(agents),
            "arrival_intervals": len(arrival_profile),
            "staffing_intervals": int(sum(len(v) for v in pool_profiles.values())),
            "warnings": warnings,
        },
    }
