import { NextResponse } from "next/server";
import { GATE_COOKIE } from "../../../lib/gate";

export async function GET(request) {
  const response = NextResponse.redirect(
    new URL("/login", request.url),
    303
  );

  response.cookies.set({
    name: GATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
