import { NextResponse } from "next/server";
import { GATE_COOKIE, gateToken } from "./lib/gate";

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;

  if (
    pathname === "/login"
    || pathname === "/auth/login"
    || pathname === "/auth/logout"
  ) {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;

  if (!password) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("config", "missing");
    return NextResponse.redirect(loginUrl);
  }

  const expected = await gateToken(password);
  const supplied = request.cookies.get(GATE_COOKIE)?.value || "";

  if (supplied === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const next = `${pathname}${search || ""}`;
  if (next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
