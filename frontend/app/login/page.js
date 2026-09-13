export const metadata = {
  title: "Sign in | Process Design Space Explorer",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = params?.error === "1";
  const missing = params?.config === "missing";
  const next = (
    typeof params?.next === "string"
    && params.next.startsWith("/")
    && !params.next.startsWith("//")
  ) ? params.next : "/";

  return (
    <main style={{
      minHeight:"100vh",
      display:"grid",
      placeItems:"center",
      padding:24,
      background:"radial-gradient(circle at 18% 12%,#e0e7ff 0,transparent 32%), radial-gradient(circle at 85% 80%,#dbeafe 0,transparent 30%), #f8fafc",
      color:"#0f172a",
      fontFamily:'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    }}>
      <section style={{
        width:"100%",maxWidth:440,background:"rgba(255,255,255,.96)",
        border:"1px solid #e2e8f0",borderRadius:22,padding:30,
        boxShadow:"0 24px 70px rgba(15,23,42,.12)"
      }}>
        <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:24}}>
          <div style={{width:38,height:38,borderRadius:11,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#0f172a,#4338ca)",color:"#fff",fontWeight:800,fontSize:14}}>PD</div>
          <div><div style={{fontSize:14,fontWeight:800}}>Process Design Space</div><div style={{fontSize:11,color:"#64748b",marginTop:1}}>Digital twin & optimization workspace</div></div>
        </div>

        <div style={{display:"inline-flex",padding:"5px 9px",borderRadius:999,background:"#eef2ff",color:"#4338ca",fontSize:11,fontWeight:800,letterSpacing:".055em",textTransform:"uppercase"}}>Private workspace</div>
        <h1 style={{margin:"12px 0 8px",fontSize:30,lineHeight:1.12,letterSpacing:"-.03em"}}>Welcome back</h1>
        <p style={{color:"#64748b",lineHeight:1.6,margin:"0 0 20px",fontSize:14}}>Enter the shared workspace password to open the Process Design Space Explorer.</p>

        {error && <div style={{padding:"10px 12px",marginBottom:14,borderRadius:10,background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b",fontSize:13}}>Incorrect password. Try again.</div>}
        {missing && <div style={{padding:"10px 12px",marginBottom:14,borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",color:"#92400e",fontSize:13}}>APP_PASSWORD is not configured on this deployment.</div>}

        <form method="post" action="/auth/login">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" style={{display:"block",fontSize:12,fontWeight:750,color:"#334155",marginBottom:7}}>Workspace password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required style={{width:"100%",boxSizing:"border-box",padding:"12px 13px",border:"1px solid #cbd5e1",borderRadius:10,fontSize:16,outline:"none",background:"#fff"}} />
          <button type="submit" style={{width:"100%",marginTop:14,padding:"12px 14px",border:"1px solid #0f172a",borderRadius:10,background:"#0f172a",color:"#fff",fontSize:14,fontWeight:750,cursor:"pointer",boxShadow:"0 8px 18px rgba(15,23,42,.18)"}}>Open workspace</button>
        </form>
        <div style={{marginTop:18,paddingTop:16,borderTop:"1px solid #eef2f7",fontSize:11,color:"#94a3b8",lineHeight:1.5}}>Protected access · Session authentication is stored in an HttpOnly cookie.</div>
      </section>
    </main>
  );
}
