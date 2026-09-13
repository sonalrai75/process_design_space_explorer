import { NextResponse } from "next/server";
import { GATE_COOKIE } from "./lib/gate";

export function middleware(request) {
  const { pathname, search } = request.nextUrl;

  if (
    pathname === "/login"
    || pathname === "/auth/login"
    || pathname === "/auth/logout"
  ) {
    return NextResponse.next();
  }

  // Important for Vercel Services: do not recompute the password-derived
  // token in middleware. Route handlers and the FastAPI backend have reliable
  // runtime access to APP_PASSWORD; middleware only verifies that the
  // HttpOnly session cookie exists. The backend still validates the cookie's
  // full SHA-256 token before allowing any functional API request.
  const supplied = request.cookies.get(GATE_COOKIE)?.value || "";

  if (supplied) {
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
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
