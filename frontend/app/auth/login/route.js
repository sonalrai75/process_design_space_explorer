import { NextResponse } from "next/server";
import { GATE_COOKIE, gateToken } from "../../../lib/gate";

function safeNext(value) {
  return (
    typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
  ) ? value : "/";
}

function absoluteUrl(request, path) {
  return new URL(path, request.url);
}

async function setAuthCookie(response, password) {
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

export async function POST(request) {
  let entered = "";
  let next = "/";

  const contentType = request.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    const body = await request.json().catch(() => ({}));
    entered = String(body?.password || "").trim();
    next = safeNext(String(body?.next || "/"));
  } else {
    const form = await request.formData();
    entered = String(form.get("password") || "").trim();
    next = safeNext(String(form.get("next") || "/"));
  }

  const password = String(process.env.APP_PASSWORD || "").trim();

  if (!password) {
    if (isJson) {
      return NextResponse.json(
        { ok: false, code: "missing_config", message: "APP_PASSWORD is not configured on this deployment." },
        { status: 503 }
      );
    }
    return NextResponse.redirect(absoluteUrl(request, "/login?config=missing"), 303);
  }

  if (entered !== password) {
    if (isJson) {
      return NextResponse.json(
        { ok: false, code: "incorrect_password", message: "Incorrect password. Try again." },
        { status: 401 }
      );
    }
    return NextResponse.redirect(absoluteUrl(request, "/login?error=1"), 303);
  }

  if (isJson) {
    const response = NextResponse.json({ ok: true, next });
    return setAuthCookie(response, password);
  }

  const response = NextResponse.redirect(absoluteUrl(request, next), 303);
  return setAuthCookie(response, password);
}
