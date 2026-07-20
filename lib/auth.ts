import { cookies } from "next/headers";
import crypto from "crypto";
import { withClient } from "@/lib/db";

const COOKIE_NAME = "chatbot_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export type AdminUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

type LoginAttempt = {
  count: number;
  resetAt: number;
};

const loginAttempts = new Map<string, LoginAttempt>();

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function getRateLimitKey(email: string, request: Request) {
  return `${email.toLowerCase()}|${getIpAddress(request)}`;
}

function assertLoginAllowed(email: string, request: Request) {
  const key = getRateLimitKey(email, request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return;
  }

  if (attempt.count >= 5) {
    throw new Error("Terlalu banyak percobaan login. Coba lagi dalam 15 menit.");
  }
}

function recordFailedLogin(email: string, request: Request) {
  const key = getRateLimitKey(email, request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }

  attempt.count += 1;
}

function clearFailedLogin(email: string, request: Request) {
  loginAttempts.delete(getRateLimitKey(email, request));
}

export async function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1
  });

  return `scrypt$16384$8$1$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 6) return false;
  const [algorithm, n, r, p, saltBase64, hashBase64] = parts;
  if (algorithm !== "scrypt" || !n || !r || !p || !saltBase64 || !hashBase64) return false;

  const expected = Buffer.from(hashBase64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltBase64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function loginAdmin(email: string, password: string, request: Request) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return false;

  assertLoginAllowed(normalizedEmail, request);

  const user = await withClient(async (client) => {
    const result = await client.query<AdminUser & { password_hash: string; is_active: boolean }>(
      `
        select id::text, email, name, role, password_hash, is_active
        from public.admin_users
        where lower(email) = lower($1::text)
        limit 1
      `,
      [normalizedEmail]
    );
    return result.rows[0];
  });

  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    recordFailedLogin(normalizedEmail, request);
    return false;
  }

  clearFailedLogin(normalizedEmail, request);

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await withClient(async (client) => {
    await client.query(
      `
        insert into public.admin_sessions (user_id, session_token_hash, expires_at, user_agent, ip_address)
        values ($1::uuid, $2::text, $3::timestamp, $4::text, $5::text)
      `,
      [user.id, hashSessionToken(token), expiresAt, request.headers.get("user-agent") || "", getIpAddress(request)]
    );
  });

  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/"
  });

  return true;
}

export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    return await withClient(async (client) => {
      const result = await client.query<AdminUser>(
        `
          select u.id::text, u.email, u.name, u.role
          from public.admin_sessions s
          join public.admin_users u on u.id = s.user_id
          where s.session_token_hash = $1::text
            and s.expires_at > now()
            and u.is_active = true
          limit 1
        `,
        [hashSessionToken(token)]
      );

      const user = result.rows[0] || null;
      if (user) {
        await client.query(
          `update public.admin_sessions set last_used_at = now() where session_token_hash = $1::text`,
          [hashSessionToken(token)]
        );
      }
      return user;
    });
  } catch (err) {
    console.error("Error pada fungsi getCurrentAdmin DB:", err);
    return null;
  }
}

export async function isAuthenticated() {
  return Boolean(await getCurrentAdmin());
}

// Dipakai backend saja (mis. endpoint /api/admin/sessions) untuk menandai
// baris sesi mana yang sedang dipakai browser ini, TANPA pernah mengirim
// token/hash asli ke client — cukup dibandingkan di server lalu balas
// boolean `isCurrent` per baris.
export async function getCurrentSessionTokenHash() {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return hashSessionToken(token);
}

export async function clearAuthCookie() {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await withClient(async (client) => {
      await client.query(
        `delete from public.admin_sessions where session_token_hash = $1::text`,
        [hashSessionToken(token)]
      );
    }).catch((err) => console.error("Gagal menghapus session dari DB:", err));
  }
  cookieStore.delete(COOKIE_NAME);
}