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

const DEFAULT_STRUCTURAL_WEIGHTS = {
  work_type_entropy:1,
  routing_entropy:1,
  skill_entropy:1,
  activity_entropy:1,
  processing_entropy:0.5,
  fragmentation_penalty:0.5,
  capacity_imbalance_penalty:0.75,
  skill_duplication_penalty:0.5,
  pooling_loss_penalty:0.75,
  overflow_pressure_penalty:1
};

export default function CellularizationPage() {
  const [model,setModel] = useState(null);
  const [status,setStatus] = useState("Loading current process model");
  const [cells,setCells] = useState([]);
  const [cellStatus,setCellStatus] = useState("");
  const [experiment,setExperiment] = useState(null);
  const [experimentStatus,setExperimentStatus] = useState("");
  const [experimentBusy,setExperimentBusy] = useState(false);
  const [phase2Experiment,setPhase2Experiment] = useState(null);
  const [phase2Status,setPhase2Status] = useState("");
  const [phase2Busy,setPhase2Busy] = useState(false);
  const [overflowWaitThreshold,setOverflowWaitThreshold] = useState(30);
  const [maxOverflowPercent,setMaxOverflowPercent] = useState(100);
  const [phase3Experiment,setPhase3Experiment] = useState(null);
  const [phase3Status,setPhase3Status] = useState("");
  const [phase3Busy,setPhase3Busy] = useState(false);
  const [sensitivityResults,setSensitivityResults] = useState(null);
  const [sensitivityStatus,setSensitivityStatus] = useState("");
  const [sensitivityBusy,setSensitivityBusy] = useState(false);
  const [structuralAnalysis,setStructuralAnalysis] = useState(null);
  const [structuralStatus,setStructuralStatus] = useState("");
  const [structuralBusy,setStructuralBusy] = useState(false);
  const [structuralWeights,setStructuralWeights] = useState(DEFAULT_STRUCTURAL_WEIGHTS);
  const [candidateSet,setCandidateSet] = useState(null);
  const [candidateStatus,setCandidateStatus] = useState("");
  const [candidateBusy,setCandidateBusy] = useState(false);

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

  const phase1Ready = useMemo(() => {
    if (!model || !cells.length) return false;
    const activitiesValid = enabledActivities.every(a => (activityAssignments[a.id] || []).length === 1);
    const resourcesExact = (model.resources || []).every(r => (capacityUse[r.id] || 0) === Number(r.capacity || 0));
    return activitiesValid && resourcesExact;
  }, [model,cells,enabledActivities,activityAssignments,capacityUse]);

  const structuralReady = useMemo(() => {
    if (!model || !cells.length) return false;
    return enabledActivities.every(a => (activityAssignments[a.id] || []).length === 1);
  }, [model,cells,enabledActivities,activityAssignments]);

  const phase2Ready = useMemo(() => {
    return phase1Ready && cells.some(c => !!c.cross_cell_eligible);
  }, [phase1Ready,cells]);

  async function runStructuralAnalysis() {
    if (!model || !structuralReady || !activeArchitecture) return;
    setStructuralAnalysis(null);
    setStructuralBusy(true);
    setStructuralStatus("Analyzing structural coherence of the current cell design...");
    try {
      const analysisModel = {...model,cells};
      const r = await fetch(`${API}/api/cellularization/structural-analysis`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:analysisModel,
          architecture_id:activeArchitecture.id,
          weights:structuralWeights
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Structural analysis failed");
      setStructuralAnalysis(data);
      setStructuralStatus("Structural analysis complete. Lower score means structurally cleaner under the selected weights; simulation still determines operational value.");
    } catch (e) {
      setStructuralStatus(`Analysis error: ${e.message || e}`);
    } finally {
      setStructuralBusy(false);
    }
  }

  function setStructuralWeight(key,value) {
    const n = Math.max(0,Number(value) || 0);
    setStructuralWeights(prev => ({...prev,[key]:n}));
    setStructuralAnalysis(null);
    setStructuralStatus("Weights changed. Rerun structural analysis to update the score.");
  }

  async function generateCandidateCells() {
    if (!model || !activeArchitecture) return;
    setCandidateSet(null);
    setCandidateBusy(true);
    setCandidateStatus("Generating structurally coherent 2-cell and 3-cell candidates...");
    try {
      const r = await fetch(`${API}/api/cellularization/generate-candidates`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model,
          architecture_id:activeArchitecture.id,
          k_values:[2,3],
          weights:structuralWeights
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Candidate generation failed");
      setCandidateSet(data);
      setCandidateStatus(`Generated ${data.candidate_count || 0} distinct candidate design${Number(data.candidate_count || 0) === 1 ? "" : "s"}. No candidate is automatically recommended; inspect and simulate before judging performance.`);
      setTimeout(() => document.getElementById("candidate-cell-designs")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    } catch (e) {
      setCandidateStatus(`Candidate generation error: ${e.message || e}`);
    } finally {
      setCandidateBusy(false);
    }
  }

  function loadCandidateIntoEditor(candidate) {
    const loaded = (candidate?.cells || []).map((c,idx) => ({
      ...c,
      id:`cell_${Date.now()}_${idx+1}`,
      name:c.name || `Cell ${idx+1}`,
      cross_cell_eligible:false
    }));
    setCells(loaded);
    setStructuralAnalysis(null);
    setPhase2Experiment(null);
    setExperiment(null);
    setPhase3Experiment(null);
    setSensitivityResults(null);
    setCellStatus(`Loaded ${candidate.profile_label || candidate.id} (${candidate.k} cells) into the editable design. Review it, adjust if needed, then Save cell design before running experiments.`);
    setTimeout(() => document.getElementById("manual-cell-design")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  }

  async function runPhase2Experiment() {
    if (!model || !phase2Ready || !activeArchitecture) return;
    setPhase2Experiment(null);
    setPhase2Busy(true);
    setPhase2Status("Running paired Global vs Cellular vs Controlled Overflow experiment...");
    try {
      const experimentModel = {...model,cells};
      const r = await fetch(`${API}/api/experiments/cellularization/phase2`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:experimentModel,
          architecture_id:activeArchitecture.id,
          cases:1200,
          seed:900,
          replications:12,
          local_wait_threshold_minutes:Math.max(0,Number(overflowWaitThreshold) || 0),
          max_overflow_fraction:Math.min(1,Math.max(0,(Number(maxOverflowPercent) || 0)/100))
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Controlled-overflow experiment failed");
      setPhase2Experiment(data);
      setPhase2Status(`Completed ${data.replications || 0} paired replications.`);
      setTimeout(() => document.getElementById("phase2-results")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    } catch (e) {
      setPhase2Status(`Experiment error: ${e.message || e}`);
    } finally {
      setPhase2Busy(false);
    }
  }

  async function runOverflowSensitivity() {
    if (!model || !phase2Ready || !activeArchitecture) return;
    const thresholds = [0,15,30,60,120,1000000000];
    setSensitivityResults(null);
    setSensitivityBusy(true);
    setSensitivityStatus("Running overflow-threshold sensitivity...");
    try {
      const experimentModel = {...model,cells};
      const rows = [];
      for (let i=0;i<thresholds.length;i++) {
        const threshold = thresholds[i];
        const label = threshold >= 1000000000 ? "No overflow" : `${threshold} min`;
        setSensitivityStatus(`Running threshold ${label} (${i+1}/${thresholds.length})...`);
        const r = await fetch(`${API}/api/experiments/cellularization/phase2`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            model:experimentModel,
            architecture_id:activeArchitecture.id,
            cases:900,
            seed:1300,
            replications:8,
            local_wait_threshold_minutes:threshold,
            max_overflow_fraction:Math.min(1,Math.max(0,(Number(maxOverflowPercent) || 0)/100))
          })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || `Sensitivity run failed at ${label}`);
        rows.push({
          threshold_minutes:threshold,
          label,
          metrics:data.cellular_controlled_overflow?.metrics || {},
          overflow:data.overflow || {},
          replications:data.replications,
          cases_per_replication:data.cases_per_replication
        });
      }
      setSensitivityResults(rows);
      setSensitivityStatus(`Completed ${rows.length} thresholds using common seeds.`);
      setTimeout(() => document.getElementById("sensitivity-results")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    } catch (e) {
      setSensitivityStatus(`Experiment error: ${e.message || e}`);
    } finally {
      setSensitivityBusy(false);
    }
  }

  async function runPhase3Experiment() {
    if (!model || !phase2Ready || !activeArchitecture) return;
    setPhase3Experiment(null);
    setPhase3Busy(true);
    setPhase3Status("Running 3 × 2 operating-structure / scheduling matrix...");
    try {
      const experimentModel = {...model,cells};
      const r = await fetch(`${API}/api/experiments/cellularization/phase3`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:experimentModel,
          architecture_id:activeArchitecture.id,
          cases:800,
          seed:1100,
          replications:8,
          local_wait_threshold_minutes:Math.max(0,Number(overflowWaitThreshold) || 0),
          max_overflow_fraction:Math.min(1,Math.max(0,(Number(maxOverflowPercent) || 0)/100))
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Scheduling matrix experiment failed");
      setPhase3Experiment(data);
      setPhase3Status(`Completed ${data.replications || 0} paired replications across six scenarios.`);
      setTimeout(() => document.getElementById("phase3-results")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    } catch (e) {
      setPhase3Status(`Experiment error: ${e.message || e}`);
    } finally {
      setPhase3Busy(false);
    }
  }

  async function runPhase1Experiment() {
    if (!model || !phase1Ready || !activeArchitecture) return;
    setExperiment(null);
    setExperimentBusy(true);
    setExperimentStatus("Running paired Global vs Cellular / No Overflow experiment...");
    try {
      const experimentModel = {...model,cells};
      const r = await fetch(`${API}/api/experiments/cellularization/phase1`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:experimentModel,
          architecture_id:activeArchitecture.id,
          cases:1200,
          seed:700,
          replications:12
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Cellularization experiment failed");
      setExperiment(data);
      setExperimentStatus(`Completed ${data.replications || 0} paired replications.`);
      setTimeout(() => document.getElementById("phase1-results")?.scrollIntoView({behavior:"smooth",block:"start"}), 50);
    } catch (e) {
      setExperimentStatus(`Experiment error: ${e.message || e}`);
    } finally {
      setExperimentBusy(false);
    }
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

        <section id="manual-cell-design" style={{...card,marginTop:18}}>
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
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#475569",fontWeight:700}}>
                  <input type="checkbox" checked={!!cell.cross_cell_eligible} onChange={e => updateCell(cell.id,{cross_cell_eligible:e.target.checked})} />
                  May receive overflow
                </label>
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

        <section style={{...card,marginTop:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#4f46e5",textTransform:"uppercase",letterSpacing:".06em"}}>Decision support</div>
              <h2 style={{margin:"4px 0 5px"}}>Cell Structural Analysis</h2>
              <div style={muted}>Measures how much operational variety is localized by the current cell design. Entropy is a structural heuristic only; it does not replace simulation.</div>
            </div>
            <button
              onClick={runStructuralAnalysis}
              disabled={!structuralReady || structuralBusy}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #4f46e5",background:structuralReady && !structuralBusy?"#4f46e5":"#cbd5e1",color:"#fff",fontWeight:800,cursor:structuralReady && !structuralBusy?"pointer":"default"}}
            >
              {structuralBusy ? "Analyzing..." : "Analyze Current Cell Design"}
            </button>
          </div>

          {!structuralReady && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #fed7aa",background:"#fff7ed",borderRadius:9,fontSize:12,color:"#9a3412"}}>Assign every enabled activity to exactly one cell before running structural analysis. Resource allocation may still be edited; incomplete capacity will appear in the fit/penalty measures.</div>}

          <div style={{marginTop:16}}>
            <div style={{fontWeight:800,fontSize:13}}>Configurable structural weights</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:4}}>Weights change the decision-support score only. They do not change the cells or simulation. Set a weight to 0 to exclude that component.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:8,marginTop:10}}>
              {Object.entries({
                work_type_entropy:"Work-type entropy",
                routing_entropy:"Routing entropy",
                skill_entropy:"Skill entropy",
                activity_entropy:"Activity entropy",
                processing_entropy:"Processing entropy",
                fragmentation_penalty:"Fragmentation penalty",
                capacity_imbalance_penalty:"Capacity imbalance",
                skill_duplication_penalty:"Scarce-skill duplication",
                pooling_loss_penalty:"Pooling loss",
                overflow_pressure_penalty:"Overflow pressure"
              }).map(([key,label]) => <label key={key} style={{display:"block",fontSize:11,color:"#475569",fontWeight:800,padding:"9px 10px",border:"1px solid #e2e8f0",borderRadius:9,background:"#fff"}}>
                <span style={{display:"block",minHeight:15}}>{label}</span>
                <input type="number" min="0" step="0.25" value={structuralWeights[key]} onChange={e => setStructuralWeight(key,e.target.value)} style={{display:"block",width:"100%",marginTop:6,padding:"6px 7px",border:"1px solid #cbd5e1",borderRadius:7}} />
              </label>)}
            </div>
          </div>

          {structuralStatus && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:structuralStatus.startsWith("Analysis error")?"#b91c1c":"#475569"}}>{structuralStatus}</div>}

          {structuralAnalysis && <StructuralAnalysisPanel analysis={structuralAnalysis} />}
        </section>

        <section id="candidate-cell-designs" style={{...card,marginTop:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#7c3aed",textTransform:"uppercase",letterSpacing:".06em"}}>Stage 1 candidate generation</div>
              <h2 style={{margin:"4px 0 5px"}}>Generate alternative cell structures</h2>
              <div style={muted}>Creates structurally coherent 2-cell and 3-cell alternatives from routing, graph topology, processing-time similarity, and resource compatibility. This is decision support, not an automatic recommendation.</div>
            </div>
            <button
              onClick={generateCandidateCells}
              disabled={!model || !activeArchitecture || candidateBusy || enabledActivities.length < 2}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #7c3aed",background:(!candidateBusy && enabledActivities.length >= 2)?"#7c3aed":"#cbd5e1",color:"#fff",fontWeight:800,cursor:(!candidateBusy && enabledActivities.length >= 2)?"pointer":"default"}}
            >
              {candidateBusy ? "Generating candidates..." : "Generate 2-cell & 3-cell candidates"}
            </button>
          </div>

          <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #ddd6fe",background:"#f5f3ff",borderRadius:9,fontSize:12,color:"#5b21b6",lineHeight:1.5}}>
            Three similarity profiles are attempted for each cell count: balanced, routing/topology emphasis, and processing-character emphasis. Duplicate partitions are removed. Resource capacity is partitioned without duplication. Simulation is deliberately not run at this stage.
          </div>

          {candidateStatus && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:candidateStatus.startsWith("Candidate generation error")?"#b91c1c":"#475569"}}>{candidateStatus}</div>}
          {candidateSet?.candidates?.length > 0 && <CandidateDesignsPanel candidateSet={candidateSet} model={model} onLoad={loadCandidateIntoEditor} />}
        </section>

        <section style={{...card,marginTop:18,background:"#f8fafc"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <h2 style={{margin:"0 0 5px"}}>Phase 1 experiment — Global vs Cellular / No Overflow</h2>
              <div style={muted}>Uses the same process architecture, arrivals, service-time distributions, routing probabilities, total resource capacity, and common random-number seeds. Only resource pooling is changed.</div>
            </div>
            <button
              onClick={runPhase1Experiment}
              disabled={!phase1Ready || experimentBusy}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #4f46e5",background:phase1Ready && !experimentBusy?"#4f46e5":"#cbd5e1",color:"#fff",fontWeight:800,cursor:phase1Ready && !experimentBusy?"pointer":"default"}}
            >
              {experimentBusy ? "Running paired experiment..." : "Run Global vs Cellular / No Overflow"}
            </button>
          </div>

          {!phase1Ready && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #fed7aa",background:"#fff7ed",borderRadius:8,fontSize:12,color:"#9a3412"}}>Before running, every enabled activity must belong to exactly one cell and every resource pool must be partitioned exactly to its global baseline capacity.</div>}
          {experimentStatus && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:experimentStatus.startsWith("Experiment error")?"#b91c1c":"#475569"}}>{experimentStatus}</div>}

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10,marginTop:14}}>
            <Step n="1" title="Define cells" text="Assign activities and resource capacity manually." />
            <Step n="2" title="Global baseline" text="Run with globally pooled baseline resources." />
            <Step n="3" title="Cellular / no overflow" text="Partition the same capacity into exclusive local cell pools." />
            <Step n="4" title="Paired comparison" text="Use identical seeds so demand and service-time randomness are paired." />
          </div>
        </section>

        <section style={{...card,marginTop:18,background:"#f8fafc"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <h2 style={{margin:"0 0 5px"}}>Phase 2 experiment — Controlled Overflow</h2>
              <div style={muted}>Local cell capacity is always tried first. Cross-cell capacity is used only after the local wait exceeds the trigger, only into cells explicitly marked <b>May receive overflow</b>, and without creating any additional capacity.</div>
            </div>
            <button
              onClick={runPhase2Experiment}
              disabled={!phase2Ready || phase2Busy}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #0f766e",background:phase2Ready && !phase2Busy?"#0f766e":"#cbd5e1",color:"#fff",fontWeight:800,cursor:phase2Ready && !phase2Busy?"pointer":"default"}}
            >
              {phase2Busy ? "Running controlled overflow..." : "Run Controlled Overflow Comparison"}
            </button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,marginTop:14}}>
            <label style={{fontSize:12,fontWeight:700}}>Local wait trigger (minutes)
              <input type="number" min="0" step="1" value={overflowWaitThreshold} onChange={e => setOverflowWaitThreshold(e.target.value)} style={{display:"block",width:"100%",marginTop:5,padding:"7px 8px",border:"1px solid #cbd5e1",borderRadius:7}} />
            </label>
            <label style={{fontSize:12,fontWeight:700}}>Maximum overflow share (%)
              <input type="number" min="0" max="100" step="1" value={maxOverflowPercent} onChange={e => setMaxOverflowPercent(e.target.value)} style={{display:"block",width:"100%",marginTop:5,padding:"7px 8px",border:"1px solid #cbd5e1",borderRadius:7}} />
            </label>
          </div>

          {!phase2Ready && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #fed7aa",background:"#fff7ed",borderRadius:8,fontSize:12,color:"#9a3412"}}>Phase 2 requires a valid Phase 1 cell design and at least one cell marked <b>May receive overflow</b>.</div>}
          {phase2Status && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:phase2Status.startsWith("Experiment error")?"#b91c1c":"#475569"}}>{phase2Status}</div>}
        </section>

        <section style={{...card,marginTop:18,background:"#f8fafc"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <h2 style={{margin:"0 0 5px"}}>Phase 3 experiment — Scheduling Policy Matrix</h2>
              <div style={muted}>Compares FCFS with SLA-risk dispatching across Global, Cellular / No Overflow, and Cellular / Controlled Overflow. All six scenarios use the same generated case arrivals, routes, and sampled service times within each replication.</div>
            </div>
            <button
              onClick={runPhase3Experiment}
              disabled={!phase2Ready || phase3Busy}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #7c3aed",background:phase2Ready && !phase3Busy?"#7c3aed":"#cbd5e1",color:"#fff",fontWeight:800,cursor:phase2Ready && !phase3Busy?"pointer":"default"}}
            >
              {phase3Busy ? "Running scheduling matrix..." : "Run Scheduling Matrix"}
            </button>
          </div>
          <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #ddd6fe",background:"#f5f3ff",borderRadius:8,fontSize:12,color:"#5b21b6",lineHeight:1.55}}>
            <b>SLA-risk</b> dispatches the waiting job with the smallest projected slack: SLA due time minus current time minus remaining sampled processing time. Pure EDD is not shown separately because the current model uses the same SLA offset for all cases, so EDD largely collapses to arrival order.
          </div>
          {!phase2Ready && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #fed7aa",background:"#fff7ed",borderRadius:8,fontSize:12,color:"#9a3412"}}>Phase 3 requires the same valid cell design and overflow-receiver configuration as Phase 2.</div>}
          {phase3Status && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:phase3Status.startsWith("Experiment error")?"#b91c1c":"#475569"}}>{phase3Status}</div>}
        </section>

        <section style={{...card,marginTop:18,background:"#f8fafc"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div>
              <h2 style={{margin:"0 0 5px"}}>Overflow-threshold sensitivity</h2>
              <div style={muted}>Runs controlled overflow at 0, 15, 30, 60, 120 minutes and an effectively infinite threshold. Every threshold uses the same cases and random seeds, so differences isolate the overflow trigger.</div>
            </div>
            <button
              onClick={runOverflowSensitivity}
              disabled={!phase2Ready || sensitivityBusy}
              style={{padding:"10px 14px",borderRadius:8,border:"1px solid #0369a1",background:phase2Ready && !sensitivityBusy?"#0369a1":"#cbd5e1",color:"#fff",fontWeight:800,cursor:phase2Ready && !sensitivityBusy?"pointer":"default"}}
            >
              {sensitivityBusy ? "Running sensitivity..." : "Run Overflow Threshold Sensitivity"}
            </button>
          </div>
          <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #bae6fd",background:"#f0f9ff",borderRadius:8,fontSize:12,color:"#075985",lineHeight:1.55}}>
            The final row behaves as <b>no overflow</b>. The main decision signal is whether a threshold preserves most of the cycle-time/WIP benefit while keeping maximum resource utilization at or below about 95%.
          </div>
          {!phase2Ready && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #fed7aa",background:"#fff7ed",borderRadius:8,fontSize:12,color:"#9a3412"}}>Sensitivity requires the same valid cell design and overflow-receiver configuration as Phase 2.</div>}
          {sensitivityStatus && <div style={{marginTop:12,fontSize:12,fontWeight:700,color:sensitivityStatus.startsWith("Experiment error")?"#b91c1c":"#475569"}}>{sensitivityStatus}</div>}
        </section>

        {experiment && <section id="phase1-results" style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Phase 1 paired results</h2>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>
            {experiment.replications} replications · {experiment.cases_per_replication} cases per replication · cellular minus global deltas are based on paired common-random-number runs.
          </div>
          <ComparisonTable experiment={experiment} />
        </section>}

        {phase2Experiment && <section id="phase2-results" style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Phase 2 controlled-overflow results</h2>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12,lineHeight:1.55}}>
            {phase2Experiment.replications} replications · {phase2Experiment.cases_per_replication} cases per replication · trigger {fmtNum(phase2Experiment.overflow_policy?.local_wait_threshold_minutes,2)} min · max overflow {fmtPct(phase2Experiment.overflow_policy?.max_overflow_fraction)}.
          </div>
          <Phase2ComparisonTable experiment={phase2Experiment} />
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:14}}>
            <Summary label="Mean overflow share" value={fmtPct(phase2Experiment.overflow?.mean_fraction)} />
            <Summary label="Mean overflow count" value={fmtNum(phase2Experiment.overflow?.mean_count,2)} />
            <Summary label="Mean wait saved / overflow" value={`${fmtNum(phase2Experiment.overflow?.mean_wait_saved_minutes,2)} min`} />
          </div>
        </section>}

        {structuralAnalysis && phase2Experiment && <section id="structure-performance-interpretation" style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Structure ↔ performance interpretation</h2>
          <div style={{fontSize:12,color:"#64748b",lineHeight:1.55,marginBottom:14}}>
            Connects structural coherence with the paired simulation results. These statements describe patterns in the current model; they do not treat the structural score as an operational optimum or claim causality.
          </div>
          <StructurePerformanceInterpretation analysis={structuralAnalysis} experiment={phase2Experiment} />
        </section>}

        {phase3Experiment && <section id="phase3-results" style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Phase 3 scheduling-policy matrix</h2>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12,lineHeight:1.55}}>
            {phase3Experiment.replications} replications · {phase3Experiment.cases_per_replication} cases per replication · common arrivals, routes, and sampled service times across all six scenarios.
          </div>
          <SchedulingMatrixTable experiment={phase3Experiment} />
          <div style={{marginTop:14,padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:10,background:"#f8fafc",fontSize:12,color:"#475569",lineHeight:1.55}}>
            {phase3Experiment.note}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:14}}>
            <Summary label="Overflow share · FCFS" value={fmtPct(phase3Experiment.overflow?.fcfs_mean_fraction)} />
            <Summary label="Overflow share · SLA-risk" value={fmtPct(phase3Experiment.overflow?.sla_risk_mean_fraction)} />
          </div>
        </section>}

        {sensitivityResults && <section id="sensitivity-results" style={{...card,marginTop:18}}>
          <h2 style={{marginTop:0}}>Overflow-threshold sensitivity results</h2>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12,lineHeight:1.55}}>
            {sensitivityResults[0]?.replications || 0} replications · {sensitivityResults[0]?.cases_per_replication || 0} cases per replication · identical seeds across thresholds · maximum overflow share {fmtNum(Number(maxOverflowPercent),2)}%.
          </div>
          <OverflowSensitivityTable rows={sensitivityResults} />
        </section>}
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

