"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

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

const METRICS = [
  ["throughput_per_hour","Throughput / hr"],
  ["flow_balance","Flow balance"],
  ["mean_cycle_minutes","Mean cycle (min)"],
  ["median_cycle_minutes","Median / P50 cycle (min)"],
  ["p95_cycle_minutes","P95 cycle (min)"],
  ["sla_attainment","SLA"],
  ["annual_cost","Annual cost"],
  ["max_resource_utilization","Max utilization"],
  ["backlog_growth_per_hour","Backlog growth / hr"]
];

function fmtMetric(name, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (name === "sla_attainment" || name === "flow_balance" || name === "max_resource_utilization") {
    return `${(100*n).toFixed(1)}%`;
  }
  if (name === "annual_cost") {
    return `$${Math.round(n).toLocaleString()}`;
  }
  if (name.includes("minutes")) {
    return `${n.toFixed(1)} min`;
  }
  return n.toFixed(2);
}

function stabilityLabel(v) {
  if (v >= 0.90) return "High";
  if (v >= 0.75) return "Moderate";
  return "Low";
}

function effectiveResourceCapacity(model, design, resource) {
  const generic = `resource_capacity__${resource.id}`;
  const legacy = `${resource.id}_capacity`;
  const value = design?.[generic] ?? design?.[legacy] ?? resource.capacity;
  return Math.max(1, Math.round(Number(value)));
}

function effectiveServiceMinutes(activity, design) {
  const automation = Number(design?.automation_level || 0);
  const mult = Math.max(0.30, 1 - 0.65 * automation);
  return Number(activity.service_time?.mean_minutes || 0) * mult;
}

