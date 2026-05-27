import { withClient } from "@/lib/db";

function getIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function writeAuditLog({
  request,
  userId,
  action,
  detail
}: {
  request: Request;
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
}) {
  await withClient(async (client) => {
    await client.query(
      `
        insert into public.admin_audit_logs (
          user_id,
          action,
          detail,
          ip_address,
          user_agent
        )
        values ($1::uuid, $2::text, $3::jsonb, $4::text, $5::text)
      `,
      [
        userId || null,
        action,
        JSON.stringify(detail || {}),
        getIpAddress(request),
        request.headers.get("user-agent") || ""
      ]
    );
  }).catch(() => undefined);
}
