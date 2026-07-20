import { NextResponse } from "next/server";
import { createPasswordHash, getCurrentAdmin, isSuperAdmin } from "@/lib/auth";
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
  if (!isSuperAdmin(admin)) {
    return NextResponse.json({ error: "Hanya super admin yang bisa membuat akun admin baru." }, { status: 403 });
  }

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

  const { id, isActive, password } = await request.json().catch(() => ({}));
  if (!id) {
    return NextResponse.json({ error: "id wajib dikirim." }, { status: 400 });
  }

  // Toggle status aktif/nonaktif — hanya super admin
  if (typeof isActive === "boolean") {
    if (!isSuperAdmin(admin)) {
      return NextResponse.json(
        { error: "Hanya super admin yang bisa mengaktifkan/menonaktifkan akun admin." },
        { status: 403 }
      );
    }

    if (id === admin.id && !isActive) {
      return NextResponse.json(
        { error: "Tidak bisa menonaktifkan akun yang sedang kamu pakai sendiri." },
        { status: 400 }
      );
    }

    try {
      await withClient(async (client) => {
        if (!isActive) {
          const targetResult = await client.query(`select role from public.admin_users where id = $1::uuid`, [id]);
          const targetRole = targetResult.rows[0]?.role;
          if (targetRole === "super_admin") {
            const activeSuperAdminCount = await client.query(
              `select count(*)::int as total from public.admin_users where role = 'super_admin' and is_active = true`
            );
            if ((activeSuperAdminCount.rows[0]?.total || 0) <= 1) {
              throw new Error("Tidak bisa menonaktifkan super admin aktif terakhir yang tersisa di sistem.");
            }
          }
        }

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

  // Reset / ganti password — super admin boleh reset siapa saja; admin
  // biasa hanya boleh ganti password miliknya sendiri.
  if (typeof password === "string") {
    if (!isSuperAdmin(admin) && id !== admin.id) {
      return NextResponse.json(
        { error: "Kamu cuma bisa mengganti password akunmu sendiri." },
        { status: 403 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
    }

    const rateLimit = checkRateLimit(`reset-password:${admin.id}:${getIpAddress(request)}`, 10, 10 * 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.` },
        { status: 429 }
      );
    }

    try {
      const passwordHash = await createPasswordHash(password);

      const updated = await withClient(async (client) => {
        const result = await client.query(
          `
            update public.admin_users
            set password_hash = $1::text
            where id = $2::uuid
            returning email
          `,
          [passwordHash, id]
        );
        return result.rows[0] || null;
      });

      if (!updated) {
        return NextResponse.json({ error: "Admin tidak ditemukan." }, { status: 404 });
      }

      // Password diganti → semua sesi login lama untuk akun ini dicabut
      // paksa, biar device/browser lain yang mungkin bocor kredensialnya
      // langsung ke-logout dan wajib pakai password baru.
      await withClient(async (client) => {
        await client.query(`delete from public.admin_sessions where user_id = $1::uuid`, [id]);
      });

      await writeAuditLog({
        request,
        userId: admin.id,
        action: "reset_admin_password",
        detail: { targetAdminId: id, targetAdminEmail: updated.email, selfReset: id === admin.id }
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: formatDbError(error, "Gagal mengganti password admin.") },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Tidak ada perubahan yang dikirim (isActive/password)." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(admin)) {
    return NextResponse.json({ error: "Hanya super admin yang bisa menghapus akun admin." }, { status: 403 });
  }

  const { id } = await request.json().catch(() => ({}));
  if (!id) {
    return NextResponse.json({ error: "id wajib dikirim." }, { status: 400 });
  }

  if (id === admin.id) {
    return NextResponse.json(
      { error: "Tidak bisa menghapus akun yang sedang kamu pakai sendiri." },
      { status: 400 }
    );
  }

  try {
    const deleted = await withClient(async (client) => {
      // Jangan sampai admin terakhir yang tersisa terhapus — panel bisa
      // jadi tidak bisa diakses siapa pun kalau ini kejadian.
      const countResult = await client.query(`select count(*)::int as total from public.admin_users`);
      const totalAdmins = countResult.rows[0]?.total || 0;
      if (totalAdmins <= 1) {
        throw new Error("Tidak bisa menghapus admin terakhir yang tersisa di sistem.");
      }

      // Kalau target adalah super admin, jangan sampai itu super admin
      // terakhir — nanti tidak ada siapa pun yang bisa kelola admin lagi.
      const targetResult = await client.query(`select role from public.admin_users where id = $1::uuid`, [id]);
      const targetRole = targetResult.rows[0]?.role;
      if (targetRole === "super_admin") {
        const superAdminCount = await client.query(
          `select count(*)::int as total from public.admin_users where role = 'super_admin'`
        );
        if ((superAdminCount.rows[0]?.total || 0) <= 1) {
          throw new Error("Tidak bisa menghapus super admin terakhir yang tersisa di sistem.");
        }
      }

      // Hapus dulu sesi login milik admin ini — jaga-jaga admin_sessions.user_id
      // punya foreign key ke admin_users, biar delete di bawah tidak gagal.
      await client.query(`delete from public.admin_sessions where user_id = $1::uuid`, [id]);

      const result = await client.query(
        `delete from public.admin_users where id = $1::uuid returning email`,
        [id]
      );
      return result.rows[0] || null;
    });

    if (!deleted) {
      return NextResponse.json({ error: "Admin tidak ditemukan." }, { status: 404 });
    }

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "delete_admin_user",
      detail: { targetAdminId: id, targetAdminEmail: deleted.email }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal menghapus akun admin.") },
      { status: 500 }
    );
  }
}