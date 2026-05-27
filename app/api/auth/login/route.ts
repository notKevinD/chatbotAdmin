import { NextResponse } from "next/server";
import { loginAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || body.email || "");
  const password = String(body.password || "");

  let ok = false;

  try {
    ok = await loginAdmin(username, password, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login gagal.";
    await writeAuditLog({ request, action: "admin_login_error", detail: { username, message } });
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Terlalu banyak") ? 429 : 500 }
    );
  }

  if (!ok) {
    await writeAuditLog({ request, action: "admin_login_failed", detail: { username } });
    return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  }

  await writeAuditLog({ request, action: "admin_login_success", detail: { username } });
  return NextResponse.json({ ok: true });
}
