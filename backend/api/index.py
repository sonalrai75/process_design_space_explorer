from __future__ import annotations

from io import StringIO
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np

from .core.demo import DEMO_MODEL
from .core.model import ProcessModel
from .core.mining import mine_log, compare_mined_logs
from .core.simulation import simulate
from .core.cellularization import run_phase1_paired_comparison, run_phase2_paired_comparison
from .core.calibration import preview_event_log, calibrate_event_log
from .core.contact_center_excel import (
    preview_contact_center_workbook,
    import_contact_center_workbook,
)
from .core.optimization import (
    Constraint,
    optimize_families,
    calculate_structural_capacity,
)

app = FastAPI(
    title="Process Design Space Platform API",
    version="0.13.5",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulationRequest(BaseModel):
    model: ProcessModel = DEMO_MODEL
    architecture_id: str = "baseline"
    design: dict[str, float] = {}
    cases: int = 1500
    seed: int = 7


class OptimizationRequest(BaseModel):
    model: ProcessModel = DEMO_MODEL

    constraints: list[dict] = [
        {
            "metric": "flow_balance",
            "kind": "ge",
            "value": 0.98,
            "active_band": 0.02,
        },
        {
            "metric": "p95_cycle_minutes",
            "kind": "le",
            "value": 600.0,
            "active_band": 0.10,
        },
        {
            "metric": "sla_attainment",
            "kind": "ge",
            "value": 0.90,
            "active_band": 0.05,
        },
        {
            "metric": "max_resource_utilization",
            "kind": "le",
            "value": 0.95,
            "active_band": 0.05,
        },
    ]

    objective: str = "annual_cost"
    sense: str = "min"

    optimization_iterations: int = 24
    cases: int = 500

    robustness_target: float = 0.90

    quick_replications: int = 12
    quick_cases: int = 500

    robustness_replications: int = 40
    robustness_cases: int = 1200




class CellularizationPhase1Request(BaseModel):
    model: ProcessModel = DEMO_MODEL
    architecture_id: str | None = None
    cases: int = 1200
    seed: int = 700
    replications: int = 12


class CellularizationPhase2Request(BaseModel):
    model: ProcessModel = DEMO_MODEL
    architecture_id: str | None = None
    cases: int = 1200
    seed: int = 900
    replications: int = 12
    local_wait_threshold_minutes: float = 30.0
    max_overflow_fraction: float = 1.0


class CompareRequest(BaseModel):
    model: ProcessModel = DEMO_MODEL
    baseline_architecture_id: str | None = None
    future_architecture_id: str | None = None
    future_design: dict[str, float] = {}
    cases: int = 1200
    seed: int = 2
    replications: int = 20


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "version": "0.13.5",
    }


@app.get("/api/demo/model")
def demo_model():
    return DEMO_MODEL.model_dump()


@app.post("/api/simulate")
def simulate_endpoint(
    req: SimulationRequest,
):
    try:
        out = simulate(
            req.model,
            req.architecture_id,
            req.design,
            cases=req.cases,
            seed=req.seed,
            emit_log=True,
        )

        capacity = calculate_structural_capacity(
            req.model,
            req.architecture_id,
            req.design,
        )

        out[
            "structural_capacity"
        ] = capacity

        # Preserve utilization measured by the simulator for time-varying
        # staffing and skill-based routing. Fall back to structural capacity.
        out["metrics"].setdefault(
            "max_resource_utilization",
            capacity["max_resource_utilization"],
        )

        realized = out["metrics"].get(
            "realized_arrival_rate_per_hour",
            out["metrics"].get(
                "realized_arrival_rate",
                float(req.model.arrival_rate_per_hour),
            ),
        )

        out["metrics"][
            "realized_arrival_rate_per_hour"
        ] = float(realized)

        raw_flow_balance = float(
            out["metrics"]["throughput_per_hour"]
            / max(float(realized), 1e-9)
        )

        out["metrics"]["raw_flow_balance"] = raw_flow_balance
        out["metrics"]["flow_balance"] = min(raw_flow_balance, 1.0)

        return out

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )




