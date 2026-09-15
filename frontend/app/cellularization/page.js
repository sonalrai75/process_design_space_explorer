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

const muted = {color:"#64748b",lineHeight:1.5};

export default function CellularizationPage() {
  const [model,setModel] = useState(null);
  const [status,setStatus] = useState("Loading current process model");
  const [cells,setCells] = useState([]);
  const [cellStatus,setCellStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const saved = localStorage.getItem("pds_cellularization_model");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!cancelled) {
            setModel(parsed);
            const savedCells = localStorage.getItem("pds_cellularization_cells");
            if (!savedCells && Array.isArray(parsed.cells)) setCells(parsed.cells);
            setStatus("Current workspace model loaded");
          }
          return;
        }

        const r = await fetch(`${API}/api/demo/model`);
        if (!r.ok) throw new Error("No workspace model is available");
        const data = await r.json();
        if (!cancelled) {
          setModel(data);
          const savedCells = localStorage.getItem("pds_cellularization_cells");
          if (!savedCells && Array.isArray(data.cells)) setCells(data.cells);
          setStatus("Demo model loaded because no workspace model was saved");
        }
      } catch (e) {
        if (!cancelled) setStatus(e.message || "Unable to load model");
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pds_cellularization_cells");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCells(parsed);
      }
    } catch (_) {}
  }, []);

  const activeArchitecture = useMemo(() => {
    if (!model) return null;
    const archVar = (model.variables || []).find(v => v.name === "architecture");
    const id = archVar?.value || model.architectures?.[0]?.id;
    return (model.architectures || []).find(a => a.id === id) || model.architectures?.[0] || null;
  }, [model]);

  const enabledActivities = useMemo(() => {
    if (!model) return [];
    const ids = new Set(activeArchitecture?.enabled_activities || (model.activities || []).map(a => a.id));
    return (model.activities || []).filter(a => ids.has(a.id));
  }, [model,activeArchitecture]);

  const capacityUse = useMemo(() => {
    const out = {};
    for (const r of (model?.resources || [])) out[r.id] = 0;
    for (const c of cells) {
      for (const [rid,val] of Object.entries(c.resource_capacities || {})) {
        out[rid] = (out[rid] || 0) + Math.max(0,Number(val) || 0);
      }
    }
    return out;
  }, [cells,model]);

  const activityAssignments = useMemo(() => {
    const out = {};
    for (const c of cells) for (const aid of (c.activity_ids || [])) {
      if (!out[aid]) out[aid] = [];
      out[aid].push(c.id);
    }
    return out;
  }, [cells]);

  function addCell() {
    const id = `cell_${Date.now()}`;
    setCells(prev => [...prev,{id,name:`Cell ${prev.length+1}`,activity_ids:[],resource_capacities:{},preferred_work_types:[],cross_cell_eligible:false}]);
    setCellStatus("");
  }

  function removeCell(id) {
    setCells(prev => prev.filter(c => c.id !== id));
    setCellStatus("");
  }

  function updateCell(id,patch) {
    setCells(prev => prev.map(c => c.id === id ? {...c,...patch} : c));
    setCellStatus("");
  }

  function toggleActivity(cellId,activityId) {
    setCells(prev => prev.map(c => {
      if (c.id !== cellId) return c;
      const set = new Set(c.activity_ids || []);
      if (set.has(activityId)) set.delete(activityId); else set.add(activityId);
      return {...c,activity_ids:[...set]};
    }));
    setCellStatus("");
  }

  function setCellCapacity(cellId,resourceId,value) {
    const baseline = Number((model?.resources || []).find(r => r.id === resourceId)?.capacity || 0);
    const requested = Math.max(0,Math.floor(Number(value) || 0));

    setCells(prev => {
      const allocatedElsewhere = prev
        .filter(c => c.id !== cellId)
        .reduce((sum,c) => sum + Math.max(0,Number(c.resource_capacities?.[resourceId]) || 0),0);
      const availableForThisCell = Math.max(0,baseline - allocatedElsewhere);
      const n = Math.min(requested,availableForThisCell);

      return prev.map(c => c.id === cellId ? {
        ...c,
        resource_capacities:{...(c.resource_capacities || {}),[resourceId]:n}
      } : c);
    });
    setCellStatus("");
  }

  function saveCells() {
    const over = (model?.resources || []).filter(r => (capacityUse[r.id] || 0) > Number(r.capacity || 0));
    if (over.length) {
      setCellStatus(`Cannot save: allocated capacity exceeds baseline for ${over.map(r => r.name || r.id).join(", ")}.`);
      return;
    }
    const nextModel = {...model,cells};
    setModel(nextModel);
    localStorage.setItem("pds_cellularization_cells",JSON.stringify(cells));
    localStorage.setItem("pds_cellularization_model",JSON.stringify(nextModel));
    setCellStatus(`Saved ${cells.length} cell definition${cells.length === 1 ? "" : "s"} into the current model.`);
  }

  return (
    <main style={{maxWidth:1180,margin:"0 auto",padding:"28px 20px 60px",fontFamily:"Arial, Helvetica, sans-serif",color:"#0f172a"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:"#4f46e5"}}>
            Process Design Space Explorer
          </div>
          <h1 style={{margin:"6px 0 4px"}}>Cellularization &amp; Scheduling</h1>
          <div style={muted}>Design and compare operating structures without changing the underlying process architecture.</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <a href="/" style={{padding:"8px 11px",borderRadius:8,border:"1px solid #cbd5e1",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Workspace</a>
          <a href="/manual-svd" style={{padding:"8px 11px",borderRadius:8,border:"1px solid #cbd5e1",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Manual SVD</a>
        </div>
      </div>

      <div style={{marginTop:12,fontSize:13,color:"#64748b"}}>Status: {status}</div>

      {model && <>
        <section style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Current model</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
            <Summary label="Process" value={model.name || model.id} />
            <Summary label="Workflow class" value={model.workflow_class || "general"} />
            <Summary label="Process architecture" value={activeArchitecture?.name || activeArchitecture?.id || "—"} />
            <Summary label="Activities" value={enabledActivities.length} />
            <Summary label="Resource pools" value={(model.resources || []).length} />
            <Summary label="Individual resources" value={(model.agents || []).length} />
          </div>
        </section>

        <section style={{...card,marginTop:18}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <h2 style={{margin:"0 0 5px"}}>Phase 1 — Manual cell design</h2>
              <div style={muted}>Define cells without changing the underlying process architecture or service-time models.</div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={addCell} style={{padding:"9px 12px",borderRadius:8,border:"1px solid #cbd5e1",background:"#fff",fontWeight:800,cursor:"pointer"}}>Add cell</button>
              <button onClick={saveCells} disabled={!cells.length} style={{padding:"9px 12px",borderRadius:8,border:"1px solid #4f46e5",background:cells.length?"#4f46e5":"#cbd5e1",color:"#fff",fontWeight:800,cursor:cells.length?"pointer":"default"}}>Save cell design</button>
            </div>
          </div>

          {cellStatus && <div style={{marginTop:10,fontSize:12,color:cellStatus.startsWith("Cannot")?"#b91c1c":"#166534",fontWeight:700}}>{cellStatus}</div>}

          {!cells.length && <div style={{marginTop:16,padding:16,border:"1px dashed #cbd5e1",borderRadius:12,color:"#64748b",fontSize:13}}>No cells defined yet. Click <b>Add cell</b> to begin.</div>}

          {cells.map((cell,idx) => (
            <div key={cell.id} style={{...card,boxShadow:"none",background:"#f8fafc",marginTop:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:260}}>
                  <div style={{fontSize:11,fontWeight:800,color:"#4f46e5"}}>CELL {idx+1}</div>
                  <input value={cell.name || ""} onChange={e => updateCell(cell.id,{name:e.target.value})} style={{flex:1,minWidth:160,padding:"7px 9px",border:"1px solid #cbd5e1",borderRadius:7,fontWeight:700}} />
                </div>
                <button onClick={() => removeCell(cell.id)} style={{padding:"7px 10px",borderRadius:7,border:"1px solid #fecaca",background:"#fff",color:"#b91c1c",fontWeight:700,cursor:"pointer"}}>Remove</button>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:14,marginTop:14}}>
                <div>
                  <div style={{fontWeight:800,fontSize:13}}>Activities in this cell</div>
                  <div style={{fontSize:11,color:"#64748b",margin:"4px 0 8px"}}>Activities may temporarily appear in more than one cell while designing. Ambiguities are shown below.</div>
                  <div style={{display:"grid",gap:6,maxHeight:270,overflow:"auto",paddingRight:4}}>
                    {enabledActivities.map(a => {
                      const checked = (cell.activity_ids || []).includes(a.id);
                      const count = (activityAssignments[a.id] || []).length;
                      return <label key={a.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff"}}>
                        <input type="checkbox" checked={checked} onChange={() => toggleActivity(cell.id,a.id)} />
                        <span style={{flex:1}}>{a.name || a.id}</span>
                        {count > 1 && <span style={{fontSize:10,color:"#b45309",fontWeight:800}}>MULTI-CELL</span>}
                      </label>;
                    })}
                  </div>
                </div>

                <div>
                  <div style={{fontWeight:800,fontSize:13}}>Resource capacity assigned</div>
                  <div style={{fontSize:11,color:"#64748b",margin:"4px 0 8px"}}>Resource capacity is exclusive in Phase 1. Capacity assigned to one cell is immediately removed from what other cells can claim. Total cell capacity must equal the global baseline before comparison.</div>
                  <div style={{display:"grid",gap:7}}>
                    {(model.resources || []).map(r => {
                      const used = capacityUse[r.id] || 0;
                      const cap = Number(r.capacity || 0);
                      const current = Math.max(0,Number(cell.resource_capacities?.[r.id]) || 0);
                      const usedElsewhere = Math.max(0,used - current);
                      const maxForThisCell = Math.max(0,cap - usedElsewhere);
                      const remaining = Math.max(0,cap - used);
                      return <div key={r.id} style={{display:"grid",gridTemplateColumns:"1fr 85px 150px",gap:8,alignItems:"center",fontSize:12,padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff"}}>
                        <span>{r.name || r.id}</span>
                        <input type="number" min="0" max={maxForThisCell} step="1" value={current} onChange={e => setCellCapacity(cell.id,r.id,e.target.value)} style={{width:"100%",padding:"5px 6px",border:"1px solid #cbd5e1",borderRadius:6}} />
                        <span style={{textAlign:"right",color:"#64748b",fontWeight:600}}>{used} / {cap} allocated · {remaining} free</span>
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {cells.length > 0 && <div style={{marginTop:14,padding:"12px 14px",border:"1px solid #e2e8f0",borderRadius:10,background:"#fff"}}>
            <div style={{fontWeight:800,fontSize:13}}>Design validation</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:6,lineHeight:1.55}}>
              Activities unassigned: <b>{enabledActivities.filter(a => !(activityAssignments[a.id] || []).length).length}</b> · Activities assigned to multiple cells: <b>{enabledActivities.filter(a => (activityAssignments[a.id] || []).length > 1).length}</b> · Resource pools with exact baseline allocation: <b>{(model.resources || []).filter(r => (capacityUse[r.id] || 0) === Number(r.capacity || 0)).length}/{(model.resources || []).length}</b>.
            </div>
          </div>}
        </section>

        <section style={{...card,marginTop:18,background:"#f8fafc"}}>
          <h2 style={{marginTop:0}}>Planned experiment sequence</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10}}>
            <Step n="1" title="Define cells" text="Assign activities and resource capacity manually." />
            <Step n="2" title="Global baseline" text="Use the current globally pooled operating structure." />
            <Step n="3" title="Cellular / no overflow" text="Restrict eligible work to the defined local cells." />
            <Step n="4" title="Paired comparison" text="Compare both structures with common random numbers." />
          </div>
        </section>
      </>}
    </main>
  );
}

function Summary({label,value}) {
  return (
    <div style={{padding:"12px 14px",border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
      <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",fontWeight:800}}>{label}</div>
      <div style={{fontSize:18,fontWeight:800,marginTop:5}}>{String(value ?? "—")}</div>
    </div>
  );
}

function Step({n,title,text}) {
  return (
    <div style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#fff"}}>
      <div style={{fontSize:11,fontWeight:800,color:"#4f46e5"}}>STEP {n}</div>
      <div style={{fontWeight:800,marginTop:4}}>{title}</div>
      <div style={{fontSize:12,color:"#64748b",lineHeight:1.45,marginTop:5}}>{text}</div>
    </div>
  );
}
