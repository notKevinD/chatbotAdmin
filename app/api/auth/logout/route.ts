import { NextResponse } from "next/server";
import { clearAuthCookie, getCurrentAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  await clearAuthCookie();
  await writeAuditLog({ request, userId: admin?.id, action: "admin_logout", detail: { email: admin?.email } });
  return NextResponse.json({ ok: true });
}
