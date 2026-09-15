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

function fmtProbabilityInput(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(3)));
}

function fmtFlow(v) {
  return (
    (100 * Math.min(Number(v), 1)).toFixed(1)
    + "%"
  );
}

function fmtPctPoints(delta) {
  const pp =
    100 * Number(delta);

  return (
    (pp >= 0 ? "+" : "")
    + pp.toFixed(1)
    + " pp"
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

function applyDesignToModel(model, architectureId, design) {
  if (!model) return null;

  const next = JSON.parse(JSON.stringify(model));
  const d = design || {};

  const archVar = (next.variables || []).find(v => v.name === "architecture");
  if (archVar && architectureId) {
    archVar.value = architectureId;
  }

  const resourceKey = Object.keys(next).find(
    k => Array.isArray(next[k])
      && next[k].length
      && typeof next[k][0] === "object"
      && next[k][0] !== null
      && Object.prototype.hasOwnProperty.call(next[k][0], "capacity")
      && k !== "variables"
  );

  if (resourceKey) {
    next[resourceKey] = next[resourceKey].map(r => {
      const key = `resource_capacity__${r.id}`;
      return Object.prototype.hasOwnProperty.call(d, key)
        ? {...r, capacity:Number(d[key])}
        : r;
    });
  }

  next.architectures = (next.architectures || []).map(a => {
    if (architectureId && a.id !== architectureId) return a;
    return {
      ...a,
      transitions:(a.transitions || []).map(t => {
        const key = `routing_probability__${t.source}__${t.target}`;
        return Object.prototype.hasOwnProperty.call(d, key)
          ? {...t, probability:Number(d[key])}
          : t;
      })
    };
  });

  return next;
}

function designChangeLines(model, design) {
  if (!model || !design) return [];
  const lines = [];

  Object.entries(design).forEach(([name,value]) => {
    if (name.startsWith("resource_capacity__")) {
      const id = name.replace("resource_capacity__", "");
      const resource = (model.resources || []).find(r => r.id === id);
      const before = resource?.capacity;
      if (before !== undefined && Number(before) !== Number(value)) {
        lines.push(`${resource?.name || id}: ${Number(before).toFixed(0)} → ${Number(value).toFixed(0)}`);
      }
    } else if (name.startsWith("routing_probability__")) {
      const rest = name.replace("routing_probability__", "");
      const parts = rest.split("__");
      const source = parts[0];
      const target = parts.slice(1).join("__");
      const t = activeTransitions(model).find(x => x.source === source && x.target === target);
      const before = t?.probability;
      if (before !== undefined && Math.abs(Number(before)-Number(value)) > 1e-9) {
        lines.push(`${source} → ${target}: ${fmtPct(before)} → ${fmtPct(value)}`);
      }
    } else if (name === "automation_level") {
      const v = (model.variables || []).find(x => x.name === name);
      if (v && Math.abs(Number(v.value)-Number(value)) > 1e-9) {
        lines.push(`Automation: ${fmtPct(v.value)} → ${fmtPct(value)}`);
      }
    }
  });

  return lines;
}


function finiteNumbers(values) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite);
}

function describeNumbers(values) {
  const xs = finiteNumbers(values).sort((a,b) => a-b);
  const n = xs.length;
  if (!n) return null;
  const sum = xs.reduce((a,b) => a+b, 0);
  const mean = sum / n;
  const median = n % 2
    ? xs[(n-1)/2]
    : (xs[n/2-1] + xs[n/2]) / 2;
  const min = xs[0];
  const max = xs[n-1];
  const variance = n > 1
    ? xs.reduce((acc,x) => acc + (x-mean)*(x-mean), 0) / (n-1)
    : 0;
  return {
    n,
    mean,
    median,
    min,
    max,
    range:max-min,
    std:Math.sqrt(Math.max(0, variance))
  };
}

function triangularMedian(a,c,b) {
  a=Number(a); c=Number(c); b=Number(b);
  if (![a,c,b].every(Number.isFinite) || b < a) return null;
  if (b === a) return a;
  return c >= (a+b)/2
    ? a + Math.sqrt((b-a)*(c-a)/2)
    : b - Math.sqrt((b-a)*(b-c)/2);
}

function modelStatsForServiceTime(st) {
  if (!st) return null;
  const d = st.distribution;
  const mean = Number(st.mean_minutes);
  const std = Number(st.std_minutes);
  if (d === "constant") {
    const v = Number.isFinite(mean) ? mean : 0;
    return {n:0,mean:v,median:v,min:v,max:v,range:0,std:0};
  }
  if (d === "triangular") {
    const a=Number(st.minimum_minutes), c=Number(st.mode_minutes), b=Number(st.maximum_minutes);
    if ([a,c,b].every(Number.isFinite)) {
      const mu=(a+b+c)/3;
      const variance=(a*a+b*b+c*c-a*b-a*c-b*c)/18;
      return {
        n:0,
        mean:mu,
        median:triangularMedian(a,c,b),
        min:a,
        max:b,
        range:b-a,
        std:Math.sqrt(Math.max(0,variance))
      };
    }
  }
  return {
    n:0,
    mean:Number.isFinite(mean) ? mean : null,
    median:null,
    min:null,
    max:null,
    range:null,
    std:Number.isFinite(std) ? std : null
  };
}

function histogram(values,bins=12) {
  const xs=finiteNumbers(values);
  if (!xs.length) return [];
  const min=Math.min(...xs), max=Math.max(...xs);
  if (max === min) return [{lo:min,hi:max,count:xs.length}];
  const step=(max-min)/bins;
  const out=Array.from({length:bins},(_,i)=>({lo:min+i*step,hi:min+(i+1)*step,count:0}));
  xs.forEach(x => {
    const i=Math.min(bins-1,Math.max(0,Math.floor((x-min)/step)));
    out[i].count += 1;
  });
  return out;
}

