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
      setCmp(
        await call(
          "/api/compare",
          {
            method:"POST"
          },
          "Comparing AS-IS vs TO-BE"
        )
      );

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
            disabled={busy}
            style={{
              ...buttonStyle,
              opacity:
                busy ? 0.55 : 1
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

          <div style={{
            display:"flex",
            gap:8,
            flexWrap:"wrap"
          }}>
            {model.activities.map(
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
