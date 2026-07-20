import { NextResponse } from "next/server";
import { createPasswordHash, getCurrentAdmin } from "@/lib/auth";
import { checkRateLimit, getIpAddress } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, withClient } from "@/lib/db";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await withClient(async (client) => {
      const result = await client.query(
        `
          select id::text, email, name, role, is_active, created_at::text
          from public.admin_users
          order by created_at asc
        `
      );
      return result.rows;
    });

    return NextResponse.json({ admins: rows });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat daftar admin.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimit = checkRateLimit(`manage-admins:${admin.id}:${getIpAddress(request)}`, 10, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.` },
      { status: 429 }
    );
  }

  const { email, password, name, role } = await request.json().catch(() => ({}));
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi." }, { status: 400 });
  }
  if (String(password).length < 8) {
    return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
  }

  try {
    const passwordHash = await createPasswordHash(String(password));

    const newAdmin = await withClient(async (client) => {
      const existing = await client.query(
        `select 1 from public.admin_users where lower(email) = lower($1::text) limit 1`,
        [normalizedEmail]
      );
      if ((existing.rowCount || 0) > 0) {
        throw new Error("Email ini sudah terdaftar sebagai admin.");
      }

      const result = await client.query(
        `
          insert into public.admin_users (email, password_hash, name, role, is_active)
          values ($1::text, $2::text, $3::text, $4::text, true)
          returning id::text, email, name, role, is_active, created_at::text
        `,
        [normalizedEmail, passwordHash, name || null, role || "admin"]
      );
      return result.rows[0];
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "create_admin_user",
      detail: { newAdminEmail: normalizedEmail }
    });

    return NextResponse.json({ ok: true, admin: newAdmin });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal membuat akun admin baru.") },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, isActive } = await request.json().catch(() => ({}));
  if (!id || typeof isActive !== "boolean") {
    return NextResponse.json({ error: "id dan isActive wajib dikirim." }, { status: 400 });
  }

  if (id === admin.id && !isActive) {
    return NextResponse.json({ error: "Tidak bisa menonaktifkan akun yang sedang kamu pakai sendiri." }, { status: 400 });
  }

  try {
    await withClient(async (client) => {
      await client.query(
        `update public.admin_users set is_active = $1::boolean where id = $2::uuid`,
        [isActive, id]
      );
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: isActive ? "activate_admin_user" : "deactivate_admin_user",
      detail: { targetAdminId: id }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal mengubah status admin.") },
      { status: 500 }
    );
  }
}