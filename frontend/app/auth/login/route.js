import { NextResponse } from "next/server";
import { GATE_COOKIE, gateToken } from "../../../lib/gate";

function safeNext(value) {
  return (
    typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
  ) ? value : "/";
}

export async function POST(request) {
  let entered = "";
  let next = "/";

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    entered = String(body?.password || "");
    next = safeNext(String(body?.next || "/"));
  } else {
    const form = await request.formData();
    entered = String(form.get("password") || "");
    next = safeNext(String(form.get("next") || "/"));
  }

  const password = String(process.env.APP_PASSWORD || "");

  if (!password) {
    return NextResponse.json(
      { ok: false, code: "missing_config", message: "APP_PASSWORD is not configured on this deployment." },
      { status: 503 }
    );
  }

  if (entered !== password) {
    return NextResponse.json(
      { ok: false, code: "incorrect_password", message: "Incorrect password. Try again." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true, next });
  response.cookies.set({
    name: GATE_COOKIE,
    value: await gateToken(password),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