function ProcessView({model,design}) {
  if (!model) return null;
  const archVar = (model.variables || []).find(v => v.name === "architecture");
  const archId = archVar?.value || model.architectures?.[0]?.id;
  const arch = model.architectures?.find(a => a.id === archId) || model.architectures?.[0];

  return (
    <div>
      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",
        gap:10
      }}>
        {(model.resources || []).map(r => (
          <div key={r.id} style={{...card,background:"#fafafa"}}>
            <div style={{fontSize:12,color:"#6b7280"}}>{r.name || r.id}</div>
            <div style={{fontSize:26,fontWeight:700,marginTop:5}}>
              {effectiveResourceCapacity(model,design,r)}
            </div>
            <div style={{fontSize:11,color:"#6b7280"}}>effective capacity</div>
          </div>
        ))}
      </div>

      <div style={{
        display:"flex",
        gap:8,
        flexWrap:"wrap",
        marginTop:14,
        alignItems:"center"
      }}>
        {(arch?.enabled_activities || []).map((id,idx) => {
          const a = (model.activities || []).find(x => x.id === id);
          if (!a) return null;
          return (
            <div key={id} style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{
                border:"1px solid #cbd5e1",
                borderRadius:10,
                padding:"10px 12px",
                minWidth:125,
                background:"#fff"
              }}>
                <b style={{fontSize:13}}>{a.name}</b>
                <div style={{fontSize:11,color:"#64748b",marginTop:3}}>
                  {effectiveServiceMinutes(a,design).toFixed(1)} min · {a.resource_pool || "no pool"}
                </div>
              </div>
              {idx < (arch.enabled_activities || []).length-1 &&
                <span style={{color:"#94a3b8"}}>→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ManualSVDPage() {
  const [model,setModel] = useState(null);
  const [design,setDesign] = useState({});
  const [architectureId,setArchitectureId] = useState("baseline");
  const [analysis,setAnalysis] = useState(null);
  const [history,setHistory] = useState([]);
  const [status,setStatus] = useState("Load the model and calculate the local SVD");
  const [busy,setBusy] = useState(false);
  const [replications,setReplications] = useState(5);
  const [cases,setCases] = useState(350);
  const [stepFraction,setStepFraction] = useState(0.25);
  const [selectedMetrics,setSelectedMetrics] = useState({
    throughput_per_hour:true,
    flow_balance:true,
    p95_cycle_minutes:true,
    sla_attainment:true,
    annual_cost:true,
    max_resource_utilization:true,
    backlog_growth_per_hour:false
  });

  const numericVars = useMemo(
    () => (model?.variables || []).filter(v => v.kind === "continuous" || v.kind === "quantized"),
    [model]
  );

  useEffect(() => {
    async function initialize() {
      try {
        let m = null;
        const saved = localStorage.getItem("pds_manual_model");
        if (saved) m = JSON.parse(saved);
        if (!m) {
          const r = await fetch(`${API}/api/demo/model`);
          m = await r.json();
        }
        setModel(m);
        const arch = (m.variables || []).find(v => v.name === "architecture")?.value
          || m.architectures?.[0]?.id
          || "baseline";
        setArchitectureId(arch);
        setDesign(Object.fromEntries(
          (m.variables || [])
            .filter(v => v.kind === "continuous" || v.kind === "quantized")
            .map(v => [v.name,Number(v.value)])
        ));
      } catch (e) {
        setStatus(e.message);
      }
    }
    initialize();
  }, []);

  async function call(path, body) {
    const r = await fetch(`${API}${path}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Request failed");
    return data;
  }

  async function calculateSvd(nextDesign=design, recordHistory=false) {
    if (!model) return;
    const metrics = METRICS.filter(([name]) => selectedMetrics[name]).map(([name]) => name);
    if (!metrics.length) {
      setStatus("Select at least one performance metric");
      return;
    }
    setBusy(true);
    setStatus("Running replicated simulations and estimating the local Jacobian...");
    try {
      const result = await call("/api/manual-svd/analyze",{
        model,
        architecture_id:architectureId,
        design:nextDesign,
        metrics,
        replications:Number(replications),
        cases:Number(cases),
        seed_start:3100
      });
      if (recordHistory && analysis) {
        setHistory(prev => [...prev,{
          iteration:prev.length,
          design:analysis.design,
          metrics:analysis.baseline_mean,
          singular_values:analysis.singular_values
        }]);
      }
      setDesign(result.design);
      setAnalysis(result);
      setStatus("SVD ready. Choose a mode and direction, then take another step.");
    } catch(e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function takeStep(mode, sign) {
    if (!analysis || !model) return;
    setBusy(true);
    setStatus(`Applying ${sign > 0 ? "+" : "−"} Mode ${mode.mode} and projecting to feasible design values...`);
    try {
      const stepped = await call("/api/manual-svd/step",{
        model,
        design,
        components:mode.components,
        step_fraction:Number(stepFraction) * sign
      });

      const changed = Object.keys(stepped.projected_design).some(
        k => Number(stepped.projected_design[k]) !== Number(design[k])
      );
      if (!changed) {
        setStatus("That step projects back to the current quantized design. Increase the step fraction or choose another mode.");
        return;
      }

      const previous = analysis;
      const next = await call("/api/manual-svd/analyze",{
        model,
        architecture_id:architectureId,
        design:stepped.projected_design,
        metrics:analysis.metric_names,
        replications:Number(replications),
        cases:Number(cases),
        seed_start:3100
      });

      setHistory(prev => [...prev,{
        iteration:prev.length,
        design:previous.design,
        metrics:previous.baseline_mean,
        singular_values:previous.singular_values,
        move:{
          mode:mode.mode,
          sign,
          step_fraction:Number(stepFraction),
          raw_design:stepped.raw_design,
          projected_design:stepped.projected_design
        }
      }]);
      setDesign(next.design);
      setAnalysis(next);
      setStatus("Step accepted. Metrics and the local SVD have been recomputed at the new stochastic design point.");
    } catch(e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  function undoStep() {
    if (!history.length) return;
    const last = history[history.length-1];
    setHistory(prev => prev.slice(0,-1));
    setDesign(last.design);
    calculateSvd(last.design,false);
  }

  function commitDesign() {
    if (!model || !analysis) return;
    const committedModel = {
      ...model,
      variables:(model.variables || []).map(v =>
        (v.kind === "continuous" || v.kind === "quantized") && design[v.name] !== undefined
          ? {...v,value:Number(design[v.name])}
          : v.name === "architecture"
            ? {...v,value:architectureId}
            : v
      )
    };
    const payload = {
      model:committedModel,
      architecture_id:architectureId,
      baseline_architecture_id:(model.variables || []).find(v => v.name === "architecture")?.value
        || model.architectures?.[0]?.id
        || architectureId,
      design,
      metrics:analysis.baseline_mean,
      history:[...history,{
        iteration:history.length,
        design,
        metrics:analysis.baseline_mean,
        singular_values:analysis.singular_values
      }],
      method:analysis.method,
      committed_at:new Date().toISOString()
    };
    localStorage.setItem("pds_committed_manual_design",JSON.stringify(payload));
    localStorage.setItem("pds_manual_model",JSON.stringify(committedModel));
    window.location.href = "/";
  }

  if (!model) {
    return <main style={{maxWidth:1180,margin:"0 auto",padding:30}}>Loading model...</main>;
  }

  return (
    <main style={{maxWidth:1180,margin:"0 auto",padding:"30px 22px 60px"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#4f46e5",letterSpacing:".08em"}}>
            HUMAN-IN-THE-LOOP DESIGN NAVIGATION
          </div>
          <h1 style={{fontSize:36,margin:"8px 0"}}>Manual SVD Explorer</h1>
          <p style={{maxWidth:880,color:"#4b5563",lineHeight:1.55}}>
            Estimate a replicated stochastic Jacobian with common random numbers, inspect its
            singular directions, move manually along a selected design mode, project the move
            onto allowable continuous/quantized values, and recompute the SVD at the new point.
          </p>
        </div>
        <a href="/" style={{color:"#4f46e5",fontWeight:700,textDecoration:"none"}}>← Automated optimizer</a>
      </div>

      <div style={{...card,marginTop:14,background:busy ? "#eef2ff" : "#fafafa"}}>
        <b>{busy ? "Working" : "Status"}</b>
        <div style={{fontSize:13,color:"#4b5563",marginTop:4}}>{status}</div>
      </div>

      <section style={{...card,marginTop:18}}>
        <h2 style={{marginTop:0}}>1. Stochastic SVD settings</h2>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"end"}}>
          <label style={{fontSize:13}}>Architecture<br/>
            <select value={architectureId} disabled={busy || !!history.length}
              onChange={e => {setArchitectureId(e.target.value);setAnalysis(null);setHistory([]);}}>
              {(model.architectures || []).map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </label>
          <label style={{fontSize:13}}>Replications<br/>
            <input type="number" min="2" max="20" value={replications} disabled={busy}
              onChange={e => setReplications(e.target.value)} style={{width:90}}/>
          </label>
          <label style={{fontSize:13}}>Cases / replication<br/>
            <input type="number" min="100" step="50" value={cases} disabled={busy}
              onChange={e => setCases(e.target.value)} style={{width:110}}/>
          </label>
          <label style={{fontSize:13}}>Mode step fraction<br/>
            <input type="number" min="0.01" max="2" step="0.05" value={stepFraction} disabled={busy}
              onChange={e => setStepFraction(e.target.value)} style={{width:100}}/>
          </label>
          <button style={buttonStyle} disabled={busy} onClick={() => calculateSvd()}>
            {analysis ? "Recalculate local SVD" : "Calculate local SVD"}
          </button>
          <button style={buttonStyle} disabled={busy || !history.length} onClick={undoStep}>Undo last step</button>
        </div>

        <div style={{marginTop:14,fontSize:13,color:"#4b5563"}}><b>Performance coordinates</b></div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:6}}>
          {METRICS.map(([name,label]) => (
            <label key={name} style={{fontSize:12}}>
              <input type="checkbox" checked={!!selectedMetrics[name]} disabled={busy || !!history.length}
                onChange={e => setSelectedMetrics(prev => ({...prev,[name]:e.target.checked}))}/>{" "}{label}
            </label>
          ))}
        </div>
      </section>

      <section style={{...card,marginTop:18}}>
        <h2 style={{marginTop:0}}>2. Current process design</h2>
        <ProcessView model={{...model,variables:(model.variables || []).map(v => v.name === "architecture" ? {...v,value:architectureId} : v)}} design={design}/>
        <div style={{overflowX:"auto",marginTop:14}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr><th align="left">Design variable</th><th align="right">Value</th><th align="left">Type</th><th align="left">Bounds</th></tr></thead>
            <tbody>{numericVars.map(v => (
              <tr key={v.name} style={{borderTop:"1px solid #e5e7eb"}}>
                <td style={{padding:"7px 4px"}}><b>{v.name}</b></td>
                <td align="right" style={{padding:"7px 4px"}}>{Number(design[v.name] ?? v.value).toFixed(3)}</td>
                <td style={{padding:"7px 4px"}}>{v.kind}</td>
                <td style={{padding:"7px 4px"}}>{v.lower} to {v.upper}{v.kind === "quantized" ? ` · step ${v.step}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {analysis && <>
        <section style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>3. Replicated performance at this design point</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
            {analysis.metric_names.map(name => (
              <div key={name} style={{...card,background:"#fafafa"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>{METRICS.find(x => x[0] === name)?.[1] || name}</div>
                <div style={{fontSize:23,fontWeight:700,marginTop:5}}>{fmtMetric(name,analysis.baseline_mean[name])}</div>
                <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>replication SD {fmtMetric(name,analysis.baseline_std[name])}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:"#6b7280",marginTop:10}}>
            {analysis.method.replications} common-random-number replications · {analysis.method.cases_per_replication} cases each · seed start {analysis.method.seed_start}
          </div>
        </section>

        <section style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>4. Local SVD design modes</h2>
          <p style={{fontSize:13,color:"#4b5563",lineHeight:1.5}}>
            The displayed vectors are right singular vectors of the normalized stochastic sensitivity matrix.
            Eigenvalue refers to the corresponding eigenvalue of JᵀJ (= σ²). Choose + or − to move along that mode;
            the resulting design is projected to allowable quantized values before the process is re-simulated.
          </p>

          {analysis.modes.map(mode => (
            <div key={mode.mode} style={{borderTop:"1px solid #e5e7eb",padding:"14px 0"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div>
                  <b>Mode {mode.mode}</b> · σ {mode.singular_value.toFixed(1)} · λ(JᵀJ) {mode.eigenvalue_jtj.toFixed(1)} · stability <b>{stabilityLabel(mode.stability)} ({mode.stability.toFixed(2)})</b>
                </div>
                <div style={{display:"flex",gap:7}}>
                  <button style={buttonStyle} disabled={busy} onClick={() => takeStep(mode,-1)}>Move −</button>
                  <button style={buttonStyle} disabled={busy} onClick={() => takeStep(mode,+1)}>Move +</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:6,marginTop:9}}>
                {Object.entries(mode.components).map(([name,value]) => (
                  <div key={name} style={{fontSize:12,color:"#4b5563"}}>
                    {name}: <b>{Number(value).toFixed(3)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>5. Iteration trail</h2>
          {history.length === 0
            ? <div style={{fontSize:13,color:"#6b7280"}}>No manual moves yet. The current design is iteration 0.</div>
            : history.map((h,i) => (
                <div key={i} style={{fontSize:12,borderTop:i ? "1px solid #eee" : "none",padding:"8px 0",color:"#4b5563"}}>
                  <b>Iteration {i}</b>{h.move ? ` → Mode ${h.move.mode} ${h.move.sign > 0 ? "+" : "−"}, step ${h.move.step_fraction}` : ""} · {Object.entries(h.metrics || {}).map(([k,v]) => `${k}=${fmtMetric(k,v)}`).join(" · ")}
                </div>
              ))}
        </section>

        <section style={{...card,marginTop:18,border:"1px solid #86efac",background:"#f0fdf4"}}>
          <h2 style={{marginTop:0}}>6. Commit this design</h2>
          <p style={{fontSize:13,color:"#166534",lineHeight:1.5}}>
            Commit stores this manual design as the TO-BE design and returns to the automated page.
            The main page will then use it for AS-IS vs TO-BE comparison. You can return here later and continue iterating.
          </p>
          <button style={{...buttonStyle,fontWeight:700}} disabled={busy} onClick={commitDesign}>Commit design to main workflow</button>
        </section>
      </>}
    </main>
  );
}
