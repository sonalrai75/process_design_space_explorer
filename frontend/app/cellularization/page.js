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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const saved = localStorage.getItem("pds_cellularization_model");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!cancelled) {
            setModel(parsed);
            setStatus("Current workspace model loaded");
          }
          return;
        }

        const r = await fetch(`${API}/api/demo/model`);
        if (!r.ok) throw new Error("No workspace model is available");
        const data = await r.json();
        if (!cancelled) {
          setModel(data);
          setStatus("Demo model loaded because no workspace model was saved");
        }
      } catch (e) {
        if (!cancelled) setStatus(e.message || "Unable to load model");
      }
    }

    load();
    return () => { cancelled = true; };
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
          <h2 style={{marginTop:0}}>Phase 1 — Manual cell design</h2>
          <p style={muted}>
            This page is now connected to the exact model from the main workspace. The next increment will add editable cell definitions that assign activities and resource capacity to cells, followed by paired Global versus Cellular / No Overflow experiments using the same demand, distributions, skills and random seeds.
          </p>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginTop:14}}>
            <div style={{...card,boxShadow:"none",background:"#f8fafc"}}>
              <div style={{fontWeight:800}}>Activities available for cell assignment</div>
              <div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap"}}>
                {enabledActivities.map(a => (
                  <span key={a.id} style={{fontSize:12,padding:"5px 8px",border:"1px solid #cbd5e1",borderRadius:999,background:"#fff"}}>{a.name || a.id}</span>
                ))}
              </div>
            </div>

            <div style={{...card,boxShadow:"none",background:"#f8fafc"}}>
              <div style={{fontWeight:800}}>Resources available for cell assignment</div>
              <div style={{marginTop:10,display:"grid",gap:7}}>
                {(model.resources || []).map(r => (
                  <div key={r.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",gap:10}}>
                    <span>{r.name || r.id}</span>
                    <b>capacity {r.capacity}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
