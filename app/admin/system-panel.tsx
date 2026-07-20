"use client";

import { useEffect, useState } from "react";
import {
  AuditLogRow,
  DbStatsResponse,
  N8nStatusResponse,
  PaginationInfo,
  WebhookStatus
} from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime } from "@/app/admin/utils";
import { LoadingNotice, PaginationControls, TableSkeleton } from "@/app/admin/shared";
import { AdminManagementSection } from "@/app/admin/admin-management";

function WebhookStatusCard({ label, status }: { label: string; status: WebhookStatus | null }) {
  const badgeColor = !status
    ? "bg-slate-100 text-slate-500"
    : !status.configured
    ? "bg-slate-100 text-slate-500"
    : status.reachable
    ? "bg-emerald-100 text-emerald-700"
    : "bg-rose-100 text-rose-700";

  const badgeText = !status
    ? "Belum dicek"
    : !status.configured
    ? "Belum diatur"
    : status.reachable
    ? "Terhubung"
    : "Tidak terhubung";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{label}</span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${badgeColor}`}>
          {status ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status.configured && status.reachable ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
              {badgeText}
            </span>
          ) : (
            badgeText
          )}
        </span>
      </div>
      {status?.httpStatus !== undefined && (
        <p className="text-xs text-slate-400">HTTP status respons: {status.httpStatus}</p>
      )}
      {status?.error && <p className="text-xs text-rose-500">{status.error}</p>}
    </div>
  );
}

export function SystemPanel() {
  const [n8nStatus, setN8nStatus] = useState<N8nStatusResponse | null>(null);
  const [checkingN8n, setCheckingN8n] = useState(false);
  const [n8nError, setN8nError] = useState("");

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [logsPagination, setLogsPagination] = useState<PaginationInfo | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const [dbStats, setDbStats] = useState<DbStatsResponse | null>(null);
  const [dbStatsError, setDbStatsError] = useState("");
  const [dbStatsLoading, setDbStatsLoading] = useState(false);

  async function loadDbStats() {
    setDbStatsLoading(true);
    setDbStatsError("");
    try {
      const data = await fetchJson<DbStatsResponse>("/api/admin/db-stats");
      setDbStats(data);
    } catch (err) {
      setDbStatsError(err instanceof Error ? err.message : "Gagal memuat statistik database.");
    } finally {
      setDbStatsLoading(false);
    }
  }

  async function checkN8nStatus() {
    setCheckingN8n(true);
    setN8nError("");
    try {
      const data = await fetchJson<N8nStatusResponse>("/api/admin/n8n-status");
      setN8nStatus(data);
    } catch (err) {
      setN8nError(err instanceof Error ? err.message : "Gagal mengecek status n8n.");
    } finally {
      setCheckingN8n(false);
    }
  }

  async function loadLogs(page = 1) {
    setLogsLoading(true);
    setLogsError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (actionFilter.trim()) params.set("action", actionFilter.trim());
      const data = await fetchJson<{ rows: AuditLogRow[]; pagination: PaginationInfo }>(
        `/api/admin/audit-logs?${params.toString()}`
      );
      setLogs(data.rows || []);
      setLogsPagination(data.pagination || null);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Gagal memuat log aktivitas.");
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    checkN8nStatus();
    loadLogs(1);
    loadDbStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* STATUS WEBHOOK N8N */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Status Koneksi n8n</h2>
            <p className="text-xs text-slate-500">
              Cek apakah kedua webhook n8n bisa dihubungi (tanpa memicu workflow-nya).
            </p>
          </div>
          <button
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm"
            onClick={checkN8nStatus}
            disabled={checkingN8n}
            type="button"
          >
            {checkingN8n ? "Mengecek..." : "Cek Ulang Status"}
          </button>
        </div>

        {n8nError && (
          <div className="mb-3 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">
            {n8nError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WebhookStatusCard label="N8N_RAG_UPLOAD_WEBHOOK" status={n8nStatus?.upload || null} />
          <WebhookStatusCard label="N8N_RAG_CRUD_WEBHOOK" status={n8nStatus?.crud || null} />
        </div>

        {n8nStatus?.checkedAt && (
          <p className="text-xs text-slate-400 mt-2">
            Terakhir dicek: {formatIndonesianDateTime(n8nStatus.checkedAt)}
          </p>
        )}
      </section>

      {/* STATISTIK DATABASE / PGVECTOR */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Statistik Database</h2>
            <p className="text-xs text-slate-500">
              Ukuran tabel, jumlah baris, dan kapan terakhir ANALYZE dijalankan.
            </p>
          </div>
          <button
            className="px-3 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
            onClick={loadDbStats}
            disabled={dbStatsLoading}
            type="button"
          >
            {dbStatsLoading ? "Memuat..." : "Refresh"}
          </button>
        </div>

        {dbStatsError && (
          <div className="mb-3 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">
            {dbStatsError}
          </div>
        )}

        {dbStatsLoading && !dbStats ? (
          <TableSkeleton rows={4} columns={4} />
        ) : dbStats ? (
          <div className="space-y-4">
            {dbStats.databaseSize && (
              <p className="text-xs text-slate-500">
                Total ukuran database: <span className="font-bold text-slate-700">{dbStats.databaseSize}</span>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="pb-2 pr-4 font-semibold">Tabel</th>
                    <th className="pb-2 pr-4 font-semibold">Jumlah Baris</th>
                    <th className="pb-2 pr-4 font-semibold">Ukuran</th>
                    <th className="pb-2 pr-4 font-semibold">Terakhir ANALYZE</th>
                    <th className="pb-2 font-semibold">Jumlah ANALYZE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {dbStats.tables.map((t) => (
                    <tr key={t.table_name}>
                      <td className="py-2 pr-4 font-mono text-slate-700">{t.table_name}</td>
                      <td className="py-2 pr-4 text-slate-600">{t.row_count.toLocaleString("id-ID")}</td>
                      <td className="py-2 pr-4 text-slate-600">{t.total_size}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {t.last_analyze ? formatIndonesianDateTime(t.last_analyze) : "Belum pernah"}
                      </td>
                      <td className="py-2 text-slate-500">{t.analyze_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <LoadingNotice text="Memuat statistik database..." />
        )}
      </section>

      {/* KELOLA AKUN ADMIN */}
      <AdminManagementSection />

      {/* LOG AKTIVITAS ADMIN */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-800">Log Aktivitas Admin</h2>
            <p className="text-xs text-slate-500">
              Riwayat login, upload, tambah/edit/hapus data — tersimpan di tabel admin_audit_logs.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              placeholder="Filter aksi (mis. delete_rag)..."
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadLogs(1);
              }}
            />
            <button
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold"
              onClick={() => loadLogs(1)}
              type="button"
            >
              Cari
            </button>
          </div>
        </div>

        {logsError && (
          <div className="m-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">
            {logsError}
          </div>
        )}

        {logsLoading && !logs.length ? (
          <TableSkeleton rows={6} columns={4} />
        ) : logs.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {logs.map((log, index) => {
                const rowKey = log.id || `${log.action}-${index}`;
                const isExpanded = expandedLogId === rowKey;
                return (
                  <li key={rowKey} className="hover:bg-slate-50/60">
                    <button
                      className="w-full text-left p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                      onClick={() => setExpandedLogId(isExpanded ? null : rowKey)}
                      type="button"
                    >
                      <span className="shrink-0 text-xs font-mono text-slate-400 sm:w-40">
                        {formatIndonesianDateTime(log.created_at || undefined)}
                      </span>
                      <span className="shrink-0 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-bold sm:w-52 truncate">
                        {log.action}
                      </span>
                      <span className="text-xs text-slate-600 truncate">
                        {log.admin_name || log.admin_email || "—"}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-indigo-500 font-semibold">
                        {isExpanded ? "Tutup detail" : "Lihat detail"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-2">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                          <p>
                            <span className="font-semibold text-slate-500">IP: </span>
                            {log.ip_address || "-"}
                          </p>
                          <p className="break-all">
                            <span className="font-semibold text-slate-500">User Agent: </span>
                            {log.user_agent || "-"}
                          </p>
                          {log.detail && (
                            <pre className="bg-white border border-slate-200 rounded p-2 overflow-x-auto text-[11px] font-mono text-slate-700">
                              {JSON.stringify(log.detail, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="p-4 border-t border-slate-100 bg-slate-50/30">
              <PaginationControls
                pagination={
                  logsPagination || { page: 1, limit: 20, total: logs.length, totalPages: 1 }
                }
                onPageChange={(page) => loadLogs(page)}
              />
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-sm text-slate-400">Belum ada log aktivitas.</div>
        )}
      </section>
    </div>
  );
}