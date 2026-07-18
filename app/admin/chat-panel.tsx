"use client";

import { useState } from "react";
import {
  ChatPair,
  ChatSession,
  PaginationInfo,
  Range,
  reportRangeOptions,
} from "@/app/admin/types";
import { formatIndonesianDateTime, getContextItems } from "@/app/admin/utils";
import { ContextDetailDialog, PaginationControls } from "@/app/admin/shared";

export function ChatPanel({
  sessions,
  sessionPagination,
  selectedSession,
  range,
  setRange,
  customStartDate,
  setCustomStartDate,
  customEndDate,
  setCustomEndDate,
  search,
  setSearch,
  pairs: parentPairs = [], // Gunakan alias agar tidak bertabrakan
  chatPagination,
  loadSessions,
  onSelect,
}: {
  sessions: ChatSession[];
  sessionPagination: PaginationInfo | null;
  selectedSession: string;
  range: Range;
  setRange: (range: Range) => void;
  customStartDate: string;
  setCustomStartDate: (value: string) => void;
  customEndDate: string;
  setCustomEndDate: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  pairs: ChatPair[];
  chatPagination: PaginationInfo | null;
  loadSessions: (page?: number) => Promise<void>;
  onSelect: (sessionId: string, page?: number) => void | Promise<void>;
}) {
  const [contextPair, setContextPair] = useState<ChatPair | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  
  // STATE BARU: Untuk mengontrol siklus gelembung pesan secara reaktif tanpa crash
  const [localPairs, setLocalPairs] = useState<ChatPair[]>([]);
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  function exportChatData(type: "ragas" | "data_leads") {
    const params = new URLSearchParams({ export: type, range });
    if (search.trim()) params.set("q", search.trim());
    if (range === "custom") {
      if (customStartDate) params.set("startDate", customStartDate);
      if (customEndDate) params.set("endDate", customEndDate);
    }
    window.location.href = `/api/admin/chats?${params.toString()}`;
  }

  // Jauh lebih bersih, reaktif, dan aman dari balapan data asinkronus
  async function handleOpenSession(sessionId: string) {
    onSelect(sessionId, 1);
    setIsDetailOpen(true);
    setIsLoadingChat(true);
    setLocalPairs([]); // Reset logs lama agar tidak berbayang

    try {
      const res = await fetch(`/api/admin/chats/${sessionId}`);
      if (!res.ok) throw new Error("Gagal memuat log");
      const data = await res.json();

      if (data) {
        // Ekstrak data array polos dari backend hybrid payload kita
        const targetPairs = data.pairs || data;
        setLocalPairs(Array.isArray(targetPairs) ? targetPairs : []);
      }
    } catch (err) {
      console.error("Bypass fetching error:", err);
    } finally {
      setIsLoadingChat(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* SECTION 1: FILTER BAR */}
      <section className="report-bar bg-white p-5 border border-slate-200 rounded-xl shadow-sm">
        <div className="report-row flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
          <span className="report-label font-semibold text-slate-800 text-sm">
            Filter Riwayat Chat
          </span>
          <div className="report-pills flex flex-wrap gap-1.5">
            {reportRangeOptions.map(({ value, label }) => (
              <button
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  range === value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
                key={value}
                onClick={() => setRange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {range === "custom" && (
          <div className="custom-date-panel grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg mb-4 items-end">
            <div className="field compact-field flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium" htmlFor="chatStartDate">
                Dari tanggal
              </label>
              <input
                className="input border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                id="chatStartDate"
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
              />
            </div>
            <div className="field compact-field flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium" htmlFor="chatEndDate">
                Sampai tanggal
              </label>
              <input
                className="input border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                id="chatEndDate"
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
              />
            </div>
            <button
              className="button bg-slate-800 text-white text-sm py-2 rounded-lg hover:bg-slate-950 transition-all font-medium"
              onClick={() => loadSessions(1)}
              type="button"
            >
              Terapkan
            </button>
          </div>
        )}

        <div className="report-actions flex flex-col sm:flex-row gap-2 mt-2">
          <input
            className="input border border-slate-300 rounded-lg p-2.5 text-sm bg-white text-slate-800 flex-1 placeholder-slate-400"
            placeholder="Cari session, pertanyaan, atau jawaban..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") loadSessions(1);
            }}
          />
          <div className="flex gap-2">
            <button
              className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
              onClick={() => loadSessions(1)}
              type="button"
            >
              Cari
            </button>
            <button
              className="px-4 py-2.5 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg bg-white hover:bg-slate-50 transition-all"
              onClick={() => {
                setSearch("");
                window.setTimeout(() => loadSessions(1), 0);
              }}
              type="button"
            >
              Hapus Filter
            </button>
            <select
              className="select border border-slate-300 bg-white rounded-lg px-3 py-2 text-sm text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500"
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as "ragas" | "data_leads" | "";
                if (value) exportChatData(value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>Pilih ekspor</option>
              <option value="ragas">Ekspor RAGAS</option>
              <option value="data_leads">Ekspor data leads</option>
            </select>
          </div>
        </div>
      </section>

      {/* SECTION 2: DAFTAR SESSION PENGGUNA */}
      <section className="table-wrap bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800">Riwayat Session Pengguna</h2>
          <p className="text-xs text-slate-500">
            Klik salah satu berkas session untuk mengevaluasi detail obrolan.
          </p>
        </div>

        <div className="session-list divide-y divide-slate-100">
          {sessions.map((session) => (
            <button
              className={`w-full text-left p-4 hover:bg-slate-50/80 transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${
                selectedSession === session.sessionId ? "bg-indigo-50/40 border-l-4 border-indigo-600" : ""
              }`}
              key={session.sessionId}
              onClick={() => handleOpenSession(session.sessionId)}
              type="button"
            >
              <span className="session-main">
                <span className="block font-semibold text-slate-800 text-sm">
                  {session.visitorName || "Tanpa nama"}
                </span>
                <span className="block text-xs font-mono text-slate-400 mt-0.5">
                  {session.sessionId}
                </span>
              </span>
              <span className="session-meta flex flex-wrap sm:flex-col items-start sm:items-end gap-x-3 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {session.total} pertanyaan
                </span>
                <span>{formatIndonesianDateTime(session.lastSeen)}</span>
                {session.visitorSchoolOrigin && (
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] mt-0.5 font-medium">
                    {session.visitorSchoolOrigin}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!sessions.length && (
            <div className="p-8 text-center text-sm text-slate-400">Belum ada data session.</div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50/30">
          <PaginationControls pagination={sessionPagination} onPageChange={(page) => loadSessions(page)} />
        </div>
      </section>

      {/* ========================================== */}
      {/* POP-UP MODAL: DETAIL DIALOG PERCAKAPAN      */}
      {/* ========================================== */}
      {isDetailOpen && selectedSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            aria-modal="true"
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden border border-slate-200"
            role="dialog"
          >
            {/* Header Modal */}
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                  Jendela Log Dialog
                </span>
                <h3 className="text-base font-bold text-slate-800 truncate max-w-md sm:max-w-xl">
                  Sesi: {selectedSession}
                </h3>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1"
                onClick={() => setIsDetailOpen(false)}
              >
                ×
              </button>
            </div>

            {/* Leads Summary Data Box - Membaca state reaktif lokal */}
            {!isLoadingChat && localPairs.length > 0 && (localPairs[0]?.visitorName || localPairs[0]?.visitorPhoneNumber || localPairs[0]?.visitorSchoolOrigin) && (
              <div className="bg-indigo-50/50 p-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0 text-xs text-slate-700">
                <div>
                  <span className="text-slate-400 block font-medium">Nama Prospek</span>
                  <strong>{localPairs[0]?.visitorName || "-"}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">No. Telepon</span>
                  <strong>{localPairs[0]?.visitorPhoneNumber || "-"}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Asal Institusi/Sekolah</span>
                  <strong>{localPairs[0]?.visitorSchoolOrigin || "-"}</strong>
                </div>
              </div>
            )}

            {/* Body Percakapan Modern Chat Bubble */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 space-y-6">
              {!isLoadingChat && localPairs.map((pair, index) => (
                <div key={`${pair.createdAt}-${index}`} className="space-y-1.5 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[11px] text-slate-400">
                      {formatIndonesianDateTime(pair.createdAt)}
                    </span>
                    {pair.isFallback && (
                      <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-semibold uppercase">
                        Jawaban Bermasalah
                      </span>
                    )}
                  </div>

                  {/* Bubble User (Left aligned) */}
                  <div className="flex flex-col items-start max-w-[85%]">
                    <div className="bg-slate-200 text-slate-800 rounded-2xl rounded-bl-none px-4 py-2.5 shadow-sm text-sm">
                      <span className="block text-[10px] text-slate-500 font-bold uppercase mb-0.5">User:</span>
                      <p className="whitespace-pre-wrap leading-relaxed">{pair.question || "-"}</p>
                    </div>
                  </div>

                  {/* Bubble Bot (Right aligned) */}
                  <div className="flex flex-col items-end max-w-[85%] ml-auto">
                    <div className={`rounded-2xl rounded-br-none px-4 py-2.5 shadow-sm text-sm ${
                      pair.isFallback ? "bg-rose-50 text-rose-950 border border-rose-200" : "bg-indigo-600 text-white"
                    }`}>
                      <span className={`block text-[10px] font-bold uppercase mb-0.5 ${pair.isFallback ? "text-rose-500" : "text-indigo-200"}`}>
                        Bot AI:
                      </span>
                      <p className="whitespace-pre-wrap leading-relaxed">{pair.answer || "-"}</p>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
                      {pair.responseTimeMs != null && (
                        <span>Respon: {Number(pair.responseTimeMs).toLocaleString("id-ID")} ms</span>
                      )}
                      {getContextItems(pair.context).length ? (
                        <button
                          className="text-indigo-600 hover:text-indigo-800 font-semibold underline bg-transparent"
                          onClick={() => setContextPair(pair)}
                          type="button"
                        >
                          • Lihat Context RAG
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoadingChat && (
                <div className="p-12 text-center text-sm text-slate-500 font-medium animate-pulse">
                  Menghubungkan ke database & memuat log percakapan...
                </div>
              )}
              
              {!isLoadingChat && !localPairs.length && (
                <div className="p-12 text-center text-sm text-slate-400">
                  Tidak ada pesan terekam dalam sesi ini.
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="p-4 border-t border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
              <div className="w-full sm:w-auto">
                <PaginationControls
                  pagination={chatPagination}
                  onPageChange={(page) => selectedSession && onSelect(selectedSession, page)}
                />
              </div>
              <button
                className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition-all"
                onClick={() => setIsDetailOpen(false)}
              >
                Tutup Jendela
              </button>
            </div>
          </div>
        </div>
      )}

      {contextPair ? (
        <ContextDetailDialog pair={contextPair} onClose={() => setContextPair(null)} />
      ) : null}
    </div>
  );
}