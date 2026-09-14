import { NextResponse } from "next/server";
import { gateToken } from "../../../lib/gate";

function safeNext(value) {
  return (
    typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
  ) ? value : "/";
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const entered = String(body?.password || "").trim();
  const next = safeNext(String(body?.next || "/"));
  const password = String(process.env.APP_PASSWORD || "").trim();

  if (!password) {
    return NextResponse.json(
      { ok: false, code: "missing_config", message: "APP_PASSWORD is not configured on this deployment." },
      { status: 503 }
    );
  }

  if (entered !== password) {
    return NextResponse.json(
      { ok: false, code: "incorrect_password", message: "Incorrect password." },
      { status: 401 }
    );
  }

  // Return only the derived gate token, never the password.
  // The browser writes this same-origin token into pds_gate after the
  // successful response, avoiding Vercel Services redirect-cookie loss.
  return NextResponse.json({
    ok: true,
    next,
    token: await gateToken(password),
  });
}
