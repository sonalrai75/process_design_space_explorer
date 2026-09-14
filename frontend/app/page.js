"use client";

import { useEffect, useState } from "react";

const API =
  process.env.NEXT_PUBLIC_API_BASE || "";

const card = {
  background:"#ffffff",
  border:"1px solid #e2e8f0",
  borderRadius:18,
  padding:20,
  boxShadow:"0 8px 28px rgba(15,23,42,.055)"
};

const buttonStyle = {
  minHeight:40,
  padding:"9px 14px",
  borderRadius:10,
  border:"1px solid #cbd5e1",
  background:"#ffffff",
  color:"#0f172a",
  fontWeight:650,
  cursor:"pointer",
  boxShadow:"0 1px 2px rgba(15,23,42,.04)"
};

const primaryButtonStyle = {
  ...buttonStyle,
  border:"1px solid #0f172a",
  background:"#0f172a",
  color:"#ffffff",
  boxShadow:"0 6px 16px rgba(15,23,42,.16)"
};

const accentButtonStyle = {
  ...buttonStyle,
  border:"1px solid #4f46e5",
  background:"#4f46e5",
  color:"#ffffff",
  boxShadow:"0 6px 16px rgba(79,70,229,.18)"
};

function Metric({label,value}) {
  return (
    <div style={{...card,padding:16,boxShadow:"0 4px 16px rgba(15,23,42,.04)"}}>
      <div style={{
        fontSize:11,
        fontWeight:750,
        letterSpacing:".045em",
        textTransform:"uppercase",
        color:"#64748b"
      }}>
        {label}
      </div>

      <div style={{
        fontSize:26,
        fontWeight:760,
        letterSpacing:"-.02em",
        color:"#0f172a",
        marginTop:6
      }}>
        {value}
      </div>
    </div>
  );
}

function fmtPct(v) {
  return (
    (100 * Number(v)).toFixed(1)
    + "%"
  );
}

function fmtFlow(v) {
  return (
    (100 * Math.min(Number(v), 1)).toFixed(1)
    + "%"
  );
}

