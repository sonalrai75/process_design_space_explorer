# Process Design Space Platform

Closed-loop prototype: **Model → Mine → Simulate → Optimize → Simulate → Mine → Compare**.

## Current modules

- Python process-model schema for activities, routing, resource pools, service-time distributions, architectures and design variables.
- Event-log miner for service times, transition probabilities, arrival rate, cycle time and repeats.
- Lightweight queue/resource simulation that emits synthetic event logs.
- Evolving-SVD/null-space optimizer for continuous and quantized variables.
- Discrete architectures treated as separate continuous manifold families.
- AS-IS / TO-BE event-log comparison.
- Next.js product shell plus FastAPI endpoints.

## Local backend test (Git Bash / Windows)

```bash
cd /c/projects/process_design_space_platform
python -m venv .venv
source .venv/Scripts/activate
pip install -r api/requirements.txt
uvicorn api.index:app --reload
```

Open `http://127.0.0.1:8000/docs` and test in this order:

1. `GET /api/demo/model`
2. `POST /api/simulate`
3. `POST /api/calibrate/sample`
4. `POST /api/optimize`
5. `POST /api/compare`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Event-log schema

CSV upload to `/api/mine` expects:

```text
case_id,activity,start_time,end_time,resource
```

`resource` is optional for the current miner.

## Next build steps

1. Full visual process modeler / graph editor.
2. PM4Py discovery + conformance integration.
3. Replace the compact simulator with SimPy calendars, resource pools, queues, priorities and batching.
4. Automatic `event log → calibrated model` creation with user confirmation.
5. Persistent storage for models/logs/experiments.
6. Async optimization jobs for large experiments.
7. Interactive before/after process maps and 3-D transition-delay/volume views.
