// Rate limiter sederhana berbasis memori (per-instance server). Cocok untuk
// skala aplikasi ini (single VPS, admin panel internal). Kalau nanti scale
// ke multi-instance, perlu diganti ke Redis atau sejenisnya.

type Attempt = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Attempt>();

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const attempt = buckets.get(key);

  if (!attempt || attempt.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (attempt.count >= maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((attempt.resetAt - now) / 1000) };
  }

  attempt.count += 1;
  return { allowed: true };
}

export function getIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

// Bersihkan bucket yang sudah kadaluarsa secara berkala supaya Map tidak
// membengkak tanpa batas di server yang jalan lama.
setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of buckets.entries()) {
    if (attempt.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref?.();