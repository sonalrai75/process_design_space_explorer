import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const value = String(process.env.APP_PASSWORD || "").trim();
  return NextResponse.json(
    {
      appPasswordConfigured: value.length > 0,
      appPasswordLength: value.length,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