function fmtNum(v,digits=2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(/\.?0+$/,"");
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${fmtNum(100*n,2)}%` : "—";
}

function StructuralAnalysisPanel({analysis}) {
  const entropy = analysis?.entropy || {};
  const penalties = analysis?.penalties || {};
  const score = analysis?.score || {};
  const route = analysis?.routing_localization || {};
  const fit = analysis?.resource_fit || {};
  const balance = analysis?.balance || {};
  const entropyRows = [
    ["Work type","work_type"],
    ["Routing / next activity","routing"],
    ["Skill requirement","skill"],
    ["Activity pattern","activity"],
    ["Processing class","processing"]
  ];
  const finite = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  const pct = v => finite(v) ? `${fmtNum(100*Number(v),2)}%` : "N/A";
  return <div style={{marginTop:16}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
      <Summary label="Decision-support score" value={finite(score.decision_support_score)?fmtNum(score.decision_support_score,2):"N/A"} />
      <Summary label="Structural complexity" value={finite(score.weighted_structural_complexity)?fmtNum(score.weighted_structural_complexity,3):"N/A"} />
      <Summary label="Cross-cell routing" value={pct(route.cross_cell_transition_fraction)} />
      <Summary label="Skill coverage" value={pct(fit.skill_coverage_fraction)} />
      <Summary label="Workload imbalance CV" value={fmtNum(balance.workload_cv,3)} />
      <Summary label="Small cells" value={`${balance.small_cell_count ?? 0} / ${analysis.cell_count ?? 0}`} />
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(360px,1fr))",gap:14,marginTop:14}}>
      <div style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
        <div style={{fontWeight:800,fontSize:13}}>Conditional entropy by cell</div>
        <div style={{fontSize:11,color:"#64748b",marginTop:4}}>Lower normalized conditional entropy means more of that variety is localized inside cells. N/A means the current model does not contain enough information for that dimension.</div>
        <div style={{overflowX:"auto",marginTop:8}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr><th align="left" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Dimension</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>H global</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>H | Cell</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Reduction</th></tr></thead>
            <tbody>{entropyRows.map(([label,key]) => { const x=entropy[key] || {}; return <tr key={key}>
              <td style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{label}</td>
              <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9"}}>{finite(x.global_entropy_bits)?fmtNum(x.global_entropy_bits,3):"N/A"}</td>
              <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9"}}>{finite(x.conditional_entropy_bits)?fmtNum(x.conditional_entropy_bits,3):"N/A"}</td>
              <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9",fontWeight:800}}>{pct(x.entropy_reduction_fraction)}</td>
            </tr>; })}</tbody>
          </table>
        </div>
      </div>

      <div style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
        <div style={{fontWeight:800,fontSize:13}}>Structural penalties / tradeoffs</div>
        <div style={{fontSize:11,color:"#64748b",marginTop:4}}>These prevent a low-entropy design from being treated as automatically good. Values are normalized proxies from 0 to 1.</div>
        <div style={{display:"grid",gap:7,marginTop:10}}>
          {[
            ["Fragmentation",penalties.fragmentation_penalty],
            ["Capacity imbalance",penalties.capacity_imbalance_penalty],
            ["Scarce-skill duplication",penalties.skill_duplication_penalty],
            ["Pooling loss",penalties.pooling_loss_penalty],
            ["Expected overflow pressure",penalties.overflow_pressure_penalty]
          ].map(([label,value]) => <div key={label} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",fontSize:12}}><span>{label}</span><b>{fmtNum(value,3)}</b></div>)}
        </div>
      </div>
    </div>

    {Array.isArray(balance.cells) && balance.cells.length > 0 && <div style={{marginTop:14,overflowX:"auto"}}>
      <div style={{fontWeight:800,fontSize:13,marginBottom:6}}>Cell load / capacity structure</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:720}}>
        <thead><tr><th align="left" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Cell</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Activities</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Expected service demand min/hr</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Assigned capacity min/hr</th><th align="right" style={{padding:"6px 4px",borderBottom:"1px solid #e2e8f0"}}>Structural utilization proxy</th></tr></thead>
        <tbody>{balance.cells.map(c => <tr key={c.cell_id}>
          <td style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{c.cell_name || c.cell_id}</td>
          <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9"}}>{c.activity_count}</td>
          <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9"}}>{fmtNum(c.expected_service_demand_minutes_per_hour,2)}</td>
          <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9"}}>{fmtNum(c.assigned_capacity_minutes_per_hour,2)}</td>
          <td align="right" style={{padding:"6px 4px",borderBottom:"1px solid #f1f5f9",fontWeight:800}}>{pct(c.structural_utilization_proxy)}</td>
        </tr>)}</tbody>
      </table>
    </div>}

    {Array.isArray(analysis.notes) && analysis.notes.length > 0 && <div style={{marginTop:12,padding:"10px 12px",border:"1px solid #dbeafe",background:"#eff6ff",borderRadius:10,fontSize:11,color:"#1e3a8a",lineHeight:1.55}}>
      {analysis.notes.map((n,i) => <div key={i}>{i+1}. {n}</div>)}
    </div>}
  </div>;
}


function CandidateDesignsPanel({candidateSet,model,onLoad}) {
  const finite = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  const candidates = candidateSet?.candidates || [];
  const byK = [...new Set(candidates.map(c => c.k))].sort((a,b) => a-b);
  const activityName = id => (model?.activities || []).find(a => a.id === id)?.name || id;
  const resourceName = id => (model?.resources || []).find(r => r.id === id)?.name || id;

  return <div style={{marginTop:16}}>
    {byK.map(k => <div key={k} style={{marginTop:14}}>
      <div style={{fontWeight:900,fontSize:14,color:"#334155"}}>{k}-cell alternatives</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12,marginTop:8}}>
        {candidates.filter(c => c.k === k).map(c => {
          const a = c.structural_analysis || {};
          const score = a.score?.decision_support_score;
          const cross = a.routing_localization?.cross_cell_transition_fraction;
          const cv = a.balance?.workload_cv;
          const coverage = a.resource_fit?.skill_coverage_fraction;
          return <div key={c.id} style={{border:"1px solid #ddd6fe",borderRadius:12,padding:14,background:"#fafafa"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:11,fontWeight:900,color:"#7c3aed",textTransform:"uppercase"}}>{c.profile_label}</div>
                <div style={{fontSize:18,fontWeight:900,marginTop:3}}>{k} cells</div>
              </div>
              <button onClick={() => onLoad(c)} style={{padding:"7px 9px",borderRadius:7,border:"1px solid #7c3aed",background:"#fff",color:"#6d28d9",fontWeight:800,cursor:"pointer"}}>Load into editor</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:7,marginTop:10}}>
              <MiniStat label="Structural score" value={finite(score)?fmtNum(score,2):"N/A"} />
              <MiniStat label="Cross-cell routing" value={finite(cross)?fmtPct(cross):"N/A"} />
              <MiniStat label="Workload CV" value={finite(cv)?fmtNum(cv,3):"N/A"} />
              <MiniStat label="Skill coverage" value={finite(coverage)?fmtPct(coverage):"N/A"} />
            </div>

            <div style={{marginTop:10,display:"grid",gap:8}}>
              {(c.cells || []).map((cell,idx) => <div key={cell.id} style={{padding:"9px 10px",border:"1px solid #e2e8f0",borderRadius:9,background:"#fff"}}>
                <div style={{fontSize:12,fontWeight:900}}>Cell {idx+1}</div>
                <div style={{fontSize:11,color:"#475569",marginTop:4,lineHeight:1.45}}><b>Activities:</b> {(cell.activity_ids || []).map(activityName).join(", ") || "—"}</div>
                <div style={{fontSize:11,color:"#475569",marginTop:3,lineHeight:1.45}}><b>Resources:</b> {Object.entries(cell.resource_capacities || {}).filter(([,v]) => Number(v) > 0).map(([rid,v]) => `${resourceName(rid)}×${v}`).join(", ") || "—"}</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:5,lineHeight:1.45}}>{c.explanations?.[idx]?.text}</div>
              </div>)}
            </div>

            <div style={{fontSize:10,color:"#64748b",marginTop:9}}>Similarity mix: routing {fmtPct(c.similarity_weights?.routing)} · topology {fmtPct(c.similarity_weights?.topology)} · processing {fmtPct(c.similarity_weights?.processing)} · resource {fmtPct(c.similarity_weights?.resource)}</div>
          </div>;
        })}
      </div>
    </div>)}
    <div style={{marginTop:12,fontSize:11,color:"#64748b",lineHeight:1.5}}>These alternatives are not ranked as operational winners. Load any candidate into the editor, modify it if desired, then use the existing structural analysis and paired simulation experiments to evaluate it.</div>
  </div>;
}

function MiniStat({label,value}) {
  return <div style={{padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff"}}><div style={{fontSize:10,color:"#64748b"}}>{label}</div><div style={{fontSize:13,fontWeight:900,marginTop:2}}>{value}</div></div>;
}

function StructurePerformanceInterpretation({analysis,experiment}) {
  const g = experiment?.global?.metrics || {};
  const n = experiment?.cellular_no_overflow?.metrics || {};
  const c = experiment?.cellular_controlled_overflow?.metrics || {};
  const route = analysis?.routing_localization || {};
  const balance = analysis?.balance || {};
  const fit = analysis?.resource_fit || {};
  const penalties = analysis?.penalties || {};
  const entropy = analysis?.entropy || {};

  const finite = v => Number.isFinite(Number(v));
  const rel = (a,b) => finite(a) && finite(b) && Number(b) !== 0 ? (Number(a)-Number(b))/Math.abs(Number(b)) : null;
  const reduction = (from,to) => finite(from) && finite(to) && Number(from) !== 0 ? (Number(from)-Number(to))/Math.abs(Number(from)) : null;
  const pp = (a,b) => finite(a) && finite(b) ? Number(a)-Number(b) : null;

  const cross = Number(route.cross_cell_transition_fraction);
  const cv = Number(balance.workload_cv);
  const coverage = Number(fit.skill_coverage_fraction);
  const poolingLoss = Number(penalties.pooling_loss_penalty);
  const overflowShare = Number(experiment?.overflow?.mean_fraction);

  const controlledVsGlobalThroughput = rel(c.throughput_per_hour,g.throughput_per_hour);
  const controlledVsGlobalCycle = reduction(g.mean_cycle_minutes,c.mean_cycle_minutes);
  const controlledVsGlobalP95 = reduction(g.p95_cycle_minutes,c.p95_cycle_minutes);
  const controlledVsGlobalWip = reduction(g.avg_wip,c.avg_wip);
  const controlledVsGlobalBacklog = reduction(g.backlog_growth_per_hour,c.backlog_growth_per_hour);
  const controlledVsGlobalUtil = pp(c.max_resource_utilization,g.max_resource_utilization);
  const controlledVsNoCycle = reduction(n.mean_cycle_minutes,c.mean_cycle_minutes);
  const noVsGlobalCycle = reduction(g.mean_cycle_minutes,n.mean_cycle_minutes);
  const noVsGlobalThroughput = rel(n.throughput_per_hour,g.throughput_per_hour);

  const entropyReductions = ["routing","activity","processing","work_type","skill"]
    .map(k => Number(entropy?.[k]?.entropy_reduction_fraction))
    .filter(Number.isFinite);
  const avgEntropyReduction = entropyReductions.length ? entropyReductions.reduce((a,b)=>a+b,0)/entropyReductions.length : null;

  const strictCellsWorse = (finite(noVsGlobalCycle) && noVsGlobalCycle < -0.05) || (finite(noVsGlobalThroughput) && noVsGlobalThroughput < -0.05);
  const controlledBeatsGlobal = (finite(controlledVsGlobalCycle) && controlledVsGlobalCycle > 0.05) && (finite(controlledVsGlobalThroughput) && controlledVsGlobalThroughput > 0);
  const complementarity = strictCellsWorse && controlledBeatsGlobal;

  const structuralSignals = [];
  if (finite(cv)) structuralSignals.push(cv <= 0.10
    ? `Workload is very well balanced across cells (CV ${fmtNum(cv,3)}).`
    : cv <= 0.25
      ? `Workload balance is moderate across cells (CV ${fmtNum(cv,3)}).`
      : `Workload is materially imbalanced across cells (CV ${fmtNum(cv,3)}).`);
  if (finite(coverage)) structuralSignals.push(coverage >= 0.95
    ? `Skill coverage is effectively complete (${fmtPct(coverage)}).`
    : `Skill coverage is incomplete (${fmtPct(coverage)}), which can constrain otherwise coherent cells.`);
  if (finite(cross)) structuralSignals.push(cross >= 0.40
    ? `Cross-cell routing is high (${fmtPct(cross)}), so the process topology is not strongly isolated by the current cell boundary.`
    : cross >= 0.20
      ? `Cross-cell routing is moderate (${fmtPct(cross)}).`
      : `Cross-cell routing is relatively low (${fmtPct(cross)}), indicating strong routing localization.`);
  if (finite(avgEntropyReduction)) structuralSignals.push(`Average entropy reduction across available structural dimensions is ${fmtPct(avgEntropyReduction)}.`);
  if (finite(poolingLoss) && poolingLoss >= 0.75) structuralSignals.push(`The structural pooling-loss proxy is high (${fmtNum(poolingLoss,2)}), so strict cellularization gives up much of the original shared-capacity flexibility.`);

  const operationalSignals = [];
  if (finite(controlledVsGlobalThroughput)) operationalSignals.push(`Controlled overflow changes throughput versus global pooling by ${signedPct(controlledVsGlobalThroughput)}.`);
  if (finite(controlledVsGlobalCycle)) operationalSignals.push(`Controlled overflow changes mean cycle time versus global pooling by ${signedReduction(controlledVsGlobalCycle)}.`);
  if (finite(controlledVsGlobalP95)) operationalSignals.push(`P95 cycle time changes versus global pooling by ${signedReduction(controlledVsGlobalP95)}.`);
  if (finite(controlledVsGlobalWip)) operationalSignals.push(`Average WIP changes versus global pooling by ${signedReduction(controlledVsGlobalWip)}.`);
  if (finite(controlledVsGlobalBacklog)) operationalSignals.push(`Backlog growth changes versus global pooling by ${signedReduction(controlledVsGlobalBacklog)}.`);
  if (finite(controlledVsGlobalUtil)) operationalSignals.push(`Maximum resource utilization moves by ${signedPp(controlledVsGlobalUtil)} versus global pooling.`);
  if (finite(overflowShare)) operationalSignals.push(`The realized overflow share is ${fmtPct(overflowShare)}.`);

  let headline = "Structure and simulation show a mixed tradeoff.";
  let explanation = "The structural metrics and operational metrics should be read together rather than collapsed into one score.";
  if (complementarity) {
    headline = "Local structure and selective pooling appear complementary in this design.";
    explanation = "Strict cells lose too much pooling and perform worse than global pooling, while controlled overflow recovers flexibility and then outperforms global pooling on the paired throughput/cycle-time test. That pattern is consistent with protected local capacity plus selective cross-cell sharing creating value beyond either extreme alone.";
  } else if (controlledBeatsGlobal) {
    headline = "Controlled overflow outperforms global pooling in the current paired simulation.";
    explanation = "The current cell structure is operationally useful despite its structural penalties. This is evidence that a slightly less 'clean' structural design can perform better when it preserves the right local structure and uses overflow selectively.";
  } else if (strictCellsWorse && finite(controlledVsNoCycle) && controlledVsNoCycle > 0.10) {
    headline = "The cells need flexibility to recover from fragmentation.";
    explanation = "Strict cellularization performs poorly, but controlled overflow recovers a substantial part of the lost performance. The main mechanism appears to be restoration of selective pooling rather than cell structure alone.";
  }

  const caveats = [];
  if (finite(c.max_resource_utilization) && Number(c.max_resource_utilization) > 0.95) caveats.push(`Controlled overflow is running at ${fmtPct(c.max_resource_utilization)} maximum utilization, above the 95% screening level. Performance gains should therefore be checked for robustness under demand/capacity sensitivity.`);
  if (finite(c.sla_attainment) && Number(c.sla_attainment) < 0.50) caveats.push(`SLA attainment remains low (${fmtPct(c.sla_attainment)}), so the operating structure may be better than the alternatives while the overall system is still capacity constrained.`);
  if (!finite(entropy?.work_type?.entropy_reduction_fraction)) caveats.push("Work-type entropy is unavailable, so form-function alignment at the transaction-family level is not yet being measured directly.");
  if (!finite(entropy?.skill?.entropy_reduction_fraction)) caveats.push("Skill entropy is unavailable, so skill-demand localization is not yet part of this interpretation.");

  return <div>
    <div style={{padding:"14px 16px",border:"1px solid #bbf7d0",background:"#f0fdf4",borderRadius:12,color:"#166534",lineHeight:1.55}}>
      <div style={{fontWeight:900,fontSize:15}}>{headline}</div>
      <div style={{fontSize:12,marginTop:5}}>{explanation}</div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:14,marginTop:14}}>
      <div style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
        <div style={{fontWeight:800,fontSize:13}}>Structural evidence</div>
        <div style={{display:"grid",gap:8,marginTop:10}}>{structuralSignals.map((x,i)=><div key={i} style={{fontSize:12,color:"#475569",lineHeight:1.5}}>• {x}</div>)}</div>
      </div>
      <div style={{padding:14,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}>
        <div style={{fontWeight:800,fontSize:13}}>Operational evidence</div>
        <div style={{display:"grid",gap:8,marginTop:10}}>{operationalSignals.map((x,i)=><div key={i} style={{fontSize:12,color:"#475569",lineHeight:1.5}}>• {x}</div>)}</div>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:14}}>
      <Summary label="Controlled vs global throughput" value={finite(controlledVsGlobalThroughput)?signedPct(controlledVsGlobalThroughput):"N/A"} />
      <Summary label="Controlled vs global mean cycle" value={finite(controlledVsGlobalCycle)?signedReduction(controlledVsGlobalCycle):"N/A"} />
      <Summary label="Controlled vs no-overflow mean cycle" value={finite(controlledVsNoCycle)?signedReduction(controlledVsNoCycle):"N/A"} />
      <Summary label="Controlled max utilization" value={finite(c.max_resource_utilization)?fmtPct(c.max_resource_utilization):"N/A"} />
    </div>

    {caveats.length > 0 && <div style={{marginTop:14,padding:"11px 13px",border:"1px solid #fde68a",background:"#fffbeb",borderRadius:10,fontSize:11,color:"#92400e",lineHeight:1.55}}>
      <b>Interpretation limits</b>
      {caveats.map((x,i)=><div key={i} style={{marginTop:5}}>{i+1}. {x}</div>)}
    </div>}
  </div>;
}

function signedPct(v) {
  const n=Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n>0?"+":""}${fmtNum(100*n,2)}%`;
}

