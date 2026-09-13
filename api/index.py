from __future__ import annotations

from io import StringIO
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd

from .core.demo import DEMO_MODEL
from .core.model import ProcessModel
from .core.mining import mine_log, compare_mined_logs
from .core.simulation import simulate
from .core.optimization import (
    Constraint,
    optimize_families,
    calculate_structural_capacity,
)

app = FastAPI(
    title="Process Design Space Platform API",
    version="0.10.0",
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


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "version": "0.10.0",
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

        out[
            "metrics"
        ][
            "max_resource_utilization"
        ] = capacity[
            "max_resource_utilization"
        ]

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

        out["metrics"][
            "flow_balance"
        ] = float(
            out["metrics"][
                "throughput_per_hour"
            ]
            / max(float(realized), 1e-9)
        )

        return out

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


@app.post("/api/compare")
def compare_endpoint():
    actual = simulate(
        DEMO_MODEL,
        "baseline",
        {},
        cases=1200,
        seed=2,
        emit_log=True,
    )

    optimized_design = {
        "analyst_capacity": 6,
        "senior_capacity": 2,
        "qa_capacity": 2,
        "automation_level": 0.45,
        "qa_rework_rate": 0.04,
    }

    future = simulate(
        DEMO_MODEL,
        "straight_through",
        optimized_design,
        cases=1200,
        seed=2,
        emit_log=True,
    )

    a = pd.DataFrame(
        actual["event_log"]
    )

    b = pd.DataFrame(
        future["event_log"]
    )

    return {
        "baseline_metrics": actual[
            "metrics"
        ],
        "future_metrics": future[
            "metrics"
        ],
        "mined_comparison": compare_mined_logs(
            a,
            b,
        ),
    }