function StatisticValue({label,value,suffix=""}) {
  const display = value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value).toFixed(2)}${suffix}`;
  return (
    <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:".04em"}}>{label}</div>
      <div style={{fontSize:15,fontWeight:700,marginTop:2}}>{display}</div>
    </div>
  );
}

function DistributionStatsPanel({title,distribution,samples,fallbackStats,observedCount,probability,onClose}) {
  const actual=describeNumbers(samples);
  const stats=actual || fallbackStats;
  const hist=histogram(samples);
  const maxCount=hist.length ? Math.max(...hist.map(x=>x.count),1) : 1;
  return (
    <div style={{margin:"12px",padding:14,border:"1px solid #cbd5e1",borderRadius:10,background:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
        <div>
          <div style={{fontWeight:800}}>{title}</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:3}}>
            Distribution: <b>{distribution || "unavailable"}</b>
            {actual ? " · statistics computed from observed points" : " · model parameters shown where computable"}
          </div>
        </div>
        <button style={{...buttonStyle,padding:"5px 9px"}} onClick={onClose}>Close</button>
      </div>

      {(observedCount !== undefined && observedCount !== null || probability !== undefined && probability !== null) &&
        <div style={{fontSize:12,color:"#475569",marginTop:9}}>
          {observedCount !== undefined && observedCount !== null ? `Observed transitions: ${observedCount}` : ""}
          {observedCount !== undefined && observedCount !== null && probability !== undefined && probability !== null ? " · " : ""}
          {probability !== undefined && probability !== null ? `Routing probability: ${(100*Number(probability)).toFixed(1)}%` : ""}
        </div>
      }

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:8,marginTop:12}}>
        <StatisticValue label="Points" value={actual ? actual.n : (observedCount ?? 0)} />
        <StatisticValue label="Mean" value={stats?.mean} suffix=" min" />
        <StatisticValue label="Median" value={stats?.median} suffix=" min" />
        <StatisticValue label="Min" value={stats?.min} suffix=" min" />
        <StatisticValue label="Max" value={stats?.max} suffix=" min" />
        <StatisticValue label="Range" value={stats?.range} suffix=" min" />
        <StatisticValue label="Std dev" value={stats?.std} suffix=" min" />
      </div>

      {hist.length > 0 ?
        <div style={{marginTop:14}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Observed distribution</div>
          <div style={{height:120,display:"flex",gap:3,alignItems:"flex-end",borderLeft:"1px solid #cbd5e1",borderBottom:"1px solid #cbd5e1",padding:"8px 8px 0"}}>
            {hist.map((b,i) =>
              <div key={i} title={`${b.lo.toFixed(2)}–${b.hi.toFixed(2)} min: ${b.count}`} style={{flex:1,minWidth:5,height:`${Math.max(4,100*b.count/maxCount)}%`,background:"#6366f1",borderRadius:"3px 3px 0 0"}} />
            )}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#64748b",marginTop:3}}>
            <span>{hist[0].lo.toFixed(2)} min</span><span>{hist[hist.length-1].hi.toFixed(2)} min</span>
          </div>
        </div>
        :
        <div style={{fontSize:12,color:"#64748b",marginTop:12}}>
          No observed point distribution is available for this item. Summary values are shown only where the configured distribution makes them identifiable.
        </div>
      }
    </div>
  );
}

function ProcessGraph({model,onSelectActivity,onSelectTransition,selectedActivityId,selectedTransitionIndex}) {
  const [statsTarget,setStatsTarget] = useState(null);

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
  const nodeH = 88;
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
              <g
                key={`${t.source}-${t.target}-${i}`}
                onClick={() => onSelectTransition?.(i)}
                style={{cursor:onSelectTransition ? "pointer" : "default"}}
              >
                <path
                  d={edgePath(
                    t.source,
                    t.target,
                    i
                  )}
                  fill="none"
                  stroke={
                    selectedTransitionIndex === i
                    ? "#2563eb"
                    : backward
                      ? "#b45309"
                      : "#64748b"
                  }
                  strokeWidth={selectedTransitionIndex === i ? "4" : "2"}
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
                      x={mx-52}
                      y={my-10}
                      width="48"
                      height="19"
                      rx="8"
                      fill="#fff"
                      stroke="#e5e7eb"
                    />

                    <text
                      x={mx-28}
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

                    <g
                      onClick={e => {
                        e.stopPropagation();
                        setStatsTarget({type:"transition",index:i});
                      }}
                      style={{cursor:"pointer"}}
                    >
                      <rect x={mx+2} y={my-10} width="45" height="19" rx="8" fill="#eef2ff" stroke="#a5b4fc" />
                      <text x={mx+24.5} y={my+4} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#4338ca">Stats</text>
                    </g>
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
              transform={`translate(${p.x},${p.y})`}
              onClick={() => onSelectActivity?.(a.id)}
              style={{cursor:onSelectActivity ? "pointer" : "default"}}
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
                  selectedActivityId === a.id
                  ? "4"
                  : isStart || isEnd
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
                  x="10"
                  y="67"
                  fontSize="9"
                  fontWeight="700"
                  fill={isStart ? "#4f46e5" : "#059669"}
                >
                  {isStart ? "START" : "END"}
                </text>
              }

              <g
                onClick={e => {
                  e.stopPropagation();
                  setStatsTarget({type:"activity",id:a.id});
                }}
                style={{cursor:"pointer"}}
              >
                <rect x={nodeW-58} y="56" width="48" height="20" rx="8" fill="#eef2ff" stroke="#a5b4fc" />
                <text x={nodeW-34} y="70" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#4338ca">Stats</text>
              </g>
            </g>
          );
        })}
      </svg>

      {statsTarget?.type === "activity" && (() => {
        const a = activities.find(x => x.id === statsTarget.id);
        if (!a) return null;
        const st = a.service_time || {};
        return (
          <DistributionStatsPanel
            title={`${a.name || a.id} — activity duration`}
            distribution={st.distribution}
            samples={st.samples_minutes}
            fallbackStats={modelStatsForServiceTime(st)}
            onClose={() => setStatsTarget(null)}
          />
        );
      })()}

      {statsTarget?.type === "transition" && (() => {
        const t = transitions[statsTarget.index];
        if (!t) return null;
        const source = byId[t.source]?.name || t.source;
        const target = byId[t.target]?.name || t.target;
        return (
          <DistributionStatsPanel
            title={`${source} → ${target} — handoff delay`}
            distribution={finiteNumbers(t.handoff_samples_minutes).length ? "empirical" : "unavailable"}
            samples={t.handoff_samples_minutes}
            fallbackStats={null}
            observedCount={t.observed_count}
            probability={t.probability}
            onClose={() => setStatsTarget(null)}
          />
        );
      })()}

      <div style={{
        fontSize:11,
        color:"#64748b",
        padding:"0 12px 10px"
      }}>
        Solid arrows show forward routing. Dashed amber arrows
        indicate same-level/backward routing such as rework loops.
        Edge labels show routing probabilities. Use each node or edge Stats button to inspect its observed distribution and descriptive statistics.
      </div>
    </div>
  );
}

function DesignSpaceChart({results,target=0.90}) {
  const points = [];

  (results || []).forEach(r => {
    const frontier = r?.robust_frontier?.frontier || [];
    frontier.forEach(p => points.push({
      architecture:r.architecture,
      cost:Number(p.cost),
      robustness:Number(p.robustness_probability),
      targetMet:Boolean(p.target_met)
    }));
  });

  if (!points.length) return null;

  const width = 760;
  const height = 300;
  const pad = {left:72,right:25,top:25,bottom:48};
  const costs = points.map(p => p.cost);
  const cmin = Math.min(...costs);
  const cmax = Math.max(...costs);
  const span = Math.max(cmax-cmin, 1);
  const x = c => pad.left + (c-cmin)/span*(width-pad.left-pad.right);
  const y = r => pad.top + (1-r)*(height-pad.top-pad.bottom);

  return (
    <div style={{...card,marginTop:16,background:"#fafafa"}}>
      <div style={{fontWeight:800}}>Design-space frontier</div>
      <div style={{fontSize:12,color:"#6b7280",marginTop:3}}>
        Each point is a cost/robustness candidate from the replicated frontier.
        The dashed line marks the robustness target.
      </div>
      <div style={{overflowX:"auto",marginTop:8}}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height-pad.bottom} stroke="#94a3b8" />
          <line x1={pad.left} y1={height-pad.bottom} x2={width-pad.right} y2={height-pad.bottom} stroke="#94a3b8" />
          <line x1={pad.left} y1={y(target)} x2={width-pad.right} y2={y(target)} stroke="#b45309" strokeDasharray="6 5" />
          <text x={width-pad.right} y={y(target)-5} textAnchor="end" fontSize="11" fill="#92400e">{fmtPct(target)} target</text>
          {[0.5,0.75,0.9,1.0].map(v => (
            <g key={v}>
              <line x1={pad.left-5} y1={y(v)} x2={pad.left} y2={y(v)} stroke="#94a3b8"/>
              <text x={pad.left-9} y={y(v)+4} textAnchor="end" fontSize="10" fill="#64748b">{fmtPct(v)}</text>
            </g>
          ))}
          {points.map((p,i) => (
            <g key={`${p.architecture}-${i}`}>
              <circle cx={x(p.cost)} cy={y(p.robustness)} r={p.targetMet ? 6 : 4.5} fill={p.targetMet ? "#16a34a" : "#64748b"}>
                <title>{`${p.architecture}: ${money(p.cost)}, ${fmtPct(p.robustness)}`}</title>
              </circle>
            </g>
          ))}
          <text x={(pad.left+width-pad.right)/2} y={height-10} textAnchor="middle" fontSize="11" fill="#475569">Annual cost</text>
          <text transform={`translate(16 ${(pad.top+height-pad.bottom)/2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="#475569">Replicated feasibility</text>
          <text x={pad.left} y={height-pad.bottom+18} fontSize="10" fill="#64748b">{money(cmin)}</text>
          <text x={width-pad.right} y={height-pad.bottom+18} textAnchor="end" fontSize="10" fill="#64748b">{money(cmax)}</text>
        </svg>
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

  const [selectedActivityId,setSelectedActivityId] = useState(null);
  const [selectedTransitionIndex,setSelectedTransitionIndex] = useState(null);
  const [skillMatrixOpen,setSkillMatrixOpen] = useState(false);

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


  async function loadGeneralProcessSample() {
    try {
      setStatus("Loading General Process sample");

      const response = await fetch(
        "/samples/general_process_sample.csv"
      );

      if (!response.ok) {
        throw new Error(
          "Unable to load the General Process sample"
        );
      }

      const blob = await response.blob();
      const sampleFile = new File(
        [blob],
        "general_process_sample.csv",
        { type:"text/csv" }
      );

      const form = new FormData();
      form.append("file", sampleFile);
      form.append("case_col", "CaseID");
      form.append("activity_col", "Activity");
      form.append("start_col", "StartTime");
      form.append("end_col", "EndTime");
      form.append("resource_col", "Resource");
      form.append(
        "sla_minutes",
        String(model?.sla_minutes || 360)
      );

      const data = await call(
        "/api/event-log/calibrate",
        { method:"POST", body:form },
        "Loading General Process sample"
      );

      setModel(data.model);
      setCalibration(data.summary);
      setSim(null);
      setOpt(null);
      setCmp(null);
      setLogFile(null);
      setLogPreview(null);
      setStatus("General Process sample loaded");
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
              seed:2,
              replications:20
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

            const numericServiceFields = new Set([
              "mean_minutes",
              "std_minutes",
              "minimum_minutes",
              "mode_minutes",
              "maximum_minutes",
              "scale"
            ]);

            if (numericServiceFields.has(field)) {
              const service = {
                ...a.service_time,
                [field]:Number(value)
              };

              if (["minimum_minutes","mode_minutes","maximum_minutes"].includes(field)) {
                const lo = Number(service.minimum_minutes ?? 0);
                const md = Number(service.mode_minutes ?? lo);
                const hi = Number(service.maximum_minutes ?? md);
                if (lo <= md && md <= hi) {
                  service.mean_minutes = (lo + md + hi) / 3;
                  service.std_minutes = Math.sqrt(
                    Math.max(
                      0,
                      (lo*lo + md*md + hi*hi - lo*md - lo*hi - md*hi) / 18
                    )
                  );
                }
              }

              if (field === "scale" && a.model_source === "borrowed") {
                const src = (prev.activities || []).find(x => x.id === service.source_activity_id);
                if (src) {
                  service.mean_minutes = Number(src.service_time?.mean_minutes || 0) * Number(service.scale || 1);
                  service.std_minutes = Number(src.service_time?.std_minutes || 0) * Number(service.scale || 1);
                }
              }

              return {
                ...a,
                service_time:service
              };
            }

            if (field === "samples_text") {
              const samples = String(value)
                .split(/[\s,;]+/)
                .map(Number)
                .filter(x => Number.isFinite(x) && x > 0);
              const mean = samples.length
                ? samples.reduce((x,y) => x+y,0) / samples.length
                : 0;
              const variance = samples.length > 1
                ? samples.reduce((sum,x) => sum + (x-mean)*(x-mean),0) / (samples.length-1)
                : 0;
              return {
                ...a,
                model_source:"manual_sample",
                confidence:samples.length >= 30 ? "high" : (samples.length >= 5 ? "moderate" : (samples.length ? "low" : "insufficient")),
                terminal:false,
                service_time:{
                  ...a.service_time,
                  distribution:"empirical",
                  samples_minutes:samples,
                  mean_minutes:Math.max(mean,0.01),
                  std_minutes:Math.sqrt(Math.max(variance,0))
                }
              };
            }

            if (field === "model_source") {
              const source = value;
              const baseService = {...a.service_time};
              if (source === "terminal") {
                return {
                  ...a,
                  model_source:"terminal",
                  confidence:"defined",
                  terminal:true,
                  resource_pool:null,
                  cost_per_hour:0,
                  service_time:{
                    ...baseService,
                    distribution:"constant",
                    mean_minutes:0.01,
                    std_minutes:0
                  }
                };
              }
              if (source === "expert_estimate") {
                const currentMean = Number(baseService.mean_minutes || 5);
                const lo = Number(baseService.minimum_minutes ?? Math.max(0.01,currentMean*0.5));
                const md = Number(baseService.mode_minutes ?? currentMean);
                const hi = Number(baseService.maximum_minutes ?? currentMean*1.75);
                const triMean = (lo + md + hi) / 3;
                const triStd = Math.sqrt(Math.max(0,(lo*lo + md*md + hi*hi - lo*md - lo*hi - md*hi) / 18));
                return {
                  ...a,
                  model_source:source,
                  confidence:"moderate",
                  terminal:false,
                  service_time:{
                    ...baseService,
                    distribution:"triangular",
                    minimum_minutes:lo,
                    mode_minutes:md,
                    maximum_minutes:hi,
                    mean_minutes:triMean,
                    std_minutes:triStd
                  }
                };
              }
              if (source === "manual_sample") {
                return {
                  ...a,
                  model_source:source,
                  confidence:(baseService.samples_minutes || []).length >= 5 ? "moderate" : "insufficient",
                  terminal:false,
                  service_time:{...baseService,distribution:"empirical",samples_minutes:baseService.samples_minutes || []}
                };
              }
              if (source === "borrowed") {
                return {
                  ...a,
                  model_source:source,
                  confidence:"moderate",
                  terminal:false,
                  service_time:{...baseService,distribution:"borrowed",scale:Number(baseService.scale || 1)}
                };
              }
              if (source === "fixed") {
                return {
                  ...a,
                  model_source:source,
                  confidence:"defined",
                  terminal:false,
                  service_time:{...baseService,distribution:"constant",std_minutes:0}
                };
              }
              if (source === "unresolved") {
                return {
                  ...a,
                  model_source:source,
                  confidence:"insufficient",
                  terminal:false,
                  service_time:{...baseService,distribution:"unresolved"}
                };
              }
              return {...a,model_source:source,terminal:false};
            }

            if (field === "source_activity_id") {
              const src = (prev.activities || []).find(x => x.id === value);
              const scale = Number(a.service_time?.scale || 1);
              return {
                ...a,
                model_source:"borrowed",
                confidence:src?.confidence === "high" ? "high" : "moderate",
                terminal:false,
                service_time:{
                  ...a.service_time,
                  distribution:"borrowed",
                  source_activity_id:value,
                  mean_minutes:src ? Number(src.service_time?.mean_minutes || 0) * scale : Number(a.service_time?.mean_minutes || 0),
                  std_minutes:src ? Number(src.service_time?.std_minutes || 0) * scale : Number(a.service_time?.std_minutes || 0)
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

  async function loadActivitySamplesFile(id,file) {
    if (!file) return;
    const text = await file.text();
    updateActivity(id,"samples_text",text);
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

  function modelSkillColumns(m) {
    const values = new Set();

    (m?.agents || []).forEach(a =>
      (a.skills || []).forEach(s => {
        const v = String(s || "").trim();
        if (v) values.add(v);
      })
    );

    (m?.resources || []).forEach(r =>
      (r.skills || []).forEach(s => {
        const v = String(s || "").trim();
        if (v) values.add(v);
      })
    );

    (m?.activities || []).forEach(a =>
      (a.required_skills || []).forEach(s => {
        const v = String(s || "").trim();
        if (v) values.add(v);
      })
    );

    return Array.from(values).sort((a,b) => a.localeCompare(b));
  }

  function skillMatrixRows(m) {
    if (Array.isArray(m?.agents) && m.agents.length) {
      return m.agents.map(a => ({
        ...a,
        _matrixType:"agent"
      }));
    }

    return (m?.resources || []).map(r => ({
      ...r,
      resource_pool:r.id,
      _matrixType:"pool"
    }));
  }

  function recomputeSkillEligibility(next) {
    const resources = Array.isArray(next?.resources) ? next.resources : [];
    const agents = Array.isArray(next?.agents) ? next.agents : [];

    let updatedResources = resources;

    if (agents.length) {
      const skillsByPool = {};
      agents
        .filter(a => a.active !== false)
        .forEach(a => {
          if (!skillsByPool[a.resource_pool]) {
            skillsByPool[a.resource_pool] = new Set();
          }
          (a.skills || []).forEach(skill =>
            skillsByPool[a.resource_pool].add(skill)
          );
        });

      updatedResources = resources.map(r => ({
        ...r,
        skills:Array.from(
          skillsByPool[r.id] || new Set(r.skills || [])
        ).sort((a,b) => String(a).localeCompare(String(b)))
      }));
    }

    const poolSkillMap = Object.fromEntries(
      updatedResources.map(r => [r.id, new Set(r.skills || [])])
    );

    return {
      ...next,
      resources:updatedResources,
      activities:(next.activities || []).map(a => {
        const required = Array.isArray(a.required_skills)
          ? a.required_skills.filter(Boolean)
          : [];
        if (!required.length) return a;

        let eligible;

        if (agents.length) {
          eligible = Array.from(new Set(
            agents
              .filter(agent =>
                agent.active !== false
                && required.every(skill =>
                  (agent.skills || []).includes(skill)
                )
              )
              .map(agent => agent.resource_pool)
          )).sort();
        } else {
          eligible = updatedResources
            .filter(r => required.every(skill => poolSkillMap[r.id]?.has(skill)))
            .map(r => r.id);
        }

        return {
          ...a,
          eligible_resource_pools:eligible,
          routing_policy:eligible.length > 1 || required.length
            ? "earliest_available_skill"
            : a.routing_policy
        };
      })
    };
  }

  function toggleMatrixSkill(rowId,skill) {
    setModel(prev => {
      if (!prev) return prev;

      if (Array.isArray(prev.agents) && prev.agents.length) {
        const next = {
          ...prev,
          agents:prev.agents.map(a => {
            if (a.id !== rowId) return a;
            const current = new Set(a.skills || []);
            const proficiency = {...(a.skill_proficiency || {})};

            if (current.has(skill)) {
              current.delete(skill);
              delete proficiency[skill];
            } else {
              current.add(skill);
              proficiency[skill] = 1.0;
            }

            return {
              ...a,
              skills:Array.from(current).sort((x,y) => String(x).localeCompare(String(y))),
              skill_proficiency:proficiency
            };
          })
        };
        return recomputeSkillEligibility(next);
      }

      const next = {
        ...prev,
        resources:(prev.resources || []).map(r => {
          if (r.id !== rowId) return r;
          const current = new Set(r.skills || []);
          if (current.has(skill)) current.delete(skill);
          else current.add(skill);
          return {
            ...r,
            skills:Array.from(current).sort((a,b) => String(a).localeCompare(String(b)))
          };
        })
      };
      return recomputeSkillEligibility(next);
    });
    setSim(null);
    setOpt(null);
    setCmp(null);
  }

  function updateAgentProficiency(agentId,skill,value) {
    const numeric = Math.min(1,Math.max(0.25,Number(value) || 1));
    setModel(prev => {
      if (!prev) return prev;
      return recomputeSkillEligibility({
        ...prev,
        agents:(prev.agents || []).map(a =>
          a.id === agentId
          ? {
              ...a,
              skill_proficiency:{
                ...(a.skill_proficiency || {}),
                [skill]:numeric
              }
            }
          : a
        )
      });
    });
    setSim(null);
    setOpt(null);
    setCmp(null);
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
      base.model_source = "unresolved";
      base.confidence = "insufficient";
      base.terminal = false;

      base.service_time = {
        ...(base.service_time || {}),
        distribution:"unresolved",
        mean_minutes:5,
        std_minutes:0,
        minimum_minutes:null,
        mode_minutes:null,
        maximum_minutes:null,
        samples_minutes:[],
        source_activity_id:null,
        scale:1
      };

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
      setStatus(
        "Loading Contact Center sample workbook"
      );

      const response = await fetch(
        "/samples/contact_center_sample.xlsx"
      );

      if (!response.ok) {
        throw new Error(
          "Unable to load the sample workbook"
        );
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
      setContactCenterPreview(null);
      setLogFile(null);
      setLogPreview(null);
      setStatus("Contact Center sample loaded");
    } catch(e) {
      setStatus(e.message);
    }
  }

  async function previewContactCenterWorkbook() {
    if (!logFile) {
      setStatus(
        "Choose a Contact Center Excel workbook first"
      );
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
      setStatus(
        "Contact Center workbook is valid"
      );
    } catch(e) {
      setContactCenterPreview(null);
      setStatus(e.message);
    }
  }

  async function importContactCenterWorkbook() {
    if (!logFile) {
      setStatus(
        "Choose a Contact Center Excel workbook first"
      );
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
      setContactCenterPreview(null);
      setStatus(
        "Contact Center model loaded"
      );
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
        <div style={{
          fontSize:11,
          fontWeight:800,
          letterSpacing:".06em",
          textTransform:"uppercase",
          color:"#6366f1",
          marginBottom:6
        }}>
          Step 1 · Choose workflow class
        </div>

        <h2 style={{margin:"0 0 6px"}}>
          Build the process model
        </h2>

        <p style={{
          marginTop:0,
          color:"#4b5563",
          lineHeight:1.5
        }}>
          Choose the application type first. The data template,
          importer, and model assumptions change for that workflow class.
        </p>

        <div style={{
          display:"grid",
          gridTemplateColumns:"minmax(220px,320px) 1fr",
          gap:14,
          alignItems:"end",
          marginTop:16
        }}>
          <label style={{
            fontSize:12,
            color:"#475569",
            fontWeight:700
          }}>
            Workflow class
            <select
              value={workflowClass}
              onChange={e => {
                const next =
                  e.target.value;
                setWorkflowClass(next);
                setLogFile(null);
                setLogPreview(null);
                setContactCenterPreview(null);
                setCalibration(null);
              }}
              style={{
                display:"block",
                width:"100%",
                marginTop:6
              }}
            >
              <option value="general">
                General Process
              </option>
              <option value="contact_center">
                Contact Center
              </option>
            </select>
          </label>

          <div style={{
            fontSize:13,
            color:"#64748b",
            lineHeight:1.45
          }}>
            {workflowClass === "contact_center"
              ? "Contact Center uses a standard multi-sheet Excel workbook for events, agent skills, staffing, and interval arrivals."
              : "General Process uses event logs for activities, timestamps, resources, routing, service-time calibration, and hybrid manual modeling."}
          </div>
        </div>
      </section>

      {workflowClass === "contact_center" &&
        <section style={{
          ...card,
          marginTop:18
        }}>
          <h2 style={{marginTop:0}}>
            Contact Center Excel import
          </h2>

          <p style={{
            color:"#4b5563",
            lineHeight:1.5
          }}>
            Use the standard multi-sheet workbook. The app validates
            events, agent skills, staffing profiles, and interval arrivals,
            then converts them into the common process digital-twin model.
          </p>

          <div style={{
            display:"flex",
            gap:10,
            flexWrap:"wrap",
            marginBottom:14
          }}>
            <button
              disabled={busy}
              style={{
                ...buttonStyle,
                opacity:busy ? 0.55 : 1
              }}
              onClick={loadContactCenterSample}
            >
              Load sample Contact Center
            </button>

            <a
              href="/templates/contact_center_template.xlsx"
              download
              style={buttonStyle}
            >
              Download blank Excel template
            </a>

            <a
              href="/samples/contact_center_sample.xlsx"
              download
              style={buttonStyle}
            >
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
            Required sheets: <b>Events</b>, <b>Agent_Skills</b>,
            {" "}<b>Staffing</b>, <b>Arrivals</b>. Optional:
            {" "}<b>Settings</b>.
          </div>

          <div style={{
            display:"flex",
            gap:10,
            flexWrap:"wrap",
            alignItems:"center"
          }}>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={e => {
                setLogFile(
                  e.target.files?.[0] || null
                );
                setContactCenterPreview(null);
                setCalibration(null);
              }}
            />

            <button
              disabled={busy || !logFile}
              style={{
                ...buttonStyle,
                opacity:
                  busy || !logFile
                  ? 0.55
                  : 1
              }}
              onClick={
                previewContactCenterWorkbook
              }
            >
              Validate workbook
            </button>

            <button
              disabled={busy || !logFile}
              style={{
                ...buttonStyle,
                opacity:
                  busy || !logFile
                  ? 0.55
                  : 1
              }}
              onClick={
                importContactCenterWorkbook
              }
            >
              Build Contact Center model
            </button>
          </div>

          {contactCenterPreview &&
            <div style={{
              marginTop:14,
              fontSize:13,
              color:"#166534",
              fontWeight:700
            }}>
              Workbook valid · {
                Object.entries(
                  contactCenterPreview.sheets || {}
                ).map(
                  ([name,info]) =>
                    `${name}: ${info.rows} rows`
                ).join(" · ")
              }
            </div>
          }

          {calibration?.workflow_class === "contact_center" &&
            <div style={{
              marginTop:14,
              fontSize:13,
              color:"#475569",
              lineHeight:1.6
            }}>
              Imported {calibration.interactions} interaction(s),
              {" "}{calibration.service_legs} service leg(s),
              {" "}{calibration.activities} workflow activity/queue(s),
              and {calibration.resource_pools} resource pool(s).
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
          General Process data
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
          marginBottom:14
        }}>
          <button
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:busy ? 0.55 : 1
            }}
            onClick={loadModel}
          >
            Load demo model
          </button>

          <button
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:busy ? 0.55 : 1
            }}
            onClick={loadGeneralProcessSample}
          >
            Load sample General Process
          </button>

          <a
            href="/templates/general_process_template.csv"
            download
            style={buttonStyle}
          >
            Download blank CSV template
          </a>

          <a
            href="/samples/general_process_sample.csv"
            download
            style={buttonStyle}
          >
            Download sample CSV
          </a>
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

            {Number(calibration.unresolved_activity_count || 0) > 0 &&
              <div style={{marginTop:12,padding:"10px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:12,color:"#9a3412"}}>
                <b>{calibration.unresolved_activity_count} activity{Number(calibration.unresolved_activity_count) === 1 ? "" : "ies"} have no usable duration observations.</b> Select each highlighted activity in the Visual Process Modeler and define it as terminal, triangular, manual-sample, borrowed, or fixed before simulation/optimization.
              </div>
            }

            {Array.isArray(calibration.activity_models) && calibration.activity_models.length > 0 &&
              <div style={{marginTop:18}}>
                <div style={{fontWeight:800,marginBottom:8}}>Activity modeling provenance</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr><th align="left">Activity</th><th align="right">Duration observations</th><th align="left">Model source</th><th align="left">Simulation distribution</th><th align="left">Confidence</th></tr></thead>
                    <tbody>
                      {calibration.activity_models.map(x =>
                        <tr key={x.activity_id} style={{background:x.model_source === "unresolved" ? "#fff7ed" : "transparent"}}>
                          <td style={{padding:"6px 4px"}}>{x.activity}</td>
                          <td align="right">{x.model_source === "terminal" ? "—" : x.service_observations}</td>
                          <td style={{paddingLeft:10}}>{x.model_source}</td>
                          <td>{x.distribution}</td>
                          <td style={{fontWeight:x.confidence === "insufficient" ? 800 : 500,color:x.confidence === "insufficient" ? "#9a3412" : "#475569"}}>{x.confidence}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            }

            {Array.isArray(calibration.top_variants) && calibration.top_variants.length > 0 &&
              <div style={{marginTop:18}}>
                <div style={{fontWeight:800,marginBottom:8}}>Top process variants</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr><th align="left">#</th><th align="left">Path</th><th align="right">Cases</th><th align="right">Share</th><th align="right">Mean cycle</th><th align="right">P95 cycle</th><th align="left">Rework</th></tr></thead>
                    <tbody>
                      {calibration.top_variants.slice(0,8).map(v =>
                        <tr key={v.rank}>
                          <td style={{padding:"6px 4px"}}>{v.rank}</td>
                          <td style={{padding:"6px 4px",minWidth:280}}>{v.path}</td>
                          <td align="right">{v.cases}</td>
                          <td align="right">{fmtPct(v.share)}</td>
                          <td align="right">{Number(v.mean_cycle_minutes).toFixed(1)} min</td>
                          <td align="right">{Number(v.p95_cycle_minutes).toFixed(1)} min</td>
                          <td style={{paddingLeft:8,fontWeight:v.has_rework ? 700 : 400,color:v.has_rework ? "#92400e" : "#475569"}}>{v.has_rework ? "Yes" : "No"}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            }
          </div>
        }
      </section>
      }


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


      {workflowClass === "general" &&
      <section style={{
        ...card,
        marginTop:18
      }}>
        <h2 style={{
          marginTop:0
        }}>
          Baseline & analysis
        </h2>

        <p style={{color:"#4b5563",lineHeight:1.5,marginTop:0}}>
          Run simulation and optimization only after the process model has been loaded or calibrated above.
        </p>

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

              {modelSkillColumns(model).length > 0 &&
                <button
                  disabled={busy}
                  style={{
                    ...buttonStyle,
                    background:skillMatrixOpen ? "#eef2ff" : "#fff",
                    borderColor:skillMatrixOpen ? "#a5b4fc" : "#d1d5db"
                  }}
                  onClick={() => setSkillMatrixOpen(x => !x)}
                >
                  {skillMatrixOpen ? "Hide skill matrix" : "Skill matrix"}
                </button>
              }

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
              selectedActivityId={selectedActivityId}
              selectedTransitionIndex={selectedTransitionIndex}
              onSelectActivity={id => {
                setSelectedActivityId(id);
                setSelectedTransitionIndex(null);
              }}
              onSelectTransition={i => {
                setSelectedTransitionIndex(i);
                setSelectedActivityId(null);
              }}
            />
          </div>

          {skillMatrixOpen && modelSkillColumns(model).length > 0 &&
            <div style={{...card,marginTop:12,background:"#f8fafc"}}>
              <div style={{fontWeight:800}}>
                Editable skill matrix
              </div>
              <div style={{fontSize:12,color:"#64748b",marginTop:4,lineHeight:1.45}}>
                {Array.isArray(model.agents) && model.agents.length
                  ? "Rows are individual resources/agents and columns are skills. Cross-train a specific person by checking a skill. Proficiency from 0.25 to 1.00 affects that person's modeled service time."
                  : "Rows are resource pools and columns are skills. Check or clear a skill assignment to change pool eligibility."}
                {" "}Rerun Simulation or Optimization after edits to evaluate the effect.
              </div>

              <div style={{overflowX:"auto",marginTop:12}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr>
                      <th style={{textAlign:"left",padding:"7px 8px",position:"sticky",left:0,background:"#f8fafc",zIndex:1,borderBottom:"1px solid #e2e8f0"}}>
                        {Array.isArray(model.agents) && model.agents.length
                          ? "Individual resource"
                          : "Resource pool"}
                      </th>
                      {modelSkillColumns(model).map(skill =>
                        <th key={skill} style={{textAlign:"center",padding:"7px 10px",whiteSpace:"nowrap",borderBottom:"1px solid #e2e8f0"}}>
                          {skill}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {skillMatrixRows(model).map(row =>
                      <tr key={row.id}>
                        <td style={{padding:"8px",fontWeight:700,position:"sticky",left:0,background:"#f8fafc",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>
                          {row.name || row.id}
                          <div style={{fontSize:10,color:"#94a3b8",fontWeight:400}}>
                            {row._matrixType === "agent"
                              ? `${row.id} · ${row.resource_pool}${row.synthetic ? " · unspecified staffing slot" : ""}`
                              : row.id}
                          </div>
                        </td>
                        {modelSkillColumns(model).map(skill => {
                          const checked=(row.skills || []).includes(skill);
                          const proficiency = checked && row._matrixType === "agent"
                            ? Number(row.skill_proficiency?.[skill] ?? 1)
                            : null;
                          return (
                            <td key={`${row.id}-${skill}`} style={{textAlign:"center",padding:"6px 8px",borderBottom:"1px solid #e2e8f0",minWidth:92}}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleMatrixSkill(row.id,skill)}
                                aria-label={`${row.name || row.id}: ${skill}`}
                              />
                              {checked && row._matrixType === "agent" &&
                                <div style={{marginTop:4}}>
                                  <input
                                    type="number"
                                    min="0.25"
                                    max="1"
                                    step="0.05"
                                    value={proficiency}
                                    onChange={e => updateAgentProficiency(row.id,skill,e.target.value)}
                                    title="Skill proficiency; 1.00 is baseline speed"
                                    style={{width:58,fontSize:10,padding:"2px 3px",textAlign:"center"}}
                                  />
                                </div>
                              }
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{marginTop:10,padding:"9px 10px",borderRadius:8,background:"#fff",border:"1px solid #e2e8f0",fontSize:11,color:"#475569",lineHeight:1.45}}>
                {Array.isArray(model.agents) && model.agents.length
                  ? "The simulator now allocates work to individual eligible agents. Pool staffing profiles determine how many agent slots are active at each interval. Cross-training therefore changes the number and identity of resources that can serve a skill. Lower proficiency increases service time for that agent until training reaches baseline proficiency 1.00."
                  : "Skill edits recalculate each skill-constrained activity's eligible resource pools and affect the next simulation/optimization run."}
              </div>
            </div>
          }

          {(selectedActivityId || selectedTransitionIndex !== null) &&
            <div style={{...card,marginTop:12,background:"#f8fafc"}}>
              {selectedActivityId && (() => {
                const a = (model.activities || []).find(x => x.id === selectedActivityId);
                if (!a) return null;
                return (
                  <>
                    <div style={{fontWeight:800,marginBottom:4}}>Selected activity</div>
                    <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>
                      Model source: <b>{a.model_source || "configured"}</b> · Confidence: <b>{a.confidence || "defined"}</b>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
                      <label style={{fontSize:12}}>Name
                        <input value={a.name} onChange={e => updateActivity(a.id,"name",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/>
                      </label>
                      <label style={{fontSize:12}}>How should this step be modeled?
                        <select value={a.model_source || "configured"} onChange={e => updateActivity(a.id,"model_source",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}>
                          <option value="configured">Configured model</option>
                          <option value="event_log">Event-log calibrated</option>
                          <option value="expert_estimate">Triangular SME estimate</option>
                          <option value="manual_sample">Manual sample / bootstrap</option>
                          <option value="borrowed">Borrow another activity</option>
                          <option value="fixed">Fixed duration</option>
                          <option value="terminal">Terminal / milestone</option>
                          <option value="unresolved">Unresolved / data missing</option>
                        </select>
                      </label>
                      {!a.terminal &&
                        <label style={{fontSize:12}}>Resource pool
                          <select value={a.resource_pool || ""} onChange={e => updateActivity(a.id,"resource_pool",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}>
                            <option value="">No resource pool</option>
                            {resourceOptions(model).map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </label>
                      }
                    </div>

                    {a.model_source === "unresolved" &&
                      <div style={{marginTop:10,padding:"10px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:12,color:"#9a3412"}}>
                        No usable duration observations were available for this step. Choose Terminal, Triangular SME estimate, Manual sample, Borrow another activity, or Fixed duration before simulation/optimization.
                      </div>
                    }

                    {a.model_source === "expert_estimate" &&
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginTop:10}}>
                        <label style={{fontSize:12}}>Minimum (min)<input type="number" min="0" step="0.1" value={a.service_time?.minimum_minutes ?? ""} onChange={e => updateActivity(a.id,"minimum_minutes",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/></label>
                        <label style={{fontSize:12}}>Most likely (min)<input type="number" min="0" step="0.1" value={a.service_time?.mode_minutes ?? ""} onChange={e => updateActivity(a.id,"mode_minutes",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/></label>
                        <label style={{fontSize:12}}>Maximum (min)<input type="number" min="0" step="0.1" value={a.service_time?.maximum_minutes ?? ""} onChange={e => updateActivity(a.id,"maximum_minutes",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/></label>
                      </div>
                    }

                    {a.model_source === "manual_sample" &&
                      <label style={{fontSize:12,display:"block",marginTop:10}}>Observed durations in minutes — paste values separated by commas, spaces, or new lines
                        <textarea rows="4" defaultValue={(a.service_time?.samples_minutes || []).join(", ")} onBlur={e => updateActivity(a.id,"samples_text",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/>
                        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:6}}>
                          <span style={{color:"#64748b"}}>{(a.service_time?.samples_minutes || []).length} usable observations · empirical bootstrap</span>
                          <label style={{fontSize:12}}>or upload CSV/TXT durations
                            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => loadActivitySamplesFile(a.id,e.target.files?.[0])} style={{display:"block",marginTop:3}}/>
                          </label>
                        </div>
                      </label>
                    }

                    {a.model_source === "borrowed" &&
                      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginTop:10}}>
                        <label style={{fontSize:12}}>Borrow distribution from
                          <select value={a.service_time?.source_activity_id || ""} onChange={e => updateActivity(a.id,"source_activity_id",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}>
                            <option value="">Select similar activity</option>
                            {(model.activities || []).filter(x => x.id !== a.id && x.model_source !== "unresolved" && !x.terminal).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                        <label style={{fontSize:12}}>Time multiplier
                          <input type="number" min="0.01" step="0.05" value={a.service_time?.scale ?? 1} onChange={e => updateActivity(a.id,"scale",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/>
                        </label>
                      </div>
                    }

                    {a.model_source === "fixed" &&
                      <label style={{fontSize:12,display:"block",marginTop:10,maxWidth:220}}>Fixed duration (min)
                        <input type="number" min="0.01" step="0.1" value={a.service_time?.mean_minutes ?? 0} onChange={e => updateActivity(a.id,"mean_minutes",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/>
                      </label>
                    }

                    {(a.model_source === "event_log" || a.model_source === "configured") &&
                      <div style={{fontSize:12,color:"#64748b",marginTop:10}}>
                        {a.service_time?.distribution} · mean {Number(a.service_time?.mean_minutes || 0).toFixed(1)} min · std {Number(a.service_time?.std_minutes || 0).toFixed(1)} min
                      </div>
                    }

                    {a.terminal &&
                      <div style={{fontSize:12,color:"#64748b",marginTop:10}}>Terminal activities are modeled as milestones with no processing resource or material service duration.</div>
                    }
                  </>
                );
              })()}
              {selectedTransitionIndex !== null && (() => {
                const t = activeTransitions(model)[selectedTransitionIndex];
                if (!t) return null;
                const backward = (() => {
                  const acts = (model.activities || []).map(a => a.id);
                  return acts.indexOf(t.target) <= acts.indexOf(t.source);
                })();
                return (
                  <>
                    <div style={{fontWeight:800,marginBottom:10}}>Selected transition {backward ? "· rework/return path" : ""}</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
                      <label style={{fontSize:12}}>From
                        <select value={t.source} onChange={e => updateTransition(selectedTransitionIndex,"source",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}>
                          {(model.activities || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </label>
                      <label style={{fontSize:12}}>To
                        <select value={t.target} onChange={e => updateTransition(selectedTransitionIndex,"target",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}>
                          {(model.activities || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </label>
                      <label style={{fontSize:12}}>Routing probability
                        <input type="number" min="0" max="1" step="0.001" value={fmtProbabilityInput(t.probability)} onChange={e => updateTransition(selectedTransitionIndex,"probability",e.target.value)} style={{display:"block",width:"100%",marginTop:4}}/>
                      </label>
                    </div>
                    <button style={{...buttonStyle,marginTop:10}} onClick={() => {removeTransition(selectedTransitionIndex); setSelectedTransitionIndex(null);}}>Delete transition</button>
                  </>
                );
              })()}
            </div>
          }

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
                          step="0.001"
                          value={
                            fmtProbabilityInput(t.probability)
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

          {opt.results?.length > 0 &&
            (() => {
              const rec =
                opt.results[0];

              const best =
                rec.best;

              const rob =
                rec.robustness;

              return (
                <div style={{
                  ...card,
                  background:"#f0fdf4",
                  border:"1px solid #bbf7d0",
                  marginBottom:16
                }}>
                  <div style={{
                    fontSize:12,
                    fontWeight:800,
                    color:"#166534",
                    textTransform:"uppercase"
                  }}>
                    Recommended architecture
                  </div>

                  <div style={{
                    fontSize:22,
                    fontWeight:800,
                    marginTop:4
                  }}>
                    {rec.architecture}
                  </div>

                  <div style={{
                    fontSize:13,
                    color:"#475569",
                    marginTop:6,
                    lineHeight:1.5
                  }}>
                    Selected because it {
                      rec.robust_target_met
                      ? "meets the robustness target and is the lowest-cost target-meeting architecture"
                      : "is the strongest available architecture even though the robustness target is not yet met"
                    }.
                    {best?.metrics?.annual_cost !== undefined
                      ? ` Annual cost ${money(best.metrics.annual_cost)}.`
                      : ""}
                    {rob?.probability !== undefined
                      ? ` Final replicated feasibility ${fmtPct(rob.probability)}.`
                      : ""}
                  </div>

                  {best?.design && designChangeLines(model,best.design).length > 0 &&
                    <div style={{marginTop:10,fontSize:12,color:"#334155"}}>
                      <b>Why this design:</b> {designChangeLines(model,best.design).slice(0,6).join(" · ")}
                    </div>
                  }
                </div>
              );
            })()
          }

          <DesignSpaceChart results={opt.results} target={0.90} />

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

                      {rob
                        .probability_backlog_growth_above_0_05
                        >= 0.25
                        &&
                        <div style={{
                          marginTop:8,
                          padding:"8px 10px",
                          borderRadius:8,
                          background:
                            rob
                            .probability_backlog_growth_above_0_05
                            >= 0.50
                            ? "#fef2f2"
                            : "#fffbeb",
                          color:
                            rob
                            .probability_backlog_growth_above_0_05
                            >= 0.50
                            ? "#991b1b"
                            : "#92400e",
                          fontSize:12,
                          fontWeight:700
                        }}>
                          {rob
                            .probability_backlog_growth_above_0_05
                            >= 0.50
                            ? "High"
                            : "Elevated"
                          } backlog-drift risk: {
                            fmtPct(
                              rob
                              .probability_backlog_growth_above_0_05
                            )
                          } of validation runs exceeded +0.05 backlog/hr.
                        </div>
                      }
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
            {cmp.comparison_method &&
              <>
                {" "}· {
                  cmp.comparison_method.replications
                } paired replications · {
                  cmp.comparison_method.cases_per_replication
                } cases each · common random numbers
              </>
            }
          </div>

          {model && opt?.results?.[0]?.best &&
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(420px,1fr))",gap:14,marginBottom:16}}>
              <div>
                <div style={{fontWeight:800,marginBottom:6}}>AS-IS workflow</div>
                <ProcessGraph model={model} />
              </div>
              <div>
                <div style={{fontWeight:800,marginBottom:6}}>Selected TO-BE workflow</div>
                <ProcessGraph model={applyDesignToModel(model,cmp.future_architecture,opt.results[0].best.design)} />
              </div>
            </div>
          }

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
                    true,
                    "relative"
                  ],
                  [
                    "Throughput / hr",
                    cmp.baseline_metrics.throughput_per_hour,
                    cmp.future_metrics.throughput_per_hour,
                    v => Number(v).toFixed(2),
                    false,
                    "relative"
                  ],
                  [
                    "Flow balance",
                    cmp.baseline_metrics.flow_balance,
                    cmp.future_metrics.flow_balance,
                    fmtFlow,
                    false,
                    "points"
                  ],
                  [
                    "P95 cycle (min)",
                    cmp.baseline_metrics.p95_cycle_minutes,
                    cmp.future_metrics.p95_cycle_minutes,
                    v => Number(v).toFixed(1),
                    true,
                    "relative"
                  ],
                  [
                    "SLA attainment",
                    cmp.baseline_metrics.sla_attainment,
                    cmp.future_metrics.sla_attainment,
                    fmtPct,
                    false,
                    "points"
                  ],
                  [
                    "Max utilization",
                    cmp.baseline_metrics.max_resource_utilization,
                    cmp.future_metrics.max_resource_utilization,
                    fmtPct,
                    true,
                    "points"
                  ],
                  [
                    "Backlog growth / hr",
                    cmp.baseline_metrics.backlog_growth_per_hour,
                    cmp.future_metrics.backlog_growth_per_hour,
                    v => Number(v).toFixed(2),
                    true,
                    "relative"
                  ]
                ].map(([label,a,b,fmt,lowerBetter,changeType]) => {
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
                        {changeType === "points"
                          ? fmtPctPoints(delta)
                          : pct === null
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
