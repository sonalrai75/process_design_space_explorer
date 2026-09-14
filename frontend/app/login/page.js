"use client";

import { useState } from "react";

const shell = {
  minHeight: "100vh",
  background: "#f5f7fb",
  display: "grid",
  placeItems: "center",
  padding: 24,
  color: "#0f172a",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";

      const response = await fetch("/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        setError(data?.message || "Unable to sign in.");
        setPassword("");
        setBusy(false);
        return;
      }

      // The Set-Cookie header has now been processed by the browser.
      // Navigate only after the authenticated response completes.
      window.location.replace(data?.next || "/");
    } catch (err) {
      setError("Unable to reach the sign-in service. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main style={shell}>
      <section style={{width:"min(560px,100%)",background:"#fff",border:"1px solid #e2e8f0",borderRadius:28,padding:"36px 38px",boxShadow:"0 24px 70px rgba(15,23,42,.10)"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:30}}>
          <div style={{width:52,height:52,borderRadius:18,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#172554,#4f46e5)",color:"white",fontWeight:900,fontSize:19}}>PD</div>
          <div>
            <div style={{fontSize:18,fontWeight:850,letterSpacing:"-.02em"}}>Process Design Space</div>
            <div style={{fontSize:13,color:"#64748b",marginTop:3}}>Digital twin & optimization workspace</div>
          </div>
        </div>

        <div style={{display:"inline-flex",padding:"7px 12px",borderRadius:999,background:"#eef2ff",color:"#4338ca",fontSize:12,fontWeight:800,letterSpacing:".08em",marginBottom:18}}>PRIVATE WORKSPACE</div>
        <h1 style={{fontSize:42,lineHeight:1.05,letterSpacing:"-.04em",margin:"0 0 12px"}}>Welcome back</h1>
        <p style={{color:"#64748b",fontSize:16,lineHeight:1.65,margin:"0 0 28px"}}>Enter the shared workspace password to open the Process Design Space Explorer.</p>

        <form onSubmit={submit}>
          <label htmlFor="password" style={{display:"block",fontWeight:750,fontSize:15,marginBottom:9}}>Workspace password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{width:"100%",boxSizing:"border-box",height:56,border:"1px solid #cbd5e1",borderRadius:14,padding:"0 16px",fontSize:18,outline:"none",background:"#fff"}}
          />

          {error ? (
            <div role="alert" style={{marginTop:12,padding:"11px 13px",borderRadius:12,background:"#fef2f2",border:"1px solid #fecaca",color:"#b91c1c",fontSize:14,fontWeight:650}}>{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            style={{width:"100%",height:56,border:0,borderRadius:14,marginTop:18,background:busy?"#475569":"#0f172a",color:"#fff",fontSize:16,fontWeight:800,cursor:busy?"wait":"pointer",boxShadow:"0 12px 28px rgba(15,23,42,.18)"}}
          >
            {busy ? "Opening workspace…" : "Open workspace"}
          </button>
        </form>

        <div style={{height:1,background:"#e2e8f0",margin:"28px 0 20px"}} />
        <p style={{margin:0,color:"#94a3b8",fontSize:13,lineHeight:1.5}}>Protected access · Session authentication is stored in an HttpOnly cookie.</p>
      </section>
    </main>
  );
}