@app.post("/api/contact-center/preview")
async def contact_center_preview(file: UploadFile = File(...)):
    try:
        content = await file.read()
        return preview_contact_center_workbook(
            file.filename or "contact_center.xlsx",
            content,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/contact-center/import")
async def contact_center_import(file: UploadFile = File(...)):
    try:
        content = await file.read()
        return import_contact_center_workbook(
            file.filename or "contact_center.xlsx",
            content,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/event-log/preview")
async def event_log_preview(
    file: UploadFile = File(...),
):
    try:
        content = await file.read()

        return preview_event_log(
            file.filename or "event_log.csv",
            content,
        )

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


@app.post("/api/event-log/calibrate")
async def event_log_calibrate(
    file: UploadFile = File(...),
    case_col: str = Form(...),
    activity_col: str = Form(...),
    start_col: str = Form(...),
    end_col: str = Form(""),
    resource_col: str = Form(""),
    sla_minutes: float = Form(360.0),
    analyst_unit_cost: float = Form(120000.0),
):
    try:
        content = await file.read()

        result = calibrate_event_log(
            file.filename or "event_log.csv",
            content,
            DEMO_MODEL,
            case_col=case_col,
            activity_col=activity_col,
            start_col=start_col,
            end_col=(end_col or None),
            resource_col=(resource_col or None),
            sla_minutes=sla_minutes,
            analyst_unit_cost=analyst_unit_cost,
        )

        calibrated_model = ProcessModel.model_validate(result["model"])
        design = {
            v.name: float(v.value)
            for v in calibrated_model.variables
            if v.kind in ("continuous", "quantized")
        }
        capacity = calculate_structural_capacity(
            calibrated_model,
            calibrated_model.architectures[0].id,
            design,
        )
        result["summary"]["bottleneck_resource"] = capacity["bottleneck_resource"]
        result["summary"]["max_resource_utilization"] = capacity["max_resource_utilization"]
        result["summary"]["capacity_status"] = capacity["capacity_status"]
        result["summary"]["resource_utilizations"] = capacity["resource_utilizations"]
        return result

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )



@app.post("/api/mine")
async def mine_endpoint(
    file: UploadFile = File(...),
):
    try:
        content = await file.read()

        df = pd.read_csv(
            StringIO(
                content.decode(
                    "utf-8"
                )
            )
        )

        return mine_log(df)

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


@app.post("/api/calibrate/sample")
def calibrate_sample():
    base = simulate(
        DEMO_MODEL,
        "baseline",
        {},
        cases=1000,
        seed=4,
        emit_log=True,
    )

    df = pd.DataFrame(
        base["event_log"]
    )

    return mine_log(df)


@app.post("/api/optimize")
def optimize_endpoint(
    req: OptimizationRequest,
):
    try:
        constraints = [
            Constraint(**x)
            for x in req.constraints
        ]

        return {
            "results": optimize_families(
                req.model,
                constraints,
                req.objective,
                req.sense,
                optimization_iterations=(
                    req.optimization_iterations
                ),
                cases=req.cases,
                robustness_target=(
                    req.robustness_target
                ),
                quick_replications=(
                    req.quick_replications
                ),
                quick_cases=(
                    req.quick_cases
                ),
                robustness_replications=(
                    req.robustness_replications
                ),
                robustness_cases=(
                    req.robustness_cases
                ),
            )
        }

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


@app.post("/api/experiments/cellularization/phase1")
def cellularization_phase1_endpoint(req: CellularizationPhase1Request):
    try:
        architecture_id = req.architecture_id or req.model.architectures[0].id
        return run_phase1_paired_comparison(
            req.model,
            architecture_id,
            cases=req.cases,
            seed=req.seed,
            replications=req.replications,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/experiments/cellularization/phase2")
def cellularization_phase2_endpoint(req: CellularizationPhase2Request):
    try:
        architecture_id = req.architecture_id or req.model.architectures[0].id
        return run_phase2_paired_comparison(
            req.model,
            architecture_id,
            cases=req.cases,
            seed=req.seed,
            replications=req.replications,
            local_wait_threshold_minutes=req.local_wait_threshold_minutes,
            max_overflow_fraction=req.max_overflow_fraction,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/compare")
def compare_endpoint(req: CompareRequest):
    try:
        baseline_arch = (
            req.baseline_architecture_id
            or req.model.architectures[0].id
        )
        future_arch = (
            req.future_architecture_id
            or baseline_arch
        )

        replications = max(
            1,
            int(req.replications),
        )

        baseline_capacity = calculate_structural_capacity(
            req.model,
            baseline_arch,
            {},
        )
        future_capacity = calculate_structural_capacity(
            req.model,
            future_arch,
            req.future_design,
        )

        metric_names = [
            "annual_cost",
            "throughput_per_hour",
            "realized_arrival_rate_per_hour",
            "flow_balance",
            "p95_cycle_minutes",
            "sla_attainment",
            "backlog_growth_per_hour",
        ]

        baseline_samples = {
            k: []
            for k in metric_names
        }
        future_samples = {
            k: []
            for k in metric_names
        }

        first_actual = None
        first_future = None

        for i in range(replications):
            # Common random numbers: the AS-IS and TO-BE simulations use the
            # same seed in each paired replication so differences are driven
            # primarily by the design, not different random demand/service draws.
            seed = int(req.seed) + i

            actual = simulate(
                req.model,
                baseline_arch,
                {},
                cases=req.cases,
                seed=seed,
                emit_log=(i == 0),
            )
            future = simulate(
                req.model,
                future_arch,
                req.future_design,
                cases=req.cases,
                seed=seed,
                emit_log=(i == 0),
            )

            actual["metrics"]["max_resource_utilization"] = (
                baseline_capacity["max_resource_utilization"]
            )
            future["metrics"]["max_resource_utilization"] = (
                future_capacity["max_resource_utilization"]
            )

            for result in (actual, future):
                realized = float(
                    result["metrics"].get(
                        "realized_arrival_rate_per_hour",
                        result["metrics"].get(
                            "realized_arrival_rate",
                            req.model.arrival_rate_per_hour,
                        ),
                    )
                )
                raw = float(
                    result["metrics"]["throughput_per_hour"]
                    / max(realized, 1e-9)
                )
                result["metrics"][
                    "realized_arrival_rate_per_hour"
                ] = realized
                result["metrics"]["raw_flow_balance"] = raw
                result["metrics"]["flow_balance"] = min(
                    raw,
                    1.0,
                )

            if i == 0:
                first_actual = actual
                first_future = future

            for name in metric_names:
                baseline_samples[name].append(
                    float(actual["metrics"][name])
                )
                future_samples[name].append(
                    float(future["metrics"][name])
                )

        def summarize(samples: dict, capacity: dict) -> dict:
            summary = {}

            for name, values in samples.items():
                arr = np.asarray(
                    values,
                    dtype=float,
                )
                summary[name] = float(
                    arr.mean()
                )
                summary[
                    f"{name}_std"
                ] = float(
                    arr.std(ddof=1)
                    if len(arr) > 1
                    else 0.0
                )

            summary[
                "max_resource_utilization"
            ] = float(
                capacity[
                    "max_resource_utilization"
                ]
            )

            return summary

        baseline_metrics = summarize(
            baseline_samples,
            baseline_capacity,
        )
        future_metrics = summarize(
            future_samples,
            future_capacity,
        )

        paired_deltas = {}

        for name in metric_names:
            a = np.asarray(
                baseline_samples[name],
                dtype=float,
            )
            b = np.asarray(
                future_samples[name],
                dtype=float,
            )
            d = b - a

            paired_deltas[name] = {
                "mean": float(
                    d.mean()
                ),
                "std": float(
                    d.std(ddof=1)
                    if len(d) > 1
                    else 0.0
                ),
            }

        mined = None

        if (
            first_actual
            and first_future
            and first_actual.get(
                "event_log"
            )
            and first_future.get(
                "event_log"
            )
        ):
            a = pd.DataFrame(
                first_actual[
                    "event_log"
                ]
            )
            b = pd.DataFrame(
                first_future[
                    "event_log"
                ]
            )
            mined = compare_mined_logs(
                a,
                b,
            )

        return {
            "baseline_architecture": baseline_arch,
            "future_architecture": future_arch,
            "future_design": req.future_design,
            "baseline_metrics": baseline_metrics,
            "future_metrics": future_metrics,
            "baseline_capacity": baseline_capacity,
            "future_capacity": future_capacity,
            "comparison_method": {
                "replications": replications,
                "cases_per_replication": int(
                    req.cases
                ),
                "common_random_numbers": True,
                "seed_start": int(
                    req.seed
                ),
            },
            "paired_deltas": paired_deltas,
            "mined_comparison": mined,
        }

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )


