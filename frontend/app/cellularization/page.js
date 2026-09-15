"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

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

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(100*n).toFixed(1)}%` : "—";
}

function fmtMin(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function activeArchitecture(model) {
  if (!model) return null;
  const requested = (model.variables || []).find(v => v.name === "architecture")?.value;
  return (model.architectures || []).find(a => a.id === requested)
    || (model.architectures || [])[0]
    || null;
}

export default function CellularizationPage() {
  const [model,setModel] = useState(null);
  const [status,setStatus] = useState("Loading current process model...");
  const [busy,setBusy] = useState(false);
  const [cellExperiment,setCellExperiment] = useState(null);
  const [experimentCases,setExperimentCases] = useState(900);
  const [experimentReplications,setExperimentReplications] = useState(8);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pds_cellular_model");
      if (!raw) {
        setStatus("No current process model was passed from the Process Flow Explorer.");
        return;
      }
      const loaded = JSON.parse(raw);
      setModel(loaded);
      setStatus("Ready");
    } catch (e) {
      setStatus(e.message || "Unable to load the current process model");
    }
  }, []);

  useEffect(() => {
    if (!model) return;
    localStorage.setItem("pds_cellular_model", JSON.stringify(model));
  }, [model]);

  const resourceAllocation = useMemo(() => {
    const out = {};
    for (const r of model?.resources || []) {
      out[r.id] = (model?.cells || []).reduce(
        (sum,c) => sum + Number(c.resource_capacities?.[r.id] || 0), 0
      );
    }
    return out;
  }, [model]);

  async function call(path, body) {
    setBusy(true);
    try {
      const r = await fetch(`${API}${path}`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Request failed");
      return data;
    } finally {
      setBusy(false);
    }
  }

  function addCell() {
    if (!model) return;
    const index = (model.cells || []).length + 1;
    let id = `cell_${index}`;
    let suffix = index;
    while ((model.cells || []).some(c => c.id === id)) {
      suffix += 1;
      id = `cell_${suffix}`;
    }
    const nextCell = {
      id,
      name:`Cell ${suffix}`,
      activity_ids:[],
      resource_ids:[],
      resource_capacities:{},
      preferred_work_types:[],
      capacity_limit:null,
      cross_cell_eligible:false
    };
    setModel(prev => ({
      ...prev,
      cells:[...(prev?.cells || []),nextCell],
      work_types:(prev?.work_types || []).length
        ? prev.work_types
        : [{id:"default",name:"Default work",probability:1,preferred_cell_id:id}]
    }));
    setCellExperiment(null);
  }

  function updateCell(cellId, field, value) {
    setModel(prev => ({
      ...prev,
      cells:(prev?.cells || []).map(c => c.id === cellId ? {...c,[field]:value} : c)
    }));
    setCellExperiment(null);
  }

  function updateCellResourceAllocation(cellId, resourceId, value) {
    const allocation = Math.max(0, Math.floor(Number(value) || 0));
    setModel(prev => ({
      ...prev,
      cells:(prev?.cells || []).map(c => {
        if (c.id !== cellId) return c;
        const nextCaps = {...(c.resource_capacities || {})};
        if (allocation > 0) nextCaps[resourceId] = allocation;
        else delete nextCaps[resourceId];
        const nextIds = allocation > 0
          ? Array.from(new Set([...(c.resource_ids || []),resourceId]))
          : (c.resource_ids || []).filter(x => x !== resourceId);
        return {...c,resource_ids:nextIds,resource_capacities:nextCaps};
      })
    }));
    setCellExperiment(null);
  }

  function toggleCellItem(cellId, field, value) {
    setModel(prev => ({
      ...prev,
      cells:(prev?.cells || []).map(c => {
        if (c.id !== cellId) return c;
        const current = Array.isArray(c[field]) ? c[field] : [];
        return {...c,[field]:current.includes(value) ? current.filter(x => x !== value) : [...current,value]};
      })
    }));
    setCellExperiment(null);
  }

  function removeCell(cellId) {
    setModel(prev => ({
      ...prev,
      cells:(prev?.cells || []).filter(c => c.id !== cellId),
      work_types:(prev?.work_types || []).map(w =>
        w.preferred_cell_id === cellId ? {...w,preferred_cell_id:null} : w
      )
    }));
    setCellExperiment(null);
  }

  function addWorkType() {
    if (!model) return;
    const index = (model.work_types || []).length + 1;
    setModel(prev => ({
      ...prev,
      work_types:[...(prev?.work_types || []),{
        id:`work_${index}`,
        name:`Work Type ${index}`,
        probability:1,
        preferred_cell_id:(prev?.cells || [])[0]?.id || null
      }]
    }));
    setCellExperiment(null);
  }

  function updateWorkType(workId, field, value) {
    setModel(prev => ({
      ...prev,
      work_types:(prev?.work_types || []).map(w =>
        w.id === workId ? {...w,[field]:field === "probability" ? Number(value) : value} : w
      )
    }));
    setCellExperiment(null);
  }

  function removeWorkType(workId) {
    setModel(prev => ({
      ...prev,
      work_types:(prev?.work_types || []).filter(w => w.id !== workId)
    }));
    setCellExperiment(null);
  }

  async function runExperiment() {
    try {
      if (!model) return;
      setStatus("Running paired Global vs Cellular experiment...");
      const arch = activeArchitecture(model);
      const result = await call("/api/experiments/cellularization/phase1", {
        model,
        architecture_id:arch?.id || "baseline",
        design:{},
        cases:Number(experimentCases),
        replications:Number(experimentReplications),
        seed_start:4200
      });
      setCellExperiment(result);
      setStatus(result?.ok === false ? "Resolve the cell-definition issues shown below." : "Experiment complete.");
    } catch(e) {
      setStatus(e.message || "Experiment failed");
    }
  }

  function clearCellDesign() {
    setModel(prev => ({...prev,cells:[],work_types:[]}));
    setCellExperiment(null);
    setStatus("Cell design cleared. The underlying process model was not changed.");
  }

  return <main style={{minHeight:"100vh",background:"#f8fafc",color:"#0f172a",fontFamily:"Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"}}>
    <div style={{maxWidth:1180,margin:"0 auto",padding:"28px 18px 60px"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:"#6366f1",marginBottom:5}}>Process Design Space Explorer</div>
          <h1 style={{margin:0,fontSize:30,letterSpacing:"-.025em"}}>Cellularization & Scheduling Experiments</h1>
          <p style={{margin:"7px 0 0",color:"#64748b",maxWidth:800,lineHeight:1.5}}>Use the same process model, demand, service-time distributions, resources, skills and routing logic while changing only the operating structure. Phase 1 compares Global Pooling + FCFS with Cellular / No Overflow + FCFS.</p>
        </div>
        <button style={buttonStyle} onClick={() => { window.location.href="/"; }}>← Process Flow Explorer</button>
      </div>

      <section style={card}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>Current model</div>
        {model ? <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
          <div><b>{model.name || model.id || "Process model"}</b><div style={{fontSize:11,color:"#64748b"}}>Model</div></div>
          <div><b>{(model.activities || []).length}</b><div style={{fontSize:11,color:"#64748b"}}>Activities</div></div>
          <div><b>{(model.resources || []).length}</b><div style={{fontSize:11,color:"#64748b"}}>Resource pools</div></div>
          <div><b>{(model.cells || []).length}</b><div style={{fontSize:11,color:"#64748b"}}>Cells defined</div></div>
        </div> : <div style={{color:"#92400e"}}>Open this page from a loaded model in the Process Flow Explorer.</div>}
        <div style={{marginTop:10,fontSize:12,color:status === "Ready" ? "#64748b" : "#475569"}}>{status}</div>
      </section>

      <section style={{...card,marginTop:18}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>1 · Cell Design</div>
            <h2 style={{margin:"0 0 6px",fontSize:21}}>Define cells manually</h2>
            <p style={{margin:0,color:"#4b5563",lineHeight:1.5,maxWidth:760}}>Assign activities and portions of existing resource-pool capacity to each cell. Skills remain governed by the existing skill matrix.</p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button disabled={!model || busy} style={{...buttonStyle,opacity:!model || busy ? .55 : 1}} onClick={addCell}>+ Create cell</button>
            <button disabled={!model || busy || !(model?.cells || []).length} style={{...buttonStyle,opacity:!model || busy || !(model?.cells || []).length ? .55 : 1}} onClick={clearCellDesign}>Clear design</button>
          </div>
        </div>

        {(model?.cells || []).map(cell => <div key={cell.id} style={{border:"1px solid #e2e8f0",borderRadius:14,padding:14,marginTop:12,background:"#fbfdff"}}>
          <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
            <label style={{fontSize:11,color:"#64748b"}}>Cell ID<input value={cell.id} readOnly style={{display:"block",marginTop:4,width:130,background:"#f8fafc"}} /></label>
            <label style={{fontSize:11,color:"#64748b",flex:"1 1 180px"}}>Cell name<input value={cell.name || ""} onChange={e => updateCell(cell.id,"name",e.target.value)} style={{display:"block",marginTop:4,width:"100%"}} /></label>
            <label style={{fontSize:11,color:"#64748b"}}>Optional capacity limit<input type="number" min="1" value={cell.capacity_limit ?? ""} onChange={e => updateCell(cell.id,"capacity_limit",e.target.value === "" ? null : Number(e.target.value))} style={{display:"block",marginTop:4,width:130}} /></label>
            <button style={buttonStyle} onClick={() => removeCell(cell.id)}>Remove</button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginTop:12}}>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:"#334155",marginBottom:6}}>Activities assigned to this cell</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{(model?.activities || []).map(a => <label key={a.id} style={{fontSize:12,border:"1px solid #e2e8f0",padding:"5px 7px",borderRadius:8,background:"#fff"}}><input type="checkbox" checked={(cell.activity_ids || []).includes(a.id)} onChange={() => toggleCellItem(cell.id,"activity_ids",a.id)} /> {a.name}</label>)}</div>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:"#334155",marginBottom:6}}>Resource capacity assigned to this cell</div>
              <div style={{display:"grid",gap:6}}>{(model?.resources || []).map(r => {
                const allocated = Number(resourceAllocation[r.id] || 0);
                const total = Number(r.capacity || 0);
                return <label key={r.id} style={{fontSize:12,border:"1px solid #e2e8f0",padding:"6px 8px",borderRadius:8,background:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <span>{r.name || r.id} <span style={{color:allocated === total ? "#64748b" : "#b45309"}}>(allocated {allocated}/{total})</span></span>
                  <input type="number" min="0" max={r.capacity} step="1" value={cell.resource_capacities?.[r.id] ?? 0} onChange={e => updateCellResourceAllocation(cell.id,r.id,e.target.value)} style={{width:70}} />
                </label>;
              })}</div>
              <div style={{fontSize:10,color:"#64748b",marginTop:5}}>For a like-for-like comparison, allocations across cells must equal each existing resource pool's total capacity.</div>
            </div>
          </div>
        </div>)}
      </section>

      <section style={{...card,marginTop:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>2 · Work Assignment</div>
            <h2 style={{margin:"0 0 4px",fontSize:21}}>Work types → preferred cell</h2>
            <div style={{fontSize:12,color:"#64748b"}}>Global pooling ignores preferred cell. Cellular / No Overflow uses it as a hard localization rule.</div>
          </div>
          <button disabled={!model || !(model?.cells || []).length} style={{...buttonStyle,opacity:!model || !(model?.cells || []).length ? .55 : 1}} onClick={addWorkType}>+ Add work type</button>
        </div>
        <div style={{overflowX:"auto",marginTop:10}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr><th align="left" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Work type</th><th align="left" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Mix weight</th><th align="left" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Preferred cell</th><th style={{borderBottom:"1px solid #e2e8f0"}} /></tr></thead>
          <tbody>{(model?.work_types || []).map(w => <tr key={w.id}><td style={{padding:6}}><input value={w.name || ""} onChange={e => updateWorkType(w.id,"name",e.target.value)} /></td><td style={{padding:6}}><input type="number" min="0" step="0.01" value={w.probability ?? 1} onChange={e => updateWorkType(w.id,"probability",e.target.value)} style={{width:90}} /></td><td style={{padding:6}}><select value={w.preferred_cell_id || ""} onChange={e => updateWorkType(w.id,"preferred_cell_id",e.target.value || null)}><option value="">Select cell...</option>{(model?.cells || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td><td style={{padding:6}}><button style={buttonStyle} onClick={() => removeWorkType(w.id)}>Remove</button></td></tr>)}</tbody>
        </table></div>
      </section>

      <section style={{...card,marginTop:18}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:"#6366f1",marginBottom:6}}>3 · Phase 1 Experiment</div>
        <h2 style={{margin:"0 0 6px",fontSize:21}}>Global Pooling vs Cellular / No Overflow</h2>
        <p style={{margin:"0 0 12px",color:"#4b5563",lineHeight:1.5}}>Both scenarios use FCFS and paired random seeds. Only resource localization changes.</p>
        <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
          <label style={{fontSize:11,color:"#64748b"}}>Cases / replication<input type="number" min="100" step="100" value={experimentCases} onChange={e => setExperimentCases(e.target.value)} style={{display:"block",marginTop:4,width:120}} /></label>
          <label style={{fontSize:11,color:"#64748b"}}>Replications<input type="number" min="2" max="50" value={experimentReplications} onChange={e => setExperimentReplications(e.target.value)} style={{display:"block",marginTop:4,width:100}} /></label>
          <button disabled={busy || !model || !(model?.cells || []).length} style={{...primaryButtonStyle,opacity:busy || !model || !(model?.cells || []).length ? .55 : 1}} onClick={runExperiment}>{busy ? "Experiment running..." : "Run Global vs Cell experiment"}</button>
        </div>

        {cellExperiment?.ok === false && <div style={{marginTop:14,padding:12,border:"1px solid #fecaca",borderRadius:10,background:"#fef2f2",color:"#991b1b",fontSize:12}}><b>Resolve these cell-definition issues:</b><ul style={{margin:"7px 0 0",paddingLeft:20}}>{(cellExperiment.validation_errors || []).map((e,i) => <li key={i}>{e}</li>)}</ul></div>}

        {cellExperiment?.ok && <div style={{marginTop:16}}>
          <div style={{fontSize:12,color:"#475569",marginBottom:8}}>Paired experiment · same seeds in both scenarios · FCFS only in Phase 1</div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr><th align="left" style={{padding:7,borderBottom:"1px solid #cbd5e1"}}>Metric</th>{(cellExperiment.scenarios || []).map(sc => <th key={sc.id} align="right" style={{padding:7,borderBottom:"1px solid #cbd5e1"}}>{sc.name}</th>)}</tr></thead>
            <tbody>{[
              ["Mean cycle (min)","mean_cycle_minutes","min"],
              ["Median cycle (min)","median_cycle_minutes","min"],
              ["P95 cycle (min)","p95_cycle_minutes","min"],
              ["Mean waiting (min)","mean_wait_minutes","min"],
              ["Average WIP","avg_wip","num"],
              ["Throughput / hr","throughput_per_hour","num"],
              ["SLA attainment","sla_attainment","pct"],
              ["Max resource utilization","max_resource_utilization","pct"]
            ].map(([label,key,type]) => <tr key={key}><td style={{padding:7,borderBottom:"1px solid #f1f5f9"}}>{label}</td>{(cellExperiment.scenarios || []).map(sc => { const v=sc.metrics?.[key]; return <td key={sc.id} align="right" style={{padding:7,borderBottom:"1px solid #f1f5f9",fontVariantNumeric:"tabular-nums"}}>{type === "pct" ? fmtPct(v) : type === "min" ? fmtMin(v) : Number(v ?? 0).toFixed(2)}</td>; })}</tr>)}
            <tr><td style={{padding:7}}>Bottleneck resource</td>{(cellExperiment.scenarios || []).map(sc => <td key={sc.id} align="right" style={{padding:7}}>{sc.bottleneck_resource || "—"}</td>)}</tr>
            <tr><td style={{padding:7}}>Bottleneck cell</td>{(cellExperiment.scenarios || []).map(sc => <td key={sc.id} align="right" style={{padding:7}}>{sc.bottleneck_cell || "—"}</td>)}</tr></tbody>
          </table></div>

          {(model?.cells || []).length > 0 && <div style={{marginTop:12,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr><th align="left" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Cell</th><th align="right" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Scenario</th><th align="right" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Utilization</th><th align="right" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Mean wait</th><th align="right" style={{padding:6,borderBottom:"1px solid #e2e8f0"}}>Avg queue</th></tr></thead>
            <tbody>{(cellExperiment.scenarios || []).flatMap(sc => (model.cells || []).map(c => <tr key={`${sc.id}-${c.id}`}><td style={{padding:6}}>{c.name}</td><td align="right" style={{padding:6}}>{sc.name}</td><td align="right" style={{padding:6}}>{fmtPct(sc.cell_utilization?.[c.id] ?? 0)}</td><td align="right" style={{padding:6}}>{fmtMin(sc.cell_mean_wait_minutes?.[c.id] ?? 0)}</td><td align="right" style={{padding:6}}>{Number(sc.cell_avg_queue_length?.[c.id] ?? 0).toFixed(2)}</td></tr>))}</tbody>
          </table></div>}
        </div>}
      </section>
    </div>
  </main>;
}
