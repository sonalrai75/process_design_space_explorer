"use client";

import { useEffect, useState } from "react";

const API =
  process.env.NEXT_PUBLIC_API_BASE || "";

const card = {
  background:"#fff",
  border:"1px solid #e5e7eb",
  borderRadius:14,
  padding:18,
  boxShadow:"0 1px 2px rgba(0,0,0,.03)"
};

const buttonStyle = {
  padding:"9px 13px",
  borderRadius:8,
  border:"1px solid #d1d5db",
  background:"#fff",
  cursor:"pointer"
};

function Metric({label,value}) {
  return (
    <div style={card}>
      <div style={{
        fontSize:12,
        color:"#6b7280"
      }}>
        {label}
      </div>

      <div style={{
        fontSize:26,
        fontWeight:700,
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
              model:model || undefined,
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

  async function runCompare() {
    try {
      const selected =
        opt?.results?.[0];

      if (!model || !selected?.best) {
        setStatus(
          "Run simulation and optimization before comparing AS-IS vs TO-BE"
        );
        return;
      }

      setCmp(
        await call(
          "/api/compare",
          {
            method:"POST",
            headers:{
              "Content-Type":"application/json"
            },
            body:JSON.stringify({
              model,
              baseline_architecture_id:
                model.architectures?.[0]?.id,
              future_architecture_id:
                selected.architecture,
              future_design:
                selected.best.design,
              cases:1200,
              seed:2
            })
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

      const numericValue =
        Number(value);

      const next = {
        ...prev,
        [key]:
          prev[key].map(r =>
            r.id === id
            ? {
                ...r,
                [field]:numericValue
              }
            : r
          )
      };

      if (
        field === "capacity"
        && Array.isArray(prev.variables)
      ) {
        const variableName =
          `resource_capacity__${id}`;

        next.variables =
          prev.variables.map(v =>
            v.name === variableName
            ? {
                ...v,
                value:numericValue,
                lower:
                  v.lower == null
                  ? 1
                  : Math.min(
                      Number(v.lower),
                      numericValue
                    ),
                upper:
                  v.upper == null
                  ? Math.max(2,numericValue*2)
                  : Math.max(
                      Number(v.upper),
                      numericValue
                    )
              }
            : v
          );
      }

      return next;
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
      maxWidth:1180,
      margin:"0 auto",
      padding:"34px 22px 60px"
    }}>
      <div style={{
        display:"flex",
        justifyContent:
          "space-between",
        gap:20,
        alignItems:"flex-start",
        flexWrap:"wrap"
      }}>
        <div>
          <div style={{
            fontSize:13,
            fontWeight:700,
            color:"#4f46e5",
            letterSpacing:".08em"
          }}>
            PROCESS DIGITAL TWIN
          </div>

          <h1 style={{
            fontSize:38,
            margin:"8px 0 8px"
          }}>
            Process Design Space Explorer
          </h1>

          <p style={{
            maxWidth:900,
            color:"#4b5563",
            lineHeight:1.55
          }}>
            Statistical robust-manifold optimization
            using common random numbers, demand-normalized
            flow balance, confidence intervals, and explicit
            robustness-target enforcement.
          </p>
        </div>

        <div style={{
          fontSize:13,
          color:"#6b7280"
        }}>
          Status: {status}
        </div>
      </div>

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
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{
        marginTop:10,
        marginBottom:6
      }}>
        <a
          href="/about.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color:"#4f46e5",
            fontWeight:700,
            textDecoration:"none"
          }}
        >
          About this app: features, algorithms, and technical overview →
        </a>
      </div>

      <section style={{
        ...card,
        marginTop:18
      }}>
        <h2 style={{
          marginTop:0
        }}>
          Demo workflow
        </h2>

        <div style={{
          display:"flex",
          gap:10,
          flexWrap:"wrap"
        }}>
          <button
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:
                busy ? 0.55 : 1
            }}
            onClick={loadModel}
          >
            Load demo model
          </button>

          <button
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:
                busy ? 0.55 : 1
            }}
            onClick={
              runSimulation
            }
          >
            Run baseline simulation
          </button>

          <button
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:
                busy ? 0.55 : 1
            }}
            onClick={runOptimize}
          >
            {runningAction
              === "Running robust optimization"
              ? "Optimization running..."
              : "Optimize architecture families"}
          </button>

          <button
            disabled={busy || !model || !opt?.results?.[0]?.best}
            style={{
              ...buttonStyle,
              opacity:
                busy || !model || !opt?.results?.[0]?.best
                ? 0.55
                : 1
            }}
            onClick={runCompare}
          >
            Compare selected TO-BE
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
                    a.service_time
                    .mean_minutes
                  } min
                </div>
              </div>
            )}
          </div>
        </section>
      }


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
              Calibrated AS-IS digital twin
            </b>

            <div style={{
              display:"grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(150px,1fr))",
              gap:10,
              marginTop:12
            }}>
              <Metric
                label="Cases"
                value={calibration.cases}
              />
              <Metric
                label="Activities"
                value={calibration.activities}
              />
              <Metric
                label="Resource pools"
                value={calibration.resource_pools}
              />
              <Metric
                label="Arrival rate / hr"
                value={Number(
                  calibration.arrival_rate_per_hour
                ).toFixed(2)}
              />
              <Metric
                label="Observed P95 cycle"
                value={`${Number(
                  calibration.p95_cycle_minutes_observed
                ).toFixed(1)} min`}
              />
              <Metric
                label="Observed SLA"
                value={fmtPct(
                  calibration.sla_attainment_observed
                )}
              />
              <Metric
                label="Cases with rework"
                value={fmtPct(
                  calibration.rework_case_rate
                )}
              />
              <Metric
                label="Top variant share"
                value={fmtPct(
                  calibration.most_common_variant_share
                )}
              />
              <Metric
                label="Structural bottleneck"
                value={
                  calibration.bottleneck_resource
                  || "none"
                }
              />
              <Metric
                label="Max utilization"
                value={fmtPct(
                  calibration.max_resource_utilization
                  || 0
                )}
              />
              <Metric
                label="Capacity state"
                value={
                  calibration.capacity_status
                  || "n/a"
                }
              />
            </div>

            <div style={{
              fontSize:12,
              color:"#6b7280",
              marginTop:10
            }}>
              Start activity: {calibration.start_activity}. The calibrated
              model now contains generic resource pools and capacity design
              variables and is used directly by Simulation and Optimization.
            </div>
          </div>
        }
      </section>

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

                      <div style={{
                        marginTop:6
                      }}>
                        Capacity
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

                      <div style={{
                        marginTop:8
                      }}>
                        Cost / hour
                      </div>

                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={r.cost_per_hour ?? 75}
                        onChange={
                          e =>
                            updateResource(
                              r.id,
                              "cost_per_hour",
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
            AS-IS vs selected TO-BE
          </h2>

          <div style={{
            fontSize:13,
            color:"#6b7280",
            marginBottom:12
          }}>
            {cmp.baseline_architecture} → {cmp.future_architecture}
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
                  <th align="left" style={{padding:8}}>Metric</th>
                  <th align="right" style={{padding:8}}>AS-IS</th>
                  <th align="right" style={{padding:8}}>TO-BE</th>
                  <th align="right" style={{padding:8}}>Change</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Annual cost",
                    cmp.baseline_metrics.annual_cost,
                    cmp.future_metrics.annual_cost,
                    money,
                    true
                  ],
                  [
                    "Throughput / hr",
                    cmp.baseline_metrics.throughput_per_hour,
                    cmp.future_metrics.throughput_per_hour,
                    v => Number(v).toFixed(2),
                    false
                  ],
                  [
                    "Flow balance",
                    cmp.baseline_metrics.flow_balance,
                    cmp.future_metrics.flow_balance,
                    fmtFlow,
                    false
                  ],
                  [
                    "P95 cycle (min)",
                    cmp.baseline_metrics.p95_cycle_minutes,
                    cmp.future_metrics.p95_cycle_minutes,
                    v => Number(v).toFixed(1),
                    true
                  ],
                  [
                    "SLA attainment",
                    cmp.baseline_metrics.sla_attainment,
                    cmp.future_metrics.sla_attainment,
                    fmtPct,
                    false
                  ],
                  [
                    "Max utilization",
                    cmp.baseline_metrics.max_resource_utilization,
                    cmp.future_metrics.max_resource_utilization,
                    fmtPct,
                    true
                  ],
                  [
                    "Backlog growth / hr",
                    cmp.baseline_metrics.backlog_growth_per_hour,
                    cmp.future_metrics.backlog_growth_per_hour,
                    v => Number(v).toFixed(2),
                    true
                  ]
                ].map(([label,a,b,fmt,lowerBetter]) => {
                  const delta = Number(b) - Number(a);
                  const pct = Math.abs(Number(a)) > 1e-9
                    ? 100 * delta / Math.abs(Number(a))
                    : null;
                  const improved = lowerBetter
                    ? delta < 0
                    : delta > 0;
                  return (
                    <tr key={label} style={{borderTop:"1px solid #eee"}}>
                      <td style={{padding:8}}>{label}</td>
                      <td align="right" style={{padding:8}}>{fmt(a)}</td>
                      <td align="right" style={{padding:8,fontWeight:700}}>{fmt(b)}</td>
                      <td align="right" style={{
                        padding:8,
                        color: Math.abs(delta) < 1e-9
                          ? "#6b7280"
                          : improved
                            ? "#166534"
                            : "#991b1b"
                      }}>
                        {pct === null
                          ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`
                          : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      }
    </main>
  );
}
