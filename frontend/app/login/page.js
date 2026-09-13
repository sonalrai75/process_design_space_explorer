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
      padding:24
    }}>
      <section style={{
        width:"100%",
        maxWidth:420,
        background:"#fff",
        border:"1px solid #e5e7eb",
        borderRadius:16,
        padding:28,
        boxShadow:"0 10px 30px rgba(0,0,0,.06)"
      }}>
        <div style={{
          fontSize:12,
          fontWeight:800,
          letterSpacing:".08em",
          color:"#4f46e5"
        }}>
          PRIVATE ACCESS
        </div>

        <h1 style={{
          margin:"8px 0 8px",
          fontSize:28
        }}>
          Process Design Space Explorer
        </h1>

        <p style={{
          color:"#6b7280",
          lineHeight:1.5,
          marginTop:0
        }}>
          Enter the shared password to continue.
        </p>

        {error &&
          <div style={{
            padding:"10px 12px",
            marginBottom:14,
            borderRadius:8,
            background:"#fef2f2",
            color:"#991b1b",
            fontSize:14
          }}>
            Incorrect password.
          </div>
        }

        {missing &&
          <div style={{
            padding:"10px 12px",
            marginBottom:14,
            borderRadius:8,
            background:"#fffbeb",
            color:"#92400e",
            fontSize:14
          }}>
            APP_PASSWORD is not configured on this deployment.
          </div>
        }

        <form method="post" action="/auth/login">
          <input type="hidden" name="next" value={next} />

          <label
            htmlFor="password"
            style={{
              display:"block",
              fontSize:13,
              fontWeight:700,
              marginBottom:6
            }}
          >
            Password
          </label>

          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            style={{
              width:"100%",
              boxSizing:"border-box",
              padding:"11px 12px",
              border:"1px solid #d1d5db",
              borderRadius:8,
              fontSize:16
            }}
          />

          <button
            type="submit"
            style={{
              width:"100%",
              marginTop:14,
              padding:"11px 14px",
              border:0,
              borderRadius:8,
              background:"#111827",
              color:"#fff",
              fontSize:15,
              fontWeight:700,
              cursor:"pointer"
            }}
          >
            Enter app
          </button>
        </form>
      </section>
    </main>
  );
}
