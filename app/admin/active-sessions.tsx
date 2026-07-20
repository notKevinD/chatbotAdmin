"use client";

import { useEffect, useState } from "react";
import { SessionRow } from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime } from "@/app/admin/utils";
import { TableSkeleton } from "@/app/admin/shared";

export function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<{ sessions: SessionRow[] }>("/api/admin/sessions");
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat sesi aktif.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  async function revokeSession(session: SessionRow) {
    const label = session.adminName || session.adminEmail || session.id;
    const confirmed = window.confirm(
      session.isCurrent
        ? "Ini sesi yang sedang kamu pakai sekarang. Kalau dicabut, kamu akan langsung logout. Lanjutkan?"
        : `Paksa logout sesi milik ${label}? Admin ini harus login ulang untuk memakai panel lagi.`
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    setRevokingId(session.id);
    try {
      await fetchJson("/api/admin/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: session.id }),
      });

      if (session.isCurrent) {
        window.location.href = "/login";
        return;
      }

      setMessage(`Sesi milik ${label} berhasil dicabut.`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mencabut sesi.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">Sesi Login Aktif</h2>
          <p className="text-xs text-slate-500">
            Semua sesi admin yang sedang aktif (belum kedaluwarsa). Bisa dipaksa logout per sesi.
          </p>
        </div>
        <button
          className="px-3 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
          onClick={loadSessions}
          disabled={loading}
          type="button"
        >
          {loading ? "Memuat..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="m-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">{error}</div>
      )}
      {message && (
        <div className="m-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
          {message}
        </div>
      )}

      {loading && !sessions.length ? (
        <TableSkeleton rows={3} columns={4} />
      ) : sessions.length ? (
        <ul className="divide-y divide-slate-100">
          {sessions.map((session) => (
            <li key={session.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                  {session.adminName || session.adminEmail || "Admin tidak dikenal"}
                  {session.isCurrent && (
                    <span className="shrink-0 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-bold">
                      Sesi ini
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  IP: {session.ipAddress || "-"} · Terakhir dipakai: {formatIndonesianDateTime(session.lastUsedAt || undefined)}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  Kedaluwarsa: {formatIndonesianDateTime(session.expiresAt || undefined)}
                </p>
                {session.userAgent && (
                  <p className="text-[11px] text-slate-400 truncate mt-0.5" title={session.userAgent}>
                    {session.userAgent}
                  </p>
                )}
              </div>
              <button
                className="shrink-0 px-3 py-1.5 border border-rose-300 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50 disabled:opacity-50"
                onClick={() => revokeSession(session)}
                disabled={revokingId === session.id}
                type="button"
              >
                {revokingId === session.id ? "Memproses..." : "Paksa Logout"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-12 text-center text-sm text-slate-400">Tidak ada sesi aktif.</div>
      )}
    </section>
  );
}