function signedReduction(v) {
  const n=Number(v);
  if (!Number.isFinite(n)) return "N/A";
  if (n > 0) return `${fmtNum(100*n,2)}% lower`;
  if (n < 0) return `${fmtNum(100*Math.abs(n),2)}% higher`;
  return "no change";
}

function signedPp(v) {
  const n=Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n>0?"+":""}${fmtNum(100*n,2)} pp`;
}

function ComparisonTable({experiment}) {
  const g = experiment?.global?.metrics || {};
  const c = experiment?.cellular_no_overflow?.metrics || {};
  const d = experiment?.paired_delta_cellular_minus_global?.mean || {};
  const rows = [
    ["Throughput / hr","throughput_per_hour","num"],
    ["Mean cycle (min)","mean_cycle_minutes","num"],
    ["Median cycle (min)","median_cycle_minutes","num"],
    ["P95 cycle (min)","p95_cycle_minutes","num"],
    ["SLA attainment","sla_attainment","pct"],
    ["Average WIP","avg_wip","num"],
    ["Max resource utilization","max_resource_utilization","pct"],
    ["Backlog growth / hr","backlog_growth_per_hour","num"],
    ["Annual cost","annual_cost","money"]
  ];
  const show = (v,type) => type === "pct" ? fmtPct(v) : type === "money" ? (Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}` : "—") : fmtNum(v,2);
  const showDelta = (v,type) => {
    const n=Number(v);
    if (!Number.isFinite(n)) return "—";
    const sign=n>0?"+":"";
    if (type === "pct") return `${sign}${fmtNum(100*n,2)} pp`;
    if (type === "money") return `${sign}$${Math.round(n).toLocaleString()}`;
    return `${sign}${fmtNum(n,2)}`;
  };
  return <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr><th align="left" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Metric</th><th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Global pooling</th><th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Cellular / no overflow</th><th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Cellular − Global</th></tr></thead>
      <tbody>{rows.map(([label,key,type]) => <tr key={key}>
        <td style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{label}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(g[key],type)}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(c[key],type)}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{showDelta(d[key],type)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Phase2ComparisonTable({experiment}) {
  const g = experiment?.global?.metrics || {};
  const n = experiment?.cellular_no_overflow?.metrics || {};
  const c = experiment?.cellular_controlled_overflow?.metrics || {};
  const d = experiment?.paired_delta_controlled_minus_no_overflow?.mean || {};
  const rows = [
    ["Throughput / hr","throughput_per_hour","num"],
    ["Mean cycle (min)","mean_cycle_minutes","num"],
    ["Median cycle (min)","median_cycle_minutes","num"],
    ["P95 cycle (min)","p95_cycle_minutes","num"],
    ["SLA attainment","sla_attainment","pct"],
    ["Average WIP","avg_wip","num"],
    ["Max resource utilization","max_resource_utilization","pct"],
    ["Backlog growth / hr","backlog_growth_per_hour","num"],
    ["Annual cost","annual_cost","money"]
  ];
  const show = (v,type) => type === "pct" ? fmtPct(v) : type === "money" ? (Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}` : "—") : fmtNum(v,2);
  const showDelta = (v,type) => {
    const x=Number(v);
    if (!Number.isFinite(x)) return "—";
    const sign=x>0?"+":"";
    if (type === "pct") return `${sign}${fmtNum(100*x,2)} pp`;
    if (type === "money") return `${sign}$${Math.round(x).toLocaleString()}`;
    return `${sign}${fmtNum(x,2)}`;
  };
  return <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr>
        <th align="left" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Metric</th>
        <th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Global</th>
        <th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Cellular / no overflow</th>
        <th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Controlled overflow</th>
        <th align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Controlled − No overflow</th>
      </tr></thead>
      <tbody>{rows.map(([label,key,type]) => <tr key={key}>
        <td style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{label}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(g[key],type)}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(n[key],type)}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(c[key],type)}</td>
        <td align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:700}}>{showDelta(d[key],type)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function OverflowSensitivityTable({rows}) {
  const valid = Array.isArray(rows) ? rows : [];
  const under95 = valid.filter(r => Number(r.metrics?.max_resource_utilization) <= 0.95);
  const preferred = (under95.length ? under95 : valid).reduce((best,r) => {
    if (!best) return r;
    return Number(r.metrics?.mean_cycle_minutes) < Number(best.metrics?.mean_cycle_minutes) ? r : best;
  },null);
  const metrics = [
    ["Throughput / hr","throughput_per_hour","num"],
    ["Mean cycle (min)","mean_cycle_minutes","num"],
    ["P95 cycle (min)","p95_cycle_minutes","num"],
    ["Average WIP","avg_wip","num"],
    ["Backlog growth / hr","backlog_growth_per_hour","num"],
    ["Max utilization","max_resource_utilization","pct"],
    ["Overflow share","overflow_fraction","pct"]
  ];
  const val=(r,key)=>key==="overflow_fraction" ? r.overflow?.mean_fraction : r.metrics?.[key];
  const show=(v,type)=>type==="pct"?fmtPct(v):fmtNum(v,2);
  return <div>
    {preferred && <div style={{marginBottom:12,padding:"10px 12px",border:"1px solid #bbf7d0",background:"#f0fdf4",borderRadius:10,fontSize:12,color:"#166534",lineHeight:1.55}}>
      <b>Best threshold under the 95% utilization screen:</b> {preferred.label}. {under95.length ? "Selected by lowest mean cycle time among thresholds at or below 95% max utilization." : "No tested threshold stayed at or below 95%; showing the lowest mean-cycle threshold overall."}
    </div>}
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
        <thead><tr>
          <th align="left" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Threshold</th>
          {metrics.map(([label,key]) => <th key={key} align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{label}</th>)}
        </tr></thead>
        <tbody>{valid.map(r => {
          const isPreferred = preferred && r.threshold_minutes === preferred.threshold_minutes;
          return <tr key={r.threshold_minutes} style={{background:isPreferred?"#f0fdf4":"transparent"}}>
            <td style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:800}}>{r.label}{isPreferred?" · preferred":""}</td>
            {metrics.map(([_,key,type]) => <td key={key} align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:key==="max_resource_utilization" && Number(val(r,key))>0.95?800:400,color:key==="max_resource_utilization" && Number(val(r,key))>0.95?"#b91c1c":"inherit"}}>{show(val(r,key),type)}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function SchedulingMatrixTable({experiment}) {
  const m = experiment?.matrix || {};
  const scenarios = [
    ["Global · FCFS","global_fcfs"],
    ["Global · SLA-risk","global_sla_risk"],
    ["Cellular no overflow · FCFS","cellular_no_overflow_fcfs"],
    ["Cellular no overflow · SLA-risk","cellular_no_overflow_sla_risk"],
    ["Controlled overflow · FCFS","cellular_controlled_overflow_fcfs"],
    ["Controlled overflow · SLA-risk","cellular_controlled_overflow_sla_risk"]
  ];
  const rows = [
    ["Mean cycle (min)","mean_cycle_minutes","num"],
    ["Median cycle (min)","median_cycle_minutes","num"],
    ["P95 cycle (min)","p95_cycle_minutes","num"],
    ["Mean wait (min)","mean_wait_minutes","num"],
    ["Throughput / hr","throughput_per_hour","num"],
    ["SLA attainment","sla_attainment","pct"],
    ["Average WIP","avg_wip","num"],
    ["Max utilization","max_resource_utilization","pct"],
    ["Backlog growth / hr","backlog_growth_per_hour","num"],
    ["Annual cost","annual_cost","money"]
  ];
  const show=(v,type)=>type==="pct"?fmtPct(v):type==="money"?(Number.isFinite(Number(v))?`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}`:"—"):fmtNum(v,2);
  return <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
      <thead><tr>
        <th align="left" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0"}}>Scenario</th>
        {rows.map(([label,key]) => <th key={key} align="right" style={{padding:"8px 6px",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{label}</th>)}
      </tr></thead>
      <tbody>{scenarios.map(([label,key]) => { const x=m?.[key]?.metrics || {}; return <tr key={key}>
        <td style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9",fontWeight:800,whiteSpace:"nowrap"}}>{label}</td>
        {rows.map(([_,metric,type]) => <td key={metric} align="right" style={{padding:"8px 6px",borderBottom:"1px solid #f1f5f9"}}>{show(x[metric],type)}</td>)}
      </tr>; })}</tbody>
    </table>
  </div>;
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