function fmtMin(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function money(v) {
  return (
    "$"
    + Math.round(Number(v))
      .toLocaleString()
  );
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return m > 0
    ? `${m}m ${String(s).padStart(2,"0")}s`
    : `${s}s`;
}



function activeArchitecture(model) {
  const architectures =
    Array.isArray(model?.architectures)
    ? model.architectures
    : [];

  if (!architectures.length) {
    return null;
  }

  const architectureVariable =
    Array.isArray(model?.variables)
    ? model.variables.find(
        v => v.name === "architecture"
      )
    : null;

  const selectedId =
    architectureVariable?.value;

  return (
    architectures.find(
      a => a.id === selectedId
    )
    || architectures[0]
  );
}

function activeTransitions(model) {
  const arch =
    activeArchitecture(model);

  return Array.isArray(
    arch?.transitions
  )
    ? arch.transitions
    : [];
}

function ProcessGraph({model}) {
  const activities =
    Array.isArray(model?.activities)
    ? model.activities
    : [];

  const transitions =
    activeTransitions(model);

  if (!activities.length) {
    return (
      <div style={{
        color:"#6b7280",
        fontSize:13
      }}>
        No activities to display.
      </div>
    );
  }

  const byId =
    Object.fromEntries(
      activities.map(
        a => [a.id,a]
      )
    );

  const outgoing = {};

  transitions.forEach(t => {
    if (!outgoing[t.source]) {
      outgoing[t.source] = [];
    }

    outgoing[t.source].push(
      t.target
    );
  });

  // Breadth-first levels give a stable left-to-right process layout.
  // Cycles/rework edges are retained as edges but do not alter node level.
  const level = {};
  const start =
    model?.start_activity
    && byId[model.start_activity]
    ? model.start_activity
    : activities[0].id;

  level[start] = 0;

  const queue = [start];

  while (queue.length) {
    const current =
      queue.shift();

    const nexts =
      outgoing[current] || [];

    nexts.forEach(next => {
      if (
        byId[next]
        && level[next] === undefined
      ) {
        level[next] =
          level[current] + 1;

        queue.push(next);
      }
    });
  }

  // Put disconnected activities to the right rather than dropping them.
  let maxLevel =
    Math.max(
      0,
      ...Object.values(level)
    );

  activities.forEach(a => {
    if (level[a.id] === undefined) {
      maxLevel += 1;
      level[a.id] = maxLevel;
    }
  });

  const groups = {};

  activities.forEach(a => {
    const l = level[a.id];

    if (!groups[l]) {
      groups[l] = [];
    }

    groups[l].push(a);
  });

  const levels =
    Object.keys(groups)
    .map(Number)
    .sort((a,b) => a-b);

  const nodeW = 160;
  const nodeH = 68;
  const xGap = 90;
  const yGap = 44;
  const marginX = 35;
  const marginY = 35;

  const maxRows =
    Math.max(
      1,
      ...levels.map(
        l => groups[l].length
      )
    );

  const width =
    Math.max(
      720,
      marginX * 2
      + levels.length * nodeW
      + Math.max(
          0,
          levels.length - 1
        ) * xGap
    );

  const height =
    Math.max(
      220,
      marginY * 2
      + maxRows * nodeH
      + Math.max(
          0,
          maxRows - 1
        ) * yGap
    );

  const pos = {};

  levels.forEach((l,li) => {
    const group =
      groups[l];

    const groupHeight =
      group.length * nodeH
      + Math.max(
          0,
          group.length - 1
        ) * yGap;

    const y0 =
      (height - groupHeight) / 2;

    group.forEach((a,ri) => {
      pos[a.id] = {
        x:
          marginX
          + li * (
              nodeW + xGap
            ),
        y:
          y0
          + ri * (
              nodeH + yGap
            )
      };
    });
  });

  function edgePath(
    source,
    target,
    index
  ) {
    const s = pos[source];
    const t = pos[target];

    if (!s || !t) {
      return "";
    }

    const sx =
      s.x + nodeW;

    const sy =
      s.y + nodeH / 2;

    const tx =
      t.x;

    const ty =
      t.y + nodeH / 2;

    // Forward branch / merge.
    if (tx > sx + 10) {
      const bend =
        Math.max(
          35,
          (tx - sx) * 0.48
        );

      return (
        `M ${sx} ${sy} `
        + `C ${sx+bend} ${sy}, `
        + `${tx-bend} ${ty}, `
        + `${tx} ${ty}`
      );
    }

    // Same-level or backward edges are rework / loop-like.
    const loopOffset =
      38 + (index % 4) * 13;

    const top =
      Math.max(
        10,
        Math.min(
          sy,
          ty
        ) - loopOffset
      );

    return (
      `M ${sx} ${sy} `
      + `C ${sx+loopOffset} ${top}, `
      + `${tx-loopOffset} ${top}, `
      + `${tx} ${ty}`
    );
  }

  return (
    <div style={{
      overflowX:"auto",
      border:"1px solid #e5e7eb",
      borderRadius:12,
      background:"#fafafa"
    }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Process workflow graph"
      >
        <defs>
          <marker
            id="process-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill="#64748b"
            />
          </marker>
        </defs>

        {transitions.map(
          (t,i) => {
            const s = pos[t.source];
            const target =
              pos[t.target];

            if (!s || !target) {
              return null;
            }

            const backward =
              target.x <= s.x;

            const mx =
              backward
              ? (
                  s.x
                  + target.x
                  + nodeW
                ) / 2
              : (
                  s.x
                  + nodeW
                  + target.x
                ) / 2;

            const my =
              backward
              ? Math.max(
                  16,
                  Math.min(
                    s.y,
                    target.y
                  ) - 24
                )
              : (
                  s.y
                  + target.y
                  + nodeH
                ) / 2;

            return (
              <g key={
                `${t.source}-${t.target}-${i}`
              }>
                <path
                  d={edgePath(
                    t.source,
                    t.target,
                    i
                  )}
                  fill="none"
                  stroke={
                    backward
                    ? "#b45309"
                    : "#64748b"
                  }
                  strokeWidth="2"
                  strokeDasharray={
                    backward
                    ? "6 4"
                    : undefined
                  }
                  markerEnd="url(#process-arrow)"
                />

                {t.probability
                  !== undefined
                  &&
                  <g>
                    <rect
                      x={mx-24}
                      y={my-10}
                      width="48"
                      height="19"
                      rx="8"
                      fill="#fff"
                      stroke="#e5e7eb"
                    />

                    <text
                      x={mx}
                      y={my+4}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#475569"
                    >
                      {
                        (
                          100
                          * Number(
                              t.probability
                              || 0
                            )
                        ).toFixed(0)
                      }%
                    </text>
                  </g>
                }
              </g>
            );
          }
        )}

        {activities.map(a => {
          const p = pos[a.id];

          if (!p) return null;

          const isStart =
            a.id
            === model.start_activity;

          const isEnd =
            a.id
            === model.end_activity;

          return (
            <g
              key={a.id}
              transform={
                `translate(${p.x},${p.y})`
              }
            >
              <rect
                width={nodeW}
                height={nodeH}
                rx="12"
                fill={
                  isStart
                  ? "#eef2ff"
                  : isEnd
                    ? "#ecfdf5"
                    : "#ffffff"
                }
                stroke={
                  isStart
                  ? "#6366f1"
                  : isEnd
                    ? "#10b981"
                    : "#cbd5e1"
                }
                strokeWidth={
                  isStart || isEnd
                  ? "2"
                  : "1.5"
                }
              />

              <text
                x={nodeW/2}
                y="25"
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill="#111827"
              >
                {
                  String(
                    a.name || a.id
                  ).length > 21
                  ? String(
                      a.name || a.id
                    ).slice(0,20) + "…"
                  : a.name || a.id
                }
              </text>

              <text
                x={nodeW/2}
                y="45"
                textAnchor="middle"
                fontSize="10.5"
                fill="#64748b"
              >
                {
                  Number(
                    a.service_time
                    ?.mean_minutes
                    || 0
                  ).toFixed(1)
                } min · {
                  a.resource_pool
                  || "no pool"
                }
              </text>

              {(isStart || isEnd)
                &&
                <text
                  x={nodeW/2}
                  y="60"
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill={
                    isStart
                    ? "#4f46e5"
                    : "#059669"
                  }
                >
                  {
                    isStart
                    ? "START"
                    : "END"
                  }
                </text>
              }
            </g>
          );
        })}
      </svg>

      <div style={{
        fontSize:11,
        color:"#64748b",
        padding:"0 12px 10px"
      }}>
        Solid arrows show forward routing. Dashed amber arrows
        indicate same-level/backward routing such as rework loops.
        Edge labels are routing probabilities.
      </div>
    </div>
  );
}

function FrontierCard({title,item,target}) {
  if (!item) {
    return (
      <div style={{
        ...card,
        background:"#fafafa"
      }}>
        <div style={{
          fontSize:12,
          color:"#6b7280",
          textTransform:"uppercase",
          fontWeight:700
        }}>
          {title}
        </div>

        <div style={{
          marginTop:8,
          fontWeight:700,
          color:"#991b1b"
        }}>
          No candidate met the target
        </div>
      </div>
    );
  }

  const met =
    item.robustness_probability
    >= target;

  return (
    <div style={{
      ...card,
      background:"#fafafa"
    }}>
      <div style={{
        fontSize:12,
        color:"#6b7280",
        textTransform:"uppercase",
        fontWeight:700
      }}>
        {title}
      </div>

      <div style={{
        fontSize:22,
        fontWeight:700,
        marginTop:6
      }}>
        {money(item.cost)}
      </div>

      <div style={{
        fontSize:14,
        marginTop:4,
        color:met
          ? "#166534"
          : "#991b1b",
        fontWeight:700
      }}>
        {met
          ? "TARGET MET"
          : "TARGET NOT MET"} · {
          fmtPct(
            item.robustness_probability
          )
        }
      </div>

      <div style={{
        fontSize:12,
        marginTop:4,
        color:"#6b7280"
      }}>
        95% CI [
        {
          fmtPct(
            item.robustness_ci95.lower
          )
        },{" "}
        {
          fmtPct(
            item.robustness_ci95.upper
          )
        }]
      </div>

      <div style={{
        fontSize:12,
        marginTop:4,
        color:"#6b7280"
      }}>
        Throughput {
          item.quick_robustness
          .mean_throughput
          .toFixed(2)
        }/hr · Flow balance {
          fmtFlow(item.quick_robustness
            .mean_flow_balance)
        } · SLA {
          fmtPct(
            item.quick_robustness
            .mean_sla
          )
        } · Max util {
          fmtPct(
            item.quick_robustness
            .max_resource_utilization
          )
        }
      </div>
    </div>
  );
}

export default function Home() {
  const [
    status,
    setStatus
  ] = useState("Ready");

  const [
    workflowClass,
    setWorkflowClass
  ] = useState("general");

  const [
    contactCenterPreview,
    setContactCenterPreview
  ] = useState(null);

  const [
    runningAction,
    setRunningAction
  ] = useState(null);

  const [
    elapsed,
    setElapsed
  ] = useState(0);

  const [
    model,
    setModel
  ] = useState(null);

  const [
    sim,
    setSim
  ] = useState(null);

  const [
    opt,
    setOpt
  ] = useState(null);

  const [
    cmp,
    setCmp
  ] = useState(null);

  const [
    logFile,
    setLogFile
  ] = useState(null);

  const [
    logPreview,
    setLogPreview
  ] = useState(null);

  const [
    mapping,
    setMapping
  ] = useState({
    case_id:"",
    activity:"",
    start_time:"",
    end_time:"",
    resource:""
  });

  const [
    calibration,
    setCalibration
  ] = useState(null);

  const [
    designVariableEnabled,
    setDesignVariableEnabled
  ] = useState({});

  const [
    manualCommitted,
    setManualCommitted
  ] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        "pds_committed_manual_design"
      );
      if (!raw) return;
      const committed = JSON.parse(raw);
      if (committed?.model && committed?.design) {
        setManualCommitted(committed);
        setModel(committed.model);
      }
    } catch (_) {
      // Ignore stale/local malformed state.
    }
  }, []);

  useEffect(() => {
    if (!runningAction) {
      setElapsed(0);
      return;
    }

    const started =
      Date.now();

    const timer =
      setInterval(() => {
        setElapsed(
          Math.floor(
            (
              Date.now()
              - started
            )
            / 1000
          )
        );
      }, 1000);

    return () =>
      clearInterval(timer);
  }, [runningAction]);

  async function call(
    path,
    options,
    actionLabel
  ) {
    setRunningAction(
      actionLabel
      || "Running"
    );

    setStatus(
      actionLabel
      || "Running"
    );

    try {
      const r = await fetch(
        `${API}${path}`,
        options
      );

      const data =
        await r.json();

      if (!r.ok) {
        throw new Error(
          data.detail
          || "Request failed"
        );
      }

      setStatus("Ready");
      return data;

    } finally {
      setRunningAction(null);
    }
  }

  async function loadModel() {
    try {
      setModel(
        await call(
          "/api/demo/model",
          undefined,
          "Loading model"
        )
      );

    } catch(e) {
      setStatus(e.message);
    }
  }

  async function loadModelJsonFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.activities || !parsed?.resources || !parsed?.architectures) {
        throw new Error("The selected JSON is not a valid process model.");
      }
      setModel(parsed);
      setSim(null);
      setOpt(null);
      setCmp(null);
      setCalibration(null);
      setManualCommitted(null);
      setStatus(`Loaded ${parsed.name || file.name}`);
    } catch (e) {
      setStatus(e.message || "Unable to load model JSON");
    } finally {
      event.target.value = "";
    }
  }

  async function runSimulation() {
    try {
      let m = model;

      if (!m) {
        m = await call(
          "/api/demo/model",
          undefined,
          "Loading model"
        );

        setModel(m);
      }

      setSim(
        await call(
          "/api/simulate",
          {
            method:"POST",
            headers:{
              "Content-Type":
                "application/json"
            },
            body:JSON.stringify({
              model:m,
              architecture_id:
                "baseline",
              design:{},
              cases:1500,
              seed:7
            })
          },
          "Running simulation"
        )
      );

    } catch(e) {
      setStatus(e.message);
    }
  }

  async function runOptimize() {
    try {
      setOpt(null);

      let optimizationModel = model;

      if (model) {
        const numericVars =
          numericDesignVariables(model);

        const selectedVars =
          numericVars.filter(
            v => designVariableEnabled[v.name] !== false
          );

        if (numericVars.length && !selectedVars.length) {
          setStatus(
            "Select at least one design variable before optimization"
          );
          return;
        }

        for (const v of selectedVars) {
          const lo = Number(v.lower);
          const hi = Number(v.upper);

          if (
            !Number.isFinite(lo)
            || !Number.isFinite(hi)
            || hi <= lo
          ) {
            setStatus(
              `Invalid bounds for ${v.name}: Max must be greater than Min`
            );
            return;
          }

          if (
            v.kind === "quantized"
            && (
              !Number.isFinite(Number(v.step))
              || Number(v.step) <= 0
            )
          ) {
            setStatus(
              `Invalid step for ${v.name}: Step must be greater than zero`
            );
            return;
          }
        }

        optimizationModel = {
          ...model,
          variables:(model.variables || []).filter(
            v =>
              !isNumericDesignVariable(v)
              || designVariableEnabled[v.name] !== false
          )
        };
      }

      setOpt(
        await call(
          "/api/optimize",
          {
            method:"POST",
            headers:{
              "Content-Type":
                "application/json"
            },
            body:JSON.stringify({
              model:optimizationModel || undefined,
              robustness_target:0.90
            })
          },
          "Running robust optimization"
        )
      );

    } catch(e) {
      setStatus(e.message);
    }
  }

  function openManualSvd() {
    if (!model) {
      setStatus("Load or calibrate a model first");
      return;
    }

    const numericVars =
      numericDesignVariables(model);

    const manualModel = {
      ...model,
      variables:(model.variables || []).filter(
        v =>
          !isNumericDesignVariable(v)
          || designVariableEnabled[v.name] !== false
      )
    };

    if (numericVars.length && !manualModel.variables.some(isNumericDesignVariable)) {
      setStatus("Select at least one design variable for manual SVD exploration");
      return;
    }

    localStorage.setItem(
      "pds_manual_model",
      JSON.stringify(manualModel)
    );
    localStorage.setItem(
      "pds_design_variable_enabled",
      JSON.stringify(designVariableEnabled)
    );
    window.location.href = "/manual-svd";
  }

  async function runCompare() {
    try {
      setCmp(
        await call(
          "/api/compare",
          {
            method:"POST",
            headers:{
              "Content-Type":"application/json"
            },
            body:JSON.stringify(
              manualCommitted
              ? {
                  model:manualCommitted.model,
                  baseline_architecture_id:
                    manualCommitted.baseline_architecture_id
                    || manualCommitted.architecture_id,
                  future_architecture_id:
                    manualCommitted.architecture_id,
                  future_design:
                    manualCommitted.design,
                  replications:20,
                  cases:1200,
                  seed:2
                }
              : { model:model || undefined }
            )
          },
          "Comparing AS-IS vs TO-BE"
        )
      );

    } catch(e) {
      setStatus(e.message);
    }
  }


  function getResourceKey(m) {
    if (!m) return null;

    return Object.keys(m).find(
      k =>
        Array.isArray(m[k])
        && m[k].length
        && typeof m[k][0] === "object"
        && m[k][0] !== null
        && Object.prototype.hasOwnProperty.call(
          m[k][0],
          "capacity"
        )
        && k !== "variables"
    ) || null;
  }

  function resourceOptions(m) {
    const key =
      getResourceKey(m);

    if (!key) return [];

    return m[key]
      .map(r => r.id)
      .filter(Boolean);
  }

  function isNumericDesignVariable(v) {
    return (
      v?.kind === "continuous"
      || v?.kind === "quantized"
    );
  }

  function numericDesignVariables(m) {
    return Array.isArray(m?.variables)
      ? m.variables.filter(
          isNumericDesignVariable
        )
      : [];
  }

  function updateDesignVariable(
    name,
    field,
    value
  ) {
    setModel(prev => {
      if (!prev) return prev;

      return {
        ...prev,
        variables:(prev.variables || []).map(v => {
          if (v.name !== name) return v;

          if (field === "kind") {
            return {
              ...v,
              kind:value,
              step:
                value === "quantized"
                ? Number(v.step || 1)
                : v.step
            };
          }

          return {
            ...v,
            [field]:Number(value)
          };
        })
      };
    });
  }

  function currentDesignValue(v) {
    for (const key of [
      "value",
      "current",
      "initial",
      "default"
    ]) {
      if (
        v?.[key] !== undefined
        && v?.[key] !== null
        && Number.isFinite(Number(v[key]))
      ) {
        return Number(v[key]);
      }
    }

    return null;
  }

  function updateActivity(
    id,
    field,
    value
  ) {
    setModel(prev => {
      if (!prev) return prev;

      return {
        ...prev,
        activities:
          (prev.activities || []).map(a => {
            if (a.id !== id) {
              return a;
            }

            if (
              field
              === "mean_minutes"
            ) {
              return {
                ...a,
                service_time:{
                  ...a.service_time,
                  mean_minutes:
                    Number(value)
                }
              };
            }

            return {
              ...a,
              [field]:value
            };
          })
      };
    });
  }

  function updateTransition(
    index,
    field,
    value
  ) {
    setModel(prev => {
      if (!prev) return prev;

      const selected =
        activeArchitecture(prev);

      if (!selected) {
        return prev;
      }

      const architectures =
        (prev.architectures || [])
        .map(arch => {
          if (
            arch.id
            !== selected.id
          ) {
            return arch;
          }

          const transitions = [
            ...(arch.transitions || [])
          ];

          transitions[index] = {
            ...transitions[index],
            [field]:
              field === "probability"
              ? Number(value)
              : value
          };

          return {
            ...arch,
            transitions
          };
        });

      return {
        ...prev,
        architectures
      };
    });
  }

  function updateResource(
    id,
    field,
    value
  ) {
    setModel(prev => {
      if (!prev) return prev;

      const key =
        getResourceKey(prev);

      if (!key) return prev;

      return {
        ...prev,
        [key]:
          prev[key].map(r =>
            r.id === id
            ? {
                ...r,
                [field]:
                  Number(value)
              }
            : r
          )
      };
    });
  }

  function addActivity() {
    setModel(prev => {
      if (
        !prev
        || !(prev.activities || []).length
      ) {
        return prev;
      }

      const base =
        JSON.parse(
          JSON.stringify(
            prev.activities[0]
          )
        );

      const id =
        `activity_${Date.now()}`;

      base.id = id;
      base.name =
        "New Activity";

      if (base.service_time) {
        base.service_time = {
          ...base.service_time,
          mean_minutes:5
        };
      }

      const resources =
        resourceOptions(prev);

      if (
        resources.length
        && Object.prototype
          .hasOwnProperty.call(
            base,
            "resource_pool"
          )
      ) {
        base.resource_pool =
          resources[0];
      }

      const architectures =
        Array.isArray(
          prev.architectures
        )
        ? prev.architectures.map(
            a => ({
              ...a,
              enabled_activities:
                Array.isArray(
                  a.enabled_activities
                )
                ? [
                    ...a
                      .enabled_activities,
                    id
                  ]
                : a
                  .enabled_activities
            })
          )
        : prev.architectures;

      return {
        ...prev,
        activities:[
          ...prev.activities,
          base
        ],
        architectures
      };
    });
  }

  function removeActivity(id) {
    setModel(prev => {
      if (
        !prev
        || id
          === prev.start_activity
        || id
          === prev.end_activity
      ) {
        return prev;
      }

      return {
        ...prev,
        activities:
          (prev.activities || []).filter(
            a => a.id !== id
          ),
        architectures:
          Array.isArray(
            prev.architectures
          )
          ? prev.architectures.map(
              a => ({
                ...a,
                enabled_activities:
                  Array.isArray(
                    a.enabled_activities
                  )
                  ? a
                    .enabled_activities
                    .filter(
                      x => x !== id
                    )
                  : a
                    .enabled_activities,
                transitions:
                  Array.isArray(
                    a.transitions
                  )
                  ? a.transitions.filter(
                      t =>
                        t.source !== id
                        && t.target !== id
                    )
                  : []
              })
            )
          : prev.architectures
      };
    });
  }

  function addTransition() {
    setModel(prev => {
      if (!prev) {
        return prev;
      }

      const selected =
        activeArchitecture(prev);

      if (!selected) {
        return prev;
      }

      const t =
        selected.transitions?.length
        ? JSON.parse(
            JSON.stringify(
              selected.transitions[0]
            )
          )
        : {
            source:
              prev.start_activity,
            target:
              prev.end_activity,
            probability:1
          };

      t.source =
        prev.start_activity;

      t.target =
        prev.end_activity;

      t.probability = 1;

      return {
        ...prev,
        architectures:
          (prev.architectures || [])
          .map(arch =>
            arch.id === selected.id
            ? {
                ...arch,
                transitions:[
                  ...(arch.transitions || []),
                  t
                ]
              }
            : arch
          )
      };
    });
  }

  function removeTransition(
    index
  ) {
    setModel(prev => {
      if (!prev) return prev;

      const selected =
        activeArchitecture(prev);

      if (!selected) {
        return prev;
      }

      return {
        ...prev,
        architectures:
          (prev.architectures || [])
          .map(arch =>
            arch.id === selected.id
            ? {
                ...arch,
                transitions:
                  (arch.transitions || [])
                  .filter(
                    (_,i) => i !== index
                  )
              }
            : arch
          )
      };
    });
  }

  function downloadModel() {
    if (!model) return;

    const blob =
      new Blob(
        [
          JSON.stringify(
            model,
            null,
            2
          )
        ],
        {
          type:
            "application/json"
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        "a"
      );

    a.href = url;
    a.download =
      "process_model.json";

    document.body
      .appendChild(a);

    a.click();
    a.remove();

    URL.revokeObjectURL(
      url
    );
  }

  async function loadContactCenterSample() {
    try {
      setStatus("Loading Contact Center sample workbook");

      const response = await fetch(
        "/templates/contact_center_sample.xlsx"
      );

      if (!response.ok) {
        throw new Error("Unable to load the sample workbook");
      }

      const blob = await response.blob();
      const form = new FormData();
      form.append(
        "file",
        new File(
          [blob],
          "contact_center_sample.xlsx",
          {
            type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }
        )
      );

      const data = await call(
        "/api/contact-center/import",
        { method:"POST", body:form },
        "Loading Contact Center sample"
      );

      setModel(data.model);
      setCalibration(data.summary);
      setSim(null);
      setOpt(null);
      setCmp(null);
      setManualCommitted(null);
      setContactCenterPreview(null);
      setLogFile(null);
      setStatus("Contact Center sample loaded");
    } catch(e) {
      setStatus(e.message);
    }
  }

  async function previewContactCenterWorkbook() {
    if (!logFile) {
      setStatus("Choose a Contact Center Excel workbook first");
      return;
    }

    try {
      const form = new FormData();
      form.append("file", logFile);

      const data = await call(
        "/api/contact-center/preview",
        { method:"POST", body:form },
        "Validating Contact Center workbook"
      );

      setContactCenterPreview(data);
      setStatus("Contact Center workbook is valid");
    } catch(e) {
      setContactCenterPreview(null);
      setStatus(e.message);
    }
  }

  async function importContactCenterWorkbook() {
    if (!logFile) {
      setStatus("Choose a Contact Center Excel workbook first");
      return;
    }

    try {
      const form = new FormData();
      form.append("file", logFile);

      const data = await call(
        "/api/contact-center/import",
        { method:"POST", body:form },
        "Building Contact Center model"
      );

      setModel(data.model);
      setCalibration(data.summary);
      setSim(null);
      setOpt(null);
      setCmp(null);
      setManualCommitted(null);
      setContactCenterPreview(null);
      setStatus("Contact Center model loaded");
    } catch(e) {
      setStatus(e.message);
    }
  }

  async function previewEventLog() {
    if (!logFile) {
      setStatus(
        "Choose an event-log file first"
      );
      return;
    }

    try {
      const form =
        new FormData();

      form.append(
        "file",
        logFile
      );

      const data =
        await call(
          "/api/event-log/preview",
          {
            method:"POST",
            body:form
          },
          "Inspecting event log"
        );

      setLogPreview(data);

      setMapping({
        case_id:
          data.guesses
          ?.case_id || "",
        activity:
          data.guesses
          ?.activity || "",
        start_time:
          data.guesses
          ?.start_time || "",
        end_time:
          data.guesses
          ?.end_time || "",
        resource:
          data.guesses
          ?.resource || ""
      });

    } catch(e) {
      setStatus(e.message);
    }
  }

  async function calibrateEventLog() {
    if (
      !logFile
      || !mapping.case_id
      || !mapping.activity
      || !mapping.start_time
    ) {
      setStatus(
        "Map Case ID, Activity, and Start Time first"
      );
      return;
    }

    try {
      const form =
        new FormData();

      form.append(
        "file",
        logFile
      );

      form.append(
        "case_col",
        mapping.case_id
      );

      form.append(
        "activity_col",
        mapping.activity
      );

      form.append(
        "start_col",
        mapping.start_time
      );

      form.append(
        "end_col",
        mapping.end_time || ""
      );

      form.append(
        "resource_col",
        mapping.resource || ""
      );

      form.append(
        "sla_minutes",
        String(
          model?.sla_minutes
          || 360
        )
      );

      const data =
        await call(
          "/api/event-log/calibrate",
          {
            method:"POST",
            body:form
          },
          "Calibrating event log"
        );

      setModel(
        data.model
      );

      setCalibration(
        data.summary
      );

      setSim(null);
      setOpt(null);
      setCmp(null);

    } catch(e) {
      setStatus(e.message);
    }
  }

  const busy =
    Boolean(runningAction);

  return (
    <main style={{
      maxWidth:1240,
      margin:"0 auto",
      padding:"24px 22px 72px",
      color:"#0f172a"
    }}>
      <header style={{
        background:"rgba(255,255,255,.94)",
        border:"1px solid #e2e8f0",
        borderRadius:18,
        boxShadow:"0 10px 34px rgba(15,23,42,.06)",
        overflow:"hidden"
      }}>
        <div style={{
          display:"flex",
          alignItems:"center",
          justifyContent:"space-between",
          gap:16,
          padding:"14px 18px",
          borderBottom:"1px solid #eef2f7",
          flexWrap:"wrap"
        }}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{
              width:34,height:34,borderRadius:10,
              display:"grid",placeItems:"center",
              background:"linear-gradient(135deg,#0f172a,#4338ca)",
              color:"#fff",fontWeight:800,fontSize:14
            }}>PD</div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:"#0f172a"}}>Process Design Space</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:1}}>Digital twin & optimization workspace</div>
            </div>
          </div>
          <nav style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <a href="/" style={{padding:"7px 10px",borderRadius:8,background:"#f1f5f9",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Workspace</a>
            <a href="/manual-svd" style={{padding:"7px 10px",borderRadius:8,color:"#475569",fontSize:13,fontWeight:700,textDecoration:"none"}}>Manual SVD</a>
            <a href="/about.html" target="_blank" rel="noopener noreferrer" style={{padding:"7px 10px",borderRadius:8,color:"#475569",fontSize:13,fontWeight:700,textDecoration:"none"}}>About</a>
          </nav>
        </div>

        <div style={{
          padding:"26px 24px 24px",
          background:"linear-gradient(135deg,#ffffff 0%,#f8fafc 58%,#eef2ff 100%)"
        }}>
          <div style={{
            display:"flex",justifyContent:"space-between",gap:24,
            alignItems:"flex-start",flexWrap:"wrap"
          }}>
            <div style={{maxWidth:820}}>
              <div style={{
                display:"inline-flex",alignItems:"center",gap:7,
                padding:"5px 9px",borderRadius:999,
                background:"#eef2ff",color:"#4338ca",
                fontSize:11,fontWeight:800,letterSpacing:".055em",textTransform:"uppercase"
              }}>Process intelligence</div>
              <h1 style={{
                fontSize:"clamp(30px,4vw,44px)",lineHeight:1.08,
                letterSpacing:"-.035em",color:"#0f172a",margin:"12px 0 10px"
              }}>Process Design Space Explorer</h1>
              <p style={{
                maxWidth:790,color:"#475569",lineHeight:1.65,
                margin:0,fontSize:15
              }}>
                Build a process digital twin, quantify capacity and cycle-time behavior,
                and move from AS-IS to robust TO-BE designs using automated or human-guided optimization.
              </p>
            </div>
            <div style={{
              display:"flex",alignItems:"center",gap:8,
              padding:"8px 11px",borderRadius:999,
              background:busy ? "#eef2ff" : "#ecfdf5",
              color:busy ? "#4338ca" : "#047857",
              border:`1px solid ${busy ? "#c7d2fe" : "#a7f3d0"}`,
              fontSize:12,fontWeight:750,whiteSpace:"nowrap"
            }}>
              <span style={{width:7,height:7,borderRadius:"50%",background:busy ? "#6366f1" : "#10b981"}} />
              {busy ? runningAction : status}
            </div>
          </div>
        </div>
      </header>

      {busy &&
        <div style={{
          marginTop:16,
          padding:"14px 16px",
          borderRadius:12,
          border:
            "1px solid #c7d2fe",
          background:"#eef2ff",
          display:"flex",
          alignItems:"center",
          gap:12
        }}>
          <div style={{
            width:18,
            height:18,
            border:
              "3px solid #c7d2fe",
            borderTop:
              "3px solid #4f46e5",
            borderRadius:"50%",
            animation:
              "spin 0.8s linear infinite"
          }} />

          <div>
            <div style={{
              fontWeight:700,
              color:"#312e81"
            }}>
              {runningAction}
            </div>

            <div style={{
              fontSize:13,
              color:"#4f46e5",
              marginTop:2
            }}>
              Still running · elapsed {
                formatElapsed(
                  elapsed
                )
              }
              {runningAction
                === "Running robust optimization"
                ? " · replicated optimization can take several minutes"
                : ""}
            </div>
          </div>
        </div>
      }

      <style jsx global>{`
        html { background:#f4f7fb; }
        body { margin:0; background:linear-gradient(180deg,#f8fafc 0,#f4f7fb 460px,#f8fafc 100%); color:#0f172a; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        button, input, select { font:inherit; }
        button { transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease, opacity .12s ease; }
        button:not(:disabled):hover { transform:translateY(-1px); box-shadow:0 7px 18px rgba(15,23,42,.10); }
        input, select { border:1px solid #cbd5e1; border-radius:9px; padding:8px 10px; background:#fff; color:#0f172a; outline:none; }
        input:focus, select:focus { border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.12); }
        table th { color:#475569; font-size:11px; letter-spacing:.04em; text-transform:uppercase; font-weight:800; }
        table td, table th { padding-top:9px !important; padding-bottom:9px !important; }
        a { transition:opacity .12s ease, background .12s ease; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>


      <section style={{
        ...card,
        marginTop:20
      }}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>Step 1 · Model</div>
        <h2 style={{
          margin:"0 0 6px",fontSize:21,letterSpacing:"-.015em"
        }}>
          Build and evaluate the baseline
        </h2>

        <p style={{
          marginTop:0,
          color:"#4b5563",
          lineHeight:1.5
        }}>
          Choose the workflow class first. The data-import section immediately below
          changes to the template and parser for that workflow class.
        </p>

        <div style={{
          display:"grid",
          gridTemplateColumns:"minmax(220px,320px) 1fr",
          gap:14,
          alignItems:"end",
          margin:"16px 0"
        }}>
          <label style={{fontSize:12,color:"#475569",fontWeight:700}}>
            Workflow class
            <select
              value={workflowClass}
              onChange={e => {
                const next = e.target.value;
                setWorkflowClass(next);
                setLogFile(null);
                setLogPreview(null);
                setContactCenterPreview(null);
                setCalibration(null);
              }}
              style={{display:"block",width:"100%",marginTop:6}}
            >
              <option value="general">General Process</option>
              <option value="contact_center">Contact Center</option>
            </select>
          </label>

          <div style={{fontSize:13,color:"#64748b",lineHeight:1.45}}>
            {workflowClass === "contact_center"
              ? "Contact Center uses a standard multi-sheet Excel workbook for events, agent skills, staffing, and interval arrivals."
              : "General Process uses the existing event-log format for activities, timestamps, resources, routing, and service-time calibration."}
          </div>
        </div>

      </section>

      {workflowClass === "contact_center" &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{marginTop:0}}>Contact Center Excel import</h2>

          <p style={{color:"#4b5563",lineHeight:1.5}}>
            Use the standard Excel workbook. Operations teams populate the sheets;
            the app validates the workbook and converts it to the internal process model.
            JSON is not required for external data collection.
          </p>

          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
            <button
              disabled={busy}
              style={{...primaryButtonStyle,opacity:busy ? 0.55 : 1}}
              onClick={loadContactCenterSample}
            >
              Load sample Contact Center
            </button>
            <a href="/templates/contact_center_template.xlsx" download style={buttonStyle}>
              Download blank Excel template
            </a>
            <a href="/templates/contact_center_sample.xlsx" download style={buttonStyle}>
              Download sample Excel workbook
            </a>
          </div>

          <div style={{
            padding:"12px 14px",
            background:"#f8fafc",
            border:"1px solid #e2e8f0",
            borderRadius:10,
            fontSize:12,
            color:"#475569",
            marginBottom:14
          }}>
            Required sheets: <b>Events</b>, <b>Agent_Skills</b>, <b>Staffing</b>, <b>Arrivals</b>.
            Optional: <b>Settings</b>. The Events sheet uses one row per workflow event;
            SERVICE_START and SERVICE_END share the same interaction_id and contact_leg_id.
          </div>

          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={e => {
                setLogFile(e.target.files?.[0] || null);
                setContactCenterPreview(null);
                setCalibration(null);
              }}
            />

            <button
              disabled={busy || !logFile}
              style={{...buttonStyle,opacity:busy || !logFile ? 0.55 : 1}}
              onClick={previewContactCenterWorkbook}
            >
              Validate workbook
            </button>

            <button
              disabled={busy || !logFile}
              style={{...primaryButtonStyle,opacity:busy || !logFile ? 0.55 : 1}}
              onClick={importContactCenterWorkbook}
            >
              Build Contact Center model
            </button>
          </div>

          {contactCenterPreview &&
            <div style={{marginTop:14,fontSize:13,color:"#166534",fontWeight:700}}>
              Workbook valid · {Object.entries(contactCenterPreview.sheets || {}).map(
                ([name,info]) => `${name}: ${info.rows} rows`
              ).join(" · ")}
            </div>
          }

          {calibration?.workflow_class === "contact_center" &&
            <div style={{marginTop:14,fontSize:13,color:"#475569",lineHeight:1.6}}>
              Imported {calibration.interactions} interaction(s), {calibration.service_legs} service leg(s),
              {" "}{calibration.activities} workflow activity/queue(s), and {calibration.resource_pools} resource pool(s).
              {calibration.warnings?.length
                ? ` ${calibration.warnings.length} activity/queue(s) have sparse service-time data and were flagged.`
                : " Service-time data is adequately populated for the observed queues."}
            </div>
          }
        </section>
      }

      {workflowClass === "general" &&
      <section style={{
        ...card,
        marginTop:18
      }}>
        <h2 style={{
          marginTop:0
        }}>
          Event-log calibration
        </h2>

        <p style={{
          color:"#4b5563",
          lineHeight:1.5
        }}>
          Upload a CSV or Excel event log. The app discovers
          activities, routing probabilities, rework loops,
          service-time estimates, arrival rate, and observed
          resource counts, then creates an editable process model.
        </p>

        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
          <button
            disabled={busy}
            style={{...buttonStyle,opacity:busy ? 0.55 : 1}}
            onClick={loadModel}
          >
            Load sample General Process
          </button>
        </div>

        <div style={{
          display:"flex",
          gap:10,
          flexWrap:"wrap",
          alignItems:"center"
        }}>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={busy}
            onChange={
              e => {
                setLogFile(
                  e.target.files?.[0]
                  || null
                );
                setLogPreview(null);
                setCalibration(null);
              }
            }
          />

          <button
            disabled={
              busy || !logFile
            }
            style={{
              ...buttonStyle,
              opacity:
                busy || !logFile
                ? 0.55
                : 1
            }}
            onClick={
              previewEventLog
            }
          >
            Inspect columns
          </button>
        </div>

        {logPreview &&
          <>
            <div style={{
              marginTop:14,
              fontSize:13,
              color:"#6b7280"
            }}>
              {logPreview.rows} rows · {
                logPreview.columns.length
              } columns · {
                logPreview.filename
              }
            </div>

            <div style={{
              display:"grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(180px,1fr))",
              gap:10,
              marginTop:12
            }}>
              {[
                ["case_id","Case ID",true],
                ["activity","Activity",true],
                ["start_time","Start time",true],
                ["end_time","End time",false],
                ["resource","Resource",false]
              ].map(
                ([key,label,required]) =>
                  <label
                    key={key}
                    style={{
                      fontSize:12,
                      color:"#4b5563"
                    }}
                  >
                    {label}{
                      required
                      ? " *"
                      : ""
                    }

                    <select
                      value={
                        mapping[key]
                      }
                      onChange={
                        e =>
                          setMapping(
                            prev => ({
                              ...prev,
                              [key]:
                                e
                                .target
                                .value
                            })
                          )
                      }
                      style={{
                        width:"100%",
                        marginTop:5,
                        padding:8
                      }}
                    >
                      <option value="">
                        -- not mapped --
                      </option>

                      {
                        logPreview
                        .columns
                        .map(c =>
                          <option
                            key={c}
                            value={c}
                          >
                            {c}
                          </option>
                        )
                      }
                    </select>
                  </label>
              )}
            </div>

            <button
              disabled={busy}
              style={{
                ...buttonStyle,
                marginTop:12,
                opacity:
                  busy ? 0.55 : 1
              }}
              onClick={
                calibrateEventLog
              }
            >
              Calibrate and load model
            </button>
          </>
        }

        {calibration &&
          <div style={{
            ...card,
            background:"#fafafa",
            marginTop:14
          }}>
            <b>
              Calibration summary
            </b>

            <div style={{
              fontSize:13,
              color:"#4b5563",
              marginTop:6
            }}>
              Cases {
                calibration.cases
              } · Activities {
                calibration.activities
              } · Arrival rate {
                Number(
                  calibration
                  .arrival_rate_per_hour
                ).toFixed(2)
              }/hr · Estimated analysts {
                calibration
                .estimated_analyst_capacity
              } · Repeat events {
                calibration
                .repeat_event_count
              }
            </div>

            <div style={{
              fontSize:12,
              color:"#6b7280",
              marginTop:5
            }}>
              Start activity: {
                calibration
                .start_activity
              }. The calibrated model is now the active
              model used by Simulation and Optimization.
            </div>

            {Array.isArray(calibration.service_times) && calibration.service_times.length > 0 &&
              <div style={{marginTop:14}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
                  <b style={{fontSize:13}}>Service-time calibration</b>
                  <span style={{fontSize:12,color:(calibration.service_time_low_confidence_count || 0) > 0 ? "#b45309" : "#64748b"}}>
                    {(calibration.service_time_low_confidence_count || 0) > 0
                      ? `${calibration.service_time_low_confidence_count} activit${calibration.service_time_low_confidence_count === 1 ? "y" : "ies"} need review`
                      : "All activities sufficiently sampled"}
                  </span>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr>
                        <th align="left" style={{padding:"7px 6px",borderBottom:"1px solid #e2e8f0"}}>Activity</th>
                        <th align="right" style={{padding:"7px 6px",borderBottom:"1px solid #e2e8f0"}}>n</th>
                        <th align="left" style={{padding:"7px 6px",borderBottom:"1px solid #e2e8f0"}}>Simulation distribution</th>
                        <th align="left" style={{padding:"7px 6px",borderBottom:"1px solid #e2e8f0"}}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibration.service_times.map((s, i) =>
                        <tr key={`${s.activity}-${i}`}>
                          <td style={{padding:"7px 6px",borderBottom:"1px solid #f1f5f9"}}>{s.activity}</td>
                          <td align="right" style={{padding:"7px 6px",borderBottom:"1px solid #f1f5f9"}}>{s.valid_service_observations ?? 0}</td>
                          <td style={{padding:"7px 6px",borderBottom:"1px solid #f1f5f9"}}>
                            {s.distribution === "empirical" ? "Empirical bootstrap" : s.distribution === "triangular" ? "Triangular fallback" : s.distribution}
                          </td>
                          <td style={{padding:"7px 6px",borderBottom:"1px solid #f1f5f9",color:s.confidence === "insufficient" || s.confidence === "low" ? "#b45309" : "#475569",fontWeight:600}}>
                            {s.confidence || "—"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:8,lineHeight:1.45}}>
                  Empirical bootstrap preserves the observed service-time shape. Activities with fewer than 10 valid observations use a triangular fallback and are flagged for review.
                </div>
              </div>
            }
          </div>
        }
      </section>

      }

      <section style={{
        ...card,
        marginTop:18
      }}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>Step 2 · Baseline</div>
        <h2 style={{margin:"0 0 6px",fontSize:21,letterSpacing:"-.015em"}}>
          Run the AS-IS simulation
        </h2>
        <p style={{marginTop:0,color:"#4b5563",lineHeight:1.5}}>
          After loading or calibrating a valid model, run the baseline simulation before optimization.
        </p>
        <button
          disabled={busy || !model}
          style={{...primaryButtonStyle,opacity:busy || !model ? 0.55 : 1}}
          onClick={runSimulation}
        >
          Run baseline simulation
        </button>
      </section>

      <section style={{
        ...card,
        marginTop:18
      }}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>Step 3 · Optimize</div>
        <h2 style={{
          margin:"0 0 6px",fontSize:21,letterSpacing:"-.015em"
        }}>
          Choose optimization approach
        </h2>

        <p style={{
          marginTop:0,
          marginBottom:16,
          color:"#4b5563",
          lineHeight:1.5
        }}>
          Automated and manual optimization are alternative paths to a TO-BE design.
          You can use either approach after defining the design variables.
        </p>

        <div style={{
          display:"grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(280px,1fr))",
          gap:14
        }}>
          <div style={{
            border:"1px solid #dbeafe",
            borderRadius:16,
            padding:18,
            background:"linear-gradient(180deg,#ffffff,#f8fbff)",
            boxShadow:"0 5px 16px rgba(37,99,235,.045)"
          }}>
            <div style={{
              fontSize:12,
              fontWeight:800,
              color:"#1d4ed8",
              letterSpacing:".06em",
              textTransform:"uppercase"
            }}>
              Automated optimization
            </div>

            <h3 style={{
              margin:"6px 0 8px"
            }}>
              Architecture-family search
            </h3>

            <p style={{
              margin:"0 0 14px",
              color:"#4b5563",
              lineHeight:1.45,
              fontSize:14
            }}>
              DOE + evolving-SVD search + stochastic robustness validation.
              The optimizer searches the selected design variables automatically.
            </p>

            <button
              disabled={busy || !model}
              style={{
                ...primaryButtonStyle,
                width:"100%",
                opacity:busy || !model ? 0.55 : 1
              }}
              onClick={runOptimize}
            >
              {runningAction
                === "Running robust optimization"
                ? "Optimization running..."
                : "Run automated optimization"}
            </button>
          </div>

          <div style={{
            border:"1px solid #ddd6fe",
            borderRadius:16,
            padding:18,
            background:"linear-gradient(180deg,#ffffff,#fbfaff)",
            boxShadow:"0 5px 16px rgba(109,40,217,.045)"
          }}>
            <div style={{
              fontSize:12,
              fontWeight:800,
              color:"#6d28d9",
              letterSpacing:".06em",
              textTransform:"uppercase"
            }}>
              Manual optimization
            </div>

            <h3 style={{
              margin:"6px 0 8px"
            }}>
              Manual SVD Explorer
            </h3>

            <p style={{
              margin:"0 0 14px",
              color:"#4b5563",
              lineHeight:1.45,
              fontSize:14
            }}>
              Inspect stochastic SVD modes, choose a direction and step size,
              simulate the change, and iteratively navigate the design space.
            </p>

            <button
              disabled={busy || !model}
              style={{
                ...accentButtonStyle,
                width:"100%",
                opacity:busy || !model ? 0.55 : 1
              }}
              onClick={openManualSvd}
            >
              Open Manual SVD Explorer
            </button>
          </div>
        </div>

        <div style={{
          marginTop:16,
          paddingTop:16,
          borderTop:"1px solid #e5e7eb"
        }}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#64748b",marginBottom:4}}>Step 4 · Compare</div>
          <div style={{fontSize:13,color:"#64748b",marginBottom:10}}>
            Review the selected TO-BE design against the AS-IS baseline.
          </div>

          <button
            disabled={busy}
            style={{
              ...primaryButtonStyle,
              opacity:busy ? 0.55 : 1
            }}
            onClick={runCompare}
          >
            Compare AS-IS vs TO-BE
          </button>
        </div>
      </section>

      {model &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{
            marginTop:0
          }}>
            {model.name}
          </h2>

          {(model.arrival_profile?.length > 0 ||
            (model.resources || []).some(r => r.staffing_profile?.length || r.skills?.length)) &&
            <div style={{
              margin:"-4px 0 14px",
              padding:"10px 12px",
              border:"1px solid #dbeafe",
              borderRadius:10,
              background:"#f8fbff",
              fontSize:12,
              color:"#475569"
            }}>
              {model.arrival_profile?.length > 0
                ? `Time-varying arrivals: ${model.arrival_profile.length} interval(s). `
                : ""}
              {(model.resources || []).some(r => r.staffing_profile?.length)
                ? "Time-varying staffing enabled. "
                : ""}
              {(model.resources || []).some(r => r.skills?.length)
                ? "Skill-based resource routing enabled where configured."
                : ""}
            </div>
          }

          <div style={{
            display:"flex",
            gap:8,
            flexWrap:"wrap"
          }}>
            {(model.activities || []).map(
              a =>
              <div
                key={a.id}
                style={{
                  padding:"10px 14px",
                  border:
                    "1px solid #d1d5db",
                  borderRadius:10
                }}
              >
                <b>{a.name}</b>

                <div style={{
                  fontSize:12,
                  color:"#6b7280"
                }}>
                  {
                    fmtMin(
                      a.service_time
                      ?.mean_minutes
                    )
                  } min
                </div>
              </div>
            )}
          </div>
        </section>
      }


      {model &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            gap:12,
            flexWrap:"wrap"
          }}>
            <div>
              <h2 style={{
                margin:"0 0 4px"
              }}>
                Visual Process Modeler
              </h2>

              <div style={{
                fontSize:13,
                color:"#6b7280"
              }}>
                Edit a general directed workflow with branching,
                merging, exception paths, and rework loops before
                running simulation or robust optimization.
              </div>
            </div>

            <div style={{
              display:"flex",
              gap:8,
              flexWrap:"wrap"
            }}>
              <button
                disabled={busy}
                style={buttonStyle}
                onClick={addActivity}
              >
                Add activity
              </button>

              <button
                disabled={busy}
                style={buttonStyle}
                onClick={addTransition}
              >
                Add transition
              </button>

              <button
                disabled={busy}
                style={buttonStyle}
                onClick={downloadModel}
              >
                Download model JSON
              </button>
            </div>
          </div>

          <div style={{
            marginTop:16
          }}>
            <ProcessGraph
              model={model}
            />
          </div>

          <h3>
            Activities
          </h3>

          <div style={{
            overflowX:"auto"
          }}>
            <table style={{
              width:"100%",
              borderCollapse:"collapse",
              fontSize:13
            }}>
              <thead>
                <tr>
                  <th align="left">
                    Activity
                  </th>
                  <th align="left">
                    Mean service (min)
                  </th>
                  <th align="left">
                    Resource pool
                  </th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {(model.activities || []).map(
                  a =>
                    <tr key={a.id}>
                      <td style={{
                        padding:"7px 4px"
                      }}>
                        <input
                          value={a.name}
                          onChange={
                            e =>
                              updateActivity(
                                a.id,
                                "name",
                                e.target.value
                              )
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0.01"
                          step="0.1"
                          value={
                            a
                            .service_time
                            ?.mean_minutes
                            ?? 0
                          }
                          onChange={
                            e =>
                              updateActivity(
                                a.id,
                                "mean_minutes",
                                e.target.value
                              )
                          }
                          style={{
                            width:100
                          }}
                        />
                      </td>

                      <td>
                        <select
                          value={
                            a.resource_pool
                            || ""
                          }
                          onChange={
                            e =>
                              updateActivity(
                                a.id,
                                "resource_pool",
                                e.target.value
                              )
                          }
                        >
                          {
                            resourceOptions(
                              model
                            )
                            .map(r =>
                              <option
                                key={r}
                                value={r}
                              >
                                {r}
                              </option>
                            )
                          }
                        </select>
                      </td>

                      <td>
                        {
                          a.id
                          !== model
                          .start_activity
                          && a.id
                          !== model
                          .end_activity
                          &&
                          <button
                            style={buttonStyle}
                            onClick={
                              () =>
                                removeActivity(
                                  a.id
                                )
                            }
                          >
                            Remove
                          </button>
                        }
                      </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3>
            Routing / transitions
          </h3>

          <div style={{
            fontSize:12,
            color:"#6b7280",
            marginBottom:8
          }}>
            Active architecture: {
              activeArchitecture(model)?.name
              || activeArchitecture(model)?.id
              || "none"
            } · {
              activeTransitions(model).length
            } transition(s)
          </div>

          <div style={{
            overflowX:"auto"
          }}>
            <table style={{
              width:"100%",
              borderCollapse:"collapse",
              fontSize:13
            }}>
              <thead>
                <tr>
                  <th align="left">
                    From
                  </th>
                  <th align="left">
                    To
                  </th>
                  <th align="left">
                    Probability
                  </th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {activeTransitions(model).map(
                  (t,i) =>
                    <tr key={i}>
                      <td>
                        <select
                          value={t.source}
                          onChange={
                            e =>
                              updateTransition(
                                i,
                                "source",
                                e.target.value
                              )
                          }
                        >
                          {
                            model
                            .activities
                            .map(a =>
                              <option
                                key={a.id}
                                value={a.id}
                              >
                                {a.name}
                              </option>
                            )
                          }
                        </select>
                      </td>

                      <td>
                        <select
                          value={t.target}
                          onChange={
                            e =>
                              updateTransition(
                                i,
                                "target",
                                e.target.value
                              )
                          }
                        >
                          {
                            model
                            .activities
                            .map(a =>
                              <option
                                key={a.id}
                                value={a.id}
                              >
                                {a.name}
                              </option>
                            )
                          }
                        </select>
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={
                            t.probability
                          }
                          onChange={
                            e =>
                              updateTransition(
                                i,
                                "probability",
                                e.target.value
                              )
                          }
                          style={{
                            width:90
                          }}
                        />
                      </td>

                      <td>
                        <button
                          style={buttonStyle}
                          onClick={
                            () =>
                              removeTransition(
                                i
                              )
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                )}
              </tbody>
            </table>
          </div>

          {getResourceKey(model) &&
            <>
              <h3>
                Resource capacities
              </h3>

              <div style={{
                display:"grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(180px,1fr))",
                gap:10
              }}>
                {
                  model[
                    getResourceKey(
                      model
                    )
                  ].map(r =>
                    <label
                      key={r.id}
                      style={{
                        ...card,
                        fontSize:12
                      }}
                    >
                      <b>
                        {r.name || r.id}
                      </b>

                      {r.skills?.length > 0 &&
                        <div style={{marginTop:5,color:"#64748b"}}>
                          Skills: {r.skills.join(", ")}
                        </div>
                      }
                      {r.staffing_profile?.length > 0 &&
                        <div style={{marginTop:3,color:"#64748b"}}>
                          Staffing profile: {r.staffing_profile.length} interval(s)
                        </div>
                      }

                      <div style={{
                        marginTop:6
                      }}>
                        Base capacity
                      </div>

                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={r.capacity}
                        onChange={
                          e =>
                            updateResource(
                              r.id,
                              "capacity",
                              e.target.value
                            )
                        }
                        style={{
                          width:"100%",
                          marginTop:4
                        }}
                      />
                    </label>
                  )
                }
              </div>
            </>
          }
        </section>
      }

      {model &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{
            margin:"0 0 4px"
          }}>
            Design Variables
          </h2>

          <div style={{
            fontSize:13,
            color:"#6b7280",
            lineHeight:1.5,
            marginBottom:12
          }}>
            Choose exactly which numeric variables the optimizer may change.
            Unchecked variables stay fixed at the current process-model value.
            Continuous variables move freely within their bounds; quantized
            variables move in the specified step size. Architecture families
            remain the discrete outer search.
          </div>

          {numericDesignVariables(model).length
            ?
            <div style={{
              overflowX:"auto"
            }}>
              <table style={{
                width:"100%",
                borderCollapse:"collapse",
                fontSize:13
              }}>
                <thead>
                  <tr>
                    <th align="left" style={{padding:"7px 5px"}}>Change?</th>
                    <th align="left" style={{padding:"7px 5px"}}>Variable</th>
                    <th align="left" style={{padding:"7px 5px"}}>Current</th>
                    <th align="left" style={{padding:"7px 5px"}}>Type</th>
                    <th align="left" style={{padding:"7px 5px"}}>Min</th>
                    <th align="left" style={{padding:"7px 5px"}}>Max</th>
                    <th align="left" style={{padding:"7px 5px"}}>Step</th>
                  </tr>
                </thead>

                <tbody>
                  {numericDesignVariables(model).map(v => {
                    const enabled =
                      designVariableEnabled[v.name] !== false;
                    const current =
                      currentDesignValue(v);

                    return (
                      <tr
                        key={v.name}
                        style={{
                          borderTop:"1px solid #e5e7eb",
                          opacity:enabled ? 1 : 0.55
                        }}
                      >
                        <td style={{padding:"8px 5px"}}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e =>
                              setDesignVariableEnabled(prev => ({
                                ...prev,
                                [v.name]:e.target.checked
                              }))
                            }
                          />
                        </td>

                        <td style={{padding:"8px 5px"}}>
                          <b>{v.name}</b>
                        </td>

                        <td style={{padding:"8px 5px", color:"#6b7280"}}>
                          {current === null
                            ? "model value"
                            : Number(current).toLocaleString()}
                        </td>

                        <td style={{padding:"8px 5px"}}>
                          <select
                            value={v.kind}
                            disabled={!enabled || busy}
                            onChange={e =>
                              updateDesignVariable(
                                v.name,
                                "kind",
                                e.target.value
                              )
                            }
                          >
                            <option value="continuous">Continuous</option>
                            <option value="quantized">Quantized</option>
                          </select>
                        </td>

                        <td style={{padding:"8px 5px"}}>
                          <input
                            type="number"
                            value={v.lower ?? ""}
                            disabled={!enabled || busy}
                            onChange={e =>
                              updateDesignVariable(
                                v.name,
                                "lower",
                                e.target.value
                              )
                            }
                            style={{width:95}}
                          />
                        </td>

                        <td style={{padding:"8px 5px"}}>
                          <input
                            type="number"
                            value={v.upper ?? ""}
                            disabled={!enabled || busy}
                            onChange={e =>
                              updateDesignVariable(
                                v.name,
                                "upper",
                                e.target.value
                              )
                            }
                            style={{width:95}}
                          />
                        </td>

                        <td style={{padding:"8px 5px"}}>
                          {v.kind === "quantized"
                            ?
                            <input
                              type="number"
                              min="0.000001"
                              value={v.step ?? 1}
                              disabled={!enabled || busy}
                              onChange={e =>
                                updateDesignVariable(
                                  v.name,
                                  "step",
                                  e.target.value
                                )
                              }
                              style={{width:85}}
                            />
                            :
                            <span style={{color:"#9ca3af"}}>—</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{
                fontSize:12,
                color:"#6b7280",
                marginTop:10
              }}>
                {numericDesignVariables(model).filter(
                  v => designVariableEnabled[v.name] !== false
                ).length} of {numericDesignVariables(model).length}
                {" "}numeric design variables selected for DOE / evolving-SVD search.
              </div>
            </div>
            :
            <div style={{
              padding:"12px 14px",
              background:"#f9fafb",
              borderRadius:8,
              color:"#6b7280",
              fontSize:13
            }}>
              This model does not currently expose any continuous or quantized
              design variables.
            </div>
          }
        </section>
      }

      {manualCommitted &&
        <section style={{
          ...card,
          marginTop:18,
          border:"1px solid #86efac",
          background:"#f0fdf4"
        }}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            gap:12,
            flexWrap:"wrap",
            alignItems:"center"
          }}>
            <div>
              <h2 style={{margin:"0 0 4px"}}>
                Committed manual design
              </h2>
              <div style={{fontSize:13,color:"#166534"}}>
                This design was committed from the Manual SVD Explorer and
                is now the TO-BE design used by Compare AS-IS vs TO-BE.
              </div>
            </div>
            <button
              style={buttonStyle}
              onClick={openManualSvd}
            >
              Continue manual exploration
            </button>
          </div>

          <div style={{
            marginTop:10,
            fontSize:13,
            color:"#374151",
            lineHeight:1.6
          }}>
            Architecture: <b>{manualCommitted.architecture_id}</b> · {
              Object.entries(manualCommitted.design || {})
                .map(([k,v]) => `${k}=${Number(v).toFixed(3)}`)
                .join(" · ")
            }
          </div>
        </section>
      }

      {sim &&
        <section style={{
          marginTop:18
        }}>
          <h2>
            Baseline simulation
          </h2>

          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(180px,1fr))",
            gap:12
          }}>
            <Metric
              label="Demand / hr"
              value={
                model
                .arrival_rate_per_hour
                .toFixed(2)
              }
            />

            <Metric
              label="Measured throughput / hr"
              value={
                sim.metrics
                .throughput_per_hour
                .toFixed(2)
              }
            />

            <Metric
              label="Realized arrivals / hr"
              value={
                sim.metrics
                .realized_arrival_rate_per_hour
                .toFixed(2)
              }
            />

            <Metric
              label="Flow balance"
              value={
                fmtFlow(sim.metrics
                  .flow_balance)
              }
            />

            <Metric
              label="Mean cycle (min)"
              value={
                sim.metrics
                .mean_cycle_minutes
                .toFixed(1)
              }
            />

            <Metric
              label="Median / P50 cycle (min)"
              value={
                sim.metrics
                .median_cycle_minutes
                .toFixed(1)
              }
            />

            <Metric
              label="P95 cycle (min)"
              value={
                sim.metrics
                .p95_cycle_minutes
                .toFixed(1)
              }
            />

            <Metric
              label="SLA"
              value={
                fmtPct(
                  sim.metrics
                  .sla_attainment
                )
              }
            />

            <Metric
              label="Max utilization"
              value={
                fmtPct(
                  sim
                  .structural_capacity
                  .max_resource_utilization
                )
              }
            />

            <Metric
              label="Bottleneck"
              value={
                sim
                .structural_capacity
                .bottleneck_resource
                || "none"
              }
            />

            <Metric
              label="Capacity state"
              value={
                sim
                .structural_capacity
                .capacity_status
              }
            />

            <Metric
              label="Annual cost"
              value={
                money(
                  sim.metrics
                  .annual_cost
                )
              }
            />
          </div>
        </section>
      }

      {opt &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{
            marginTop:0
          }}>
            Statistical robust architecture-family optimization
          </h2>

          <p style={{
            color:"#4b5563"
          }}>
            Search target: at least 90% replicated
            feasibility using flow balance ≥ 98%, P95 ≤ 600
            minutes, SLA ≥ 90%, and max utilization ≤ 95%.
            Candidate comparisons use the same random seeds.
            Final validation uses 40 independent replications.
          </p>

          {opt.results.map(
            (r,idx) => {
              const b = r.best;
              const env =
                r
                .feasibility_envelope
                ?.envelope;

              const rob =
                r.robustness;

              const rf =
                r.robust_frontier;

              return (
                <div
                  key={
                    r.architecture
                  }
                  style={{
                    padding:"18px 0",
                    borderTop:
                      idx
                      ? "1px solid #eee"
                      : "none"
                  }}
                >
                  <div style={{
                    display:"flex",
                    justifyContent:
                      "space-between",
                    gap:12,
                    flexWrap:"wrap"
                  }}>
                    <b>
                      #{idx+1} {
                        r.architecture
                      }
                    </b>

                    <span style={{
                      fontWeight:700,
                      color:
                        r.robust_target_met
                        ? "#166534"
                        : "#991b1b"
                    }}>
                      {
                        r.robust_target_met
                        ? "ROBUSTNESS TARGET MET"
                        : "ROBUSTNESS TARGET NOT MET"
                      }
                    </span>
                  </div>

                  {env &&
                    <div style={{
                      fontSize:13,
                      color:"#6b7280",
                      marginTop:6
                    }}>
                      Envelope:
                      {" "}max throughput {
                        env
                        .max_throughput_per_hour
                        .toFixed(2)
                      }/hr ·
                      {" "}max demand satisfaction {
                        fmtFlow(env
                          .max_flow_balance)
                      } ·
                      {" "}min P95 {
                        env
                        .min_p95_cycle_minutes
                        .toFixed(1)
                      } min ·
                      {" "}max SLA {
                        fmtPct(
                          env
                          .max_sla_attainment
                        )
                      } ·
                      {" "}min max-util {
                        fmtPct(
                          env
                          .min_max_resource_utilization
                        )
                      } ·
                      {" "}{
                        env
                        .points_evaluated
                      } DOE points
                    </div>
                  }

                  {rf &&
                    <div style={{
                      marginTop:14
                    }}>
                      <div style={{
                        fontSize:13,
                        fontWeight:700,
                        marginBottom:8
                      }}>
                        Cost-vs-robustness choices
                      </div>

                      <div style={{
                        display:"grid",
                        gridTemplateColumns:
                          "repeat(auto-fit,minmax(220px,1fr))",
                        gap:10
                      }}>
                        <FrontierCard
                          title="Lowest cost"
                          item={
                            rf.lowest_cost
                          }
                          target={
                            rf
                            .target_probability
                          }
                        />

                        <FrontierCard
                          title="Balanced"
                          item={
                            rf.balanced
                          }
                          target={
                            rf
                            .target_probability
                          }
                        />

                        <FrontierCard
                          title="Most robust"
                          item={
                            rf.most_robust
                          }
                          target={
                            rf
                            .target_probability
                          }
                        />
                      </div>
                    </div>
                  }

                  {b &&
                    <>
                      <div style={{
                        fontSize:12,
                        fontWeight:700,
                        color:"#6b7280",
                        textTransform:"uppercase",
                        marginTop:14
                      }}>
                        Nominal single-run simulation
                      </div>

                      <div style={{
                        fontSize:14,
                        color:"#4b5563",
                        marginTop:14
                      }}>
                        Selected design · cost {
                          money(
                            b.metrics
                            .annual_cost
                          )
                        } ·
                        {" "}Violation norm {
                          b
                          .violation_norm
                          .toFixed(2)
                        }
                      </div>

                      <div style={{
                        fontSize:14,
                        color:"#4b5563",
                        marginTop:4
                      }}>
                        Throughput {
                          b.metrics
                          .throughput_per_hour
                          .toFixed(2)
                        }/hr ·
                        {" "}Flow balance {
                          fmtFlow(b.metrics
                            .flow_balance)
                        } ·
                        {" "}Mean cycle {
                          b.metrics
                          .mean_cycle_minutes
                          .toFixed(1)
                        } min ·
                        {" "}Median {
                          b.metrics
                          .median_cycle_minutes
                          .toFixed(1)
                        } min ·
                        {" "}P95 {
                          b.metrics
                          .p95_cycle_minutes
                          .toFixed(1)
                        } min ·
                        {" "}SLA {
                          fmtPct(
                            b.metrics
                            .sla_attainment
                          )
                        } ·
                        {" "}Max utilization {
                          fmtPct(
                            b.metrics
                            .max_resource_utilization
                          )
                        } ·
                        {" "}Capacity {
                          b.capacity
                          .capacity_status
                        }
                      </div>

                      <div style={{
                        fontSize:13,
                        color:"#6b7280",
                        marginTop:4
                      }}>
                        Bottleneck: {
                          b.capacity
                          .bottleneck_resource
                          || "none"
                        } · Active constraints: {
                          b
                          .active_constraints
                          ?.length
                          ? b
                            .active_constraints
                            .join(", ")
                          : "none"
                        }
                      </div>

                      <div style={{
                        fontSize:13,
                        color:"#6b7280",
                        marginTop:4
                      }}>
                        {
                          Object.entries(
                            b.design
                          )
                          .map(
                            ([k,v]) =>
                              `${k}=${Number(v).toFixed(3)}`
                          )
                          .join(" · ")
                        }
                      </div>
                    </>
                  }

                  {rob &&
                    <div style={{
                      ...card,
                      marginTop:12,
                      background:"#fafafa"
                    }}>
                      <b>
                        Replicated robustness validation
                      </b>

                      <div style={{
                        fontSize:12,
                        color:"#6b7280",
                        marginTop:4
                      }}>
                        This replicated result determines whether the robustness target is met.
                      </div>

                      <div style={{
                        fontSize:14,
                        color:
                          r
                          .robust_target_met
                          ? "#166534"
                          : "#991b1b",
                        fontWeight:700,
                        marginTop:6
                      }}>
                        {
                          r
                          .robust_target_met
                          ? "TARGET MET"
                          : "TARGET NOT MET"
                        } · feasibility {
                          fmtPct(
                            rob
                            .probability
                          )
                        }
                      </div>

                      <div style={{
                        fontSize:13,
                        color:"#6b7280",
                        marginTop:4
                      }}>
                        95% confidence interval [
                        {
                          fmtPct(
                            rob
                            .probability_ci95
                            .lower
                          )
                        },{" "}
                        {
                          fmtPct(
                            rob
                            .probability_ci95
                            .upper
                          )
                        }]
                      </div>

                      <div style={{
                        fontSize:13,
                        color:"#6b7280",
                        marginTop:6
                      }}>
                        {
                          rob.replications
                        } replications · {
                          rob
                          .cases_per_replication
                        } cases each ·
                        {" "}Throughput mean {
                          rob
                          .mean_throughput
                          .toFixed(2)
                        }/hr ± {
                          rob
                          .std_throughput
                          .toFixed(2)
                        } ·
                        {" "}Realized arrivals {
                          rob
                          .mean_realized_arrival_rate
                          .toFixed(2)
                        }/hr ·
                        {" "}Flow balance mean {
                          fmtFlow(rob
                            .mean_flow_balance)
                        } ·
                        {" "}SLA mean {
                          fmtPct(
                            rob
                            .mean_sla
                          )
                        } ·
                        {" "}P95-cycle mean {
                          rob
                          .mean_p95
                          .toFixed(1)
                        } min
                      </div>

                      <div style={{
                        fontSize:13,
                        color:"#6b7280",
                        marginTop:6
                      }}>
                        Backlog growth mean {
                          rob
                          .mean_backlog_growth
                          .toFixed(2)
                        }/hr · 90% interval [
                        {
                          rob
                          .backlog_p05
                          .toFixed(2)
                        },{" "}
                        {
                          rob
                          .backlog_p95
                          .toFixed(2)
                        }] · probability backlog
                        growth &gt; 0.05/hr: {
                          fmtPct(
                            rob
                            .probability_backlog_growth_above_0_05
                          )
                        }
                      </div>
                    </div>
                  }
                </div>
              );
            }
          )}
        </section>
      }

      {cmp &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{
            marginTop:0
          }}>
            AS-IS vs TO-BE
          </h2>

          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(2,minmax(0,1fr))",
            gap:16
          }}>
            <div>
              <h3>
                Baseline
              </h3>

              <pre style={{
                whiteSpace:"pre-wrap",
                fontSize:13
              }}>
                {
                  JSON.stringify(
                    cmp
                    .baseline_metrics,
                    null,
                    2
                  )
                }
              </pre>
            </div>

            <div>
              <h3>
                Future state
              </h3>

              <pre style={{
                whiteSpace:"pre-wrap",
                fontSize:13
              }}>
                {
                  JSON.stringify(
                    cmp
                    .future_metrics,
                    null,
                    2
                  )
                }
              </pre>
            </div>
          </div>
        </section>
      }
    </main>
  );
}
