import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { status: "unhealthy", database: "not_configured" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${url}/rest/v1/organizations?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", database: "unreachable" },
        { status: 503 },
      );
    }

    return NextResponse.json({ status: "healthy", database: "reachable" });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", database: "unreachable" },
      { status: 503 },
    );
  }
}
