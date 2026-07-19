import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";

type WebhookStatus = {
  configured: boolean;
  reachable: boolean;
  httpStatus?: number;
  error?: string;
};

const PROBE_TIMEOUT_MS = 5000;

// Melakukan "probe" konektivitas ke webhook n8n TANPA memicu workflow-nya.
// n8n webhook production biasanya cuma didaftarkan untuk method tertentu
// (POST), jadi kita kirim request HEAD — kalau n8n merespons APAPUN
// (bahkan 404/405), itu tandanya server n8n hidup dan bisa dihubungi.
// Yang jadi tanda "down" adalah kalau request gagal total (timeout,
// connection refused, DNS error, dsb).
async function probeWebhook(url: string | undefined): Promise<WebhookStatus> {
  if (!url) {
    return { configured: false, reachable: false, error: "Environment variable belum diatur." };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal
    });
    return { configured: true, reachable: true, httpStatus: response.status };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { configured: true, reachable: false, error: `Tidak merespons dalam ${PROBE_TIMEOUT_MS / 1000} detik.` };
    }
    return { configured: true, reachable: false, error: "Tidak dapat terhubung (server mati/URL salah/masalah jaringan)." };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [upload, crud] = await Promise.all([
    probeWebhook(process.env.N8N_RAG_UPLOAD_WEBHOOK),
    probeWebhook(process.env.N8N_RAG_CRUD_WEBHOOK)
  ]);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    upload,
    crud
  });
}