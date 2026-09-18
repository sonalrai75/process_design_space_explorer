const card = {
  background:"#ffffff",
  border:"1px solid #e2e8f0",
  borderRadius:14,
  padding:20,
  boxShadow:"0 1px 2px rgba(15,23,42,0.04)"
};

const muted = {color:"#64748b",lineHeight:1.6};
const pill = {display:"inline-block",padding:"4px 9px",borderRadius:999,background:"#eef2ff",color:"#4338ca",fontSize:12,fontWeight:800,marginRight:6,marginBottom:6};

function Section({number,title,children}) {
  return (
    <section style={{...card,marginTop:16}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:".07em",textTransform:"uppercase",color:"#6366f1",marginBottom:5}}>
        {number}
      </div>
      <h2 style={{margin:"0 0 10px",fontSize:22}}>{title}</h2>
      {children}
    </section>
  );
}

function Step({title,children}) {
  return (
    <div style={{padding:"12px 14px",border:"1px solid #e2e8f0",borderRadius:10,background:"#f8fafc"}}>
      <div style={{fontWeight:800,marginBottom:4}}>{title}</div>
      <div style={muted}>{children}</div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <main style={{maxWidth:1080,margin:"0 auto",padding:"30px 20px 70px",fontFamily:"Arial, Helvetica, sans-serif",color:"#0f172a"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:"#4f46e5"}}>
            Process Design Space Explorer
          </div>
          <h1 style={{fontSize:"clamp(30px,4vw,42px)",margin:"7px 0 8px",letterSpacing:"-.025em"}}>
            Feature &amp; User Guide
          </h1>
          <p style={{...muted,maxWidth:850,marginTop:0}}>
            A practical guide to moving from observed event data to a calibrated process model, simulation, architecture-family optimization, and manual or automated cellularization.
          </p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <a href="/" style={{padding:"8px 11px",borderRadius:8,border:"1px solid #cbd5e1",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Workspace</a>
          <a href="/cellularization" style={{padding:"8px 11px",borderRadius:8,border:"1px solid #cbd5e1",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Cellularization</a>
          <a href="/manual-svd" style={{padding:"8px 11px",borderRadius:8,border:"1px solid #cbd5e1",color:"#0f172a",fontSize:13,fontWeight:700,textDecoration:"none"}}>Manual SVD</a>
        </div>
      </div>

      <section style={{...card,marginTop:20,background:"#f8fafc"}}>
        <h2 style={{margin:"0 0 8px"}}>What the tool does</h2>
        <p style={{...muted,margin:"0 0 12px"}}>
          The Explorer is a process digital-twin and design environment. It reconstructs a process from operational data, lets you inspect and correct the model, simulates the process stochastically, explores design changes, and compares alternative operating structures before implementation.
        </p>
        <div>
          <span style={pill}>Event data</span><span style={pill}>Process mining</span><span style={pill}>Calibration</span><span style={pill}>Simulation</span><span style={pill}>Architecture optimization</span><span style={pill}>Cellularization</span><span style={pill}>Scheduling</span><span style={pill}>Sensitivity analysis</span>
        </div>
      </section>

      <Section number="1 · Start" title="Load operational event data">
        <p style={muted}>
          For a general process, load a CSV event log organized by case/job and activity. The standard template uses case ID, activity, start time, end time, and an optional resource field. This is similar in spirit to an XES event log: each case is a trace and each row is an observed event or activity occurrence.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
          <Step title="Choose workflow class">Select the workflow type first so the appropriate template, parser, and model assumptions are used.</Step>
          <Step title="Load CSV / template">Map the event-log columns, inspect the preview, and calibrate the model from observed data.</Step>
          <Step title="Resolve missing timing">Activities with no usable duration data remain unresolved. Mark them terminal, enter fixed/triangular assumptions, provide samples, or borrow a similar activity distribution before simulation.</Step>
        </div>
      </Section>

      <Section number="2 · Inspect" title="Inspect and edit the reconstructed process">
        <p style={muted}>
          The calibrated model contains activities, routing probabilities, arrival behavior, service-time distributions, resources, and process architecture. Use the visual process modeler and statistical inspectors to check that the digital model represents the real process before optimizing it.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          <Step title="Activity statistics">Review duration distributions, counts, mean, median, range, standard deviation, and modeling provenance where data support them.</Step>
          <Step title="Routing statistics">Inspect transition probabilities and the observed flow among activities.</Step>
          <Step title="Resources and skills">Review resource pools and, when available, the editable individual-resource skill matrix.</Step>
          <Step title="Process graph">Add or correct activities and routing when operational data do not capture the intended process completely.</Step>
        </div>
      </Section>

      <Section number="3 · Baseline" title="Run the process digital twin">
        <p style={muted}>
          Baseline simulation executes the calibrated model stochastically. Service times, arrivals, and routing are sampled from the model. Fixed seeds make an individual run reproducible, while replicated experiments use multiple seeds for robustness and paired comparisons.
        </p>
        <p style={muted}>
          Typical outputs include throughput, cycle-time statistics, WIP, SLA attainment, backlog growth, resource utilization, and annual cost. The baseline becomes the reference point for later TO-BE and cellular-design experiments.
        </p>
      </Section>

      <Section number="4 · Design" title="Optimize Architecture Families">
        <p style={muted}>
          Architecture-family optimization is the outer-loop design search for discrete process architectures. Each architecture is treated as a separate family of feasible designs. Inside each family, the optimizer changes the enabled continuous and quantized design variables while respecting model constraints.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          <Step title="Explore each architecture">The optimizer evaluates every architecture defined in the current process model rather than blending fundamentally different structures into one continuous search.</Step>
          <Step title="Use evolving SVD">Local sensitivity matrices and SVD identify important design directions and locally redundant/null-space directions. The search can use those directions to improve the objective while controlling active constraints.</Step>
          <Step title="Validate robustness">Promising designs are checked with replicated stochastic simulation. Designs that meet the requested robustness target are compared on the stated objective; below the target, robustness remains important in the comparison.</Step>
          <Step title="Compare TO-BE">Load a selected optimized design and compare it against the AS-IS baseline using common performance measures.</Step>
        </div>
        <p style={{...muted,marginBottom:0}}>
          Use <b>Manual SVD Explorer</b> when you want to inspect the local sensitivity structure directly and move through design space one SVD direction at a time instead of running the automated architecture-family search.
        </p>
      </Section>

      <Section number="5 · Operating structure" title="Manual cellularization">
        <p style={muted}>
          Cellularization changes the <b>operating structure</b>, not the underlying process architecture. A cell can be physical, virtual, or hybrid. In a digital process, a virtual cell can simply mean preferred work ownership, logical resource assignment, queue separation, and controlled sharing without physically moving people or equipment.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          <Step title="Define cells">Assign activities to cells and partition available resource capacity. Capacity is not duplicated automatically.</Step>
          <Step title="Analyze structure">Review entropy/localization measures, cross-cell routing, workload balance, skill coverage, pooling loss, and other structural penalties.</Step>
          <Step title="No overflow">Test strict cellularization where capacity is dedicated to its assigned cell.</Step>
          <Step title="Controlled overflow">Permit selected cells to receive work when local waiting exceeds the configured threshold and remote capacity can help.</Step>
        </div>
      </Section>

      <Section number="6 · Automated design" title="Automated cellularization decision support">
        <p style={muted}>
          Automated cellularization is deliberately a decision-support workflow rather than a black-box optimizer. It first generates structurally coherent candidate partitions, then evaluates those candidates with the same simulation engine.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(245px,1fr))",gap:10}}>
          <Step title="Stage 1 — Generate candidates">Candidate cells are formed using process topology/routing, activity and processing characteristics, and resource compatibility. Multiple cell counts and alternative structural emphases are explored.</Step>
          <Step title="Structural scoring">Entropy and localization are useful heuristics, but penalties for fragmentation, capacity imbalance, scarce-resource duplication, pooling loss, and overflow pressure prevent “minimum entropy” from being treated as the answer.</Step>
          <Step title="Stage 2 — Simulate">Generated candidates are evaluated against the same global baseline using paired stochastic inputs. Both no-overflow and controlled-overflow structures can be compared.</Step>
          <Step title="Pareto alternatives">The workflow surfaces tradeoffs such as stronger localization, stronger pooling, or balanced alternatives rather than claiming one universally optimal organization.</Step>
        </div>
      </Section>

      <Section number="7 · Experiment" title="Overflow, scheduling, and sensitivity analysis">
        <p style={muted}>
          Once a cell design is loaded, use the experiments to understand why it performs the way it does rather than relying only on its structural score.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          <Step title="Overflow hold time">The local-wait threshold controls how long work waits for its own cell before eligible overflow is considered. Low thresholds behave more like aggressive sharing; high thresholds approach strict cells.</Step>
          <Step title="Threshold sensitivity">Sweep several hold-time values and compare throughput, cycle time, WIP, backlog, utilization, and realized overflow.</Step>
          <Step title="Scheduling matrix">Compare FCFS with SLA-risk dispatching across global pooling, cells without overflow, and cells with controlled overflow.</Step>
          <Step title="Common-random-number comparisons">Where paired experiments are used, the scenarios share generated arrivals, routes, service-time draws, and seeds so observed differences are attributable more directly to the operating-policy change.</Step>
        </div>
      </Section>

      <Section number="8 · Reuse" title="Save and revisit cell designs">
        <p style={muted}>
          Generated or manually edited cell structures can be loaded into the editor for further analysis. Use <b>Load</b> to preserve the saved overflow settings, or <b>Load + overflow</b> to load the same structure and enable the cells to receive controlled overflow for experimentation.
        </p>
        <p style={{...muted,marginBottom:0}}>
          The Saved Cell Designs workspace stores named snapshots in the current browser so you can switch among alternatives without regenerating them. Loading a saved design creates an editable working copy.
        </p>
      </Section>

      <Section number="9 · Recommended workflow" title="A practical sequence for a new process">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:10}}>
          <Step title="1. Reconstruct">Load the event data, calibrate the model, and resolve missing timing assumptions.</Step>
          <Step title="2. Validate">Inspect routing, distributions, resources, and the process graph. Run the baseline simulation.</Step>
          <Step title="3. Explore process design">Use Architecture Families optimization or Manual SVD when the question is about the underlying process/design variables.</Step>
          <Step title="4. Explore operating design">Open Cellularization when the question is how work and resources should be organized around the same process.</Step>
          <Step title="5. Stress-test alternatives">Compare global pooling, strict cells, controlled overflow, scheduling policies, and overflow thresholds using simulation.</Step>
          <Step title="6. Keep alternatives">Save promising designs, edit them, and rerun experiments rather than treating the generated solution as final.</Step>
        </div>
      </Section>

      <section style={{...card,marginTop:16,border:"1px solid #c7d2fe",background:"#eef2ff"}}>
        <h2 style={{margin:"0 0 8px",color:"#312e81"}}>Two different design questions</h2>
        <p style={{margin:"0 0 8px",color:"#3730a3",lineHeight:1.6}}>
          <b>Optimize Architecture Families</b> asks how the process/design variables should change within alternative underlying process architectures.
        </p>
        <p style={{margin:0,color:"#3730a3",lineHeight:1.6}}>
          <b>Cellularization</b> asks how work and resource capacity should be organized around a given process architecture. These are complementary layers and should not be confused.
        </p>
      </section>
    </main>
  );
}
