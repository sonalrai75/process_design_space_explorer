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
  const form = await request.formData();
  const entered = String(form.get("password") || "");
  const next = safeNext(String(form.get("next") || "/"));
  const password = process.env.APP_PASSWORD;

  if (!password) {
    const url = new URL("/login", request.url);
    url.searchParams.set("config", "missing");
    return NextResponse.redirect(url, 303);
  }

  if (entered !== password) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }

  const response = NextResponse.redirect(
    new URL(next, request.url),
    303
  );

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
