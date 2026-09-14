"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const COOKIE_NAME = "pds_gate";

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next") || "/");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ password, next }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok || !data?.token) {
        if (data?.code === "missing_config") {
          setError("APP_PASSWORD is not configured on this deployment.");
        } else {
          setError(data?.message || "Incorrect password.");
        }
        setPassword("");
        return;
      }

      // Vercel Services can drop Set-Cookie across the auth redirect path.
      // Set the already-derived token directly on this same-origin page,
      // then navigate only after the cookie is present in the browser.
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(data.token)}; Path=/; Max-Age=43200; SameSite=Lax${secure}`;

      window.location.assign(safeNext(data.next || next));
    } catch (err) {
      setError("Unable to sign in. Please try again.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"#f8fafc"}}>
      <section style={{width:"100%",maxWidth:420,background:"#fff",border:"1px solid #e2e8f0",borderRadius:18,padding:28,boxShadow:"0 18px 45px rgba(15,23,42,.08)"}}>
        <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",color:"#4f46e5"}}>PRIVATE ACCESS</div>
        <h1 style={{margin:"8px 0 8px",fontSize:28,color:"#0f172a"}}>Process Design Space Explorer</h1>
        <p style={{color:"#64748b",lineHeight:1.5,marginTop:0}}>Enter the shared password to continue.</p>

        {error && (
          <div style={{padding:"10px 12px",marginBottom:14,borderRadius:8,background:"#fef2f2",color:"#991b1b",fontSize:14}}>
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <label htmlFor="password" style={{display:"block",fontSize:13,fontWeight:700,marginBottom:6,color:"#0f172a"}}>Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{width:"100%",boxSizing:"border-box",padding:"11px 12px",border:"1px solid #cbd5e1",borderRadius:9,fontSize:16}}
          />
          <button
            type="submit"
            disabled={busy}
            style={{width:"100%",marginTop:14,padding:"11px 14px",border:0,borderRadius:9,background:busy?"#475569":"#0f172a",color:"#fff",fontSize:15,fontWeight:700,cursor:busy?"wait":"pointer"}}
          >
            {busy ? "Opening…" : "Enter app"}
          </button>
        </form>
      </section>
    </main>
  );
}
