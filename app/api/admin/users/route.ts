import { createClient } from "@supabase/supabase-js";

const roles = new Set(["system_admin", "warehouse_manager", "warehouse_officer", "processing_supervisor", "finance_officer", "auditor", "viewer"]);

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: "Server-side Supabase administration is not configured." }, { status: 503 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Sign in as a system administrator." }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Your session is not valid." }, { status: 401 });
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", authData.user.id).maybeSingle();
  if (!profile?.active || profile.role !== "system_admin") return Response.json({ error: "Only an active system administrator can create users." }, { status: 403 });

  const body = await request.json() as { email?: string; fullName?: string; role?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const fullName = body.fullName?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !fullName || !body.role || !roles.has(body.role) || !body.password || body.password.length < 10) {
    return Response.json({ error: "Enter a valid email, full name, role, and temporary password of at least 10 characters." }, { status: 400 });
  }

  const created = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (created.error || !created.data.user) return Response.json({ error: created.error?.message ?? "User account could not be created." }, { status: 400 });
  const updated = await admin.from("profiles").update({ full_name: fullName, role: body.role, active: true }).eq("id", created.data.user.id);
  if (updated.error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    return Response.json({ error: updated.error.message }, { status: 400 });
  }
  return Response.json({ id: created.data.user.id }, { status: 201 });
}
