"use client";

import { useEffect, useState } from "react";
import {
  ChatPair,
  Overview,
  Range,
  UNANSWERED_PAGE_SIZE,
  UnansweredItem,
  rangeLabel
} from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime, getContextItems } from "@/app/admin/utils";
import {
  ContextDetailDialog,
  LoadingNotice,
  PaginationControls,
  QuestionChart,
  Stat
} from "@/app/admin/shared";

export function Dashboard({ overview, range }: { overview: Overview | null; range: Range }) {
  const stats = overview?.stats || { users: 0, chats: 0, unanswered: 0 };
  const unansweredItems = overview?.unansweredSamples || [];
  const [unansweredPage, setUnansweredPage] = useState(1);
  const [selectedUnanswered, setSelectedUnanswered] = useState<UnansweredItem | null>(null);
  const [sessionPairs, setSessionPairs] = useState<ChatPair[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const totalPages = Math.max(Math.ceil(unansweredItems.length / UNANSWERED_PAGE_SIZE), 1);
  const visibleUnanswered = unansweredItems.slice(
    (unansweredPage - 1) * UNANSWERED_PAGE_SIZE,
    unansweredPage * UNANSWERED_PAGE_SIZE
  );

  useEffect(() => {
    setUnansweredPage(1);
    setSelectedUnanswered(null);
    setSessionPairs([]);
    setSessionError("");
  }, [overview]);

  async function openSession(item: UnansweredItem) {
    setSelectedUnanswered(item);
    setSessionPairs([]);
    setSessionError("");
    setSessionLoading(true);

    try {
      const params = new URLSearchParams({
        session: item.sessionId,
        all: "true"
      });
      const data = await fetchJson<{ pairs: ChatPair[] }>(`/api/admin/chats?${params.toString()}`);
      setSessionPairs(data.pairs || []);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Gagal memuat seluruh percakapan.");
    } finally {
      setSessionLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* CARD STATS SECTION */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <Stat label={`Pengguna ${rangeLabel[range]}`} value={stats.users} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <Stat label={`Pertanyaan ${rangeLabel[range]}`} value={stats.chats} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-l-4 border-l-rose-500">
          <Stat label="Jawaban Bermasalah" value={stats.unanswered} />
        </div>
      </section>

      {/* GRAFIK PERTANYAAN */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden p-1">
        <QuestionChart granularity={overview?.filter?.granularity} range={range} series={overview?.questionSeries || []} />
      </div>

      {/* PANEL JAWABAN BERMASALAH */}
      <section className="panel bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-base font-bold text-slate-800">Sampel Jawaban Bermasalah</h2>
          <p className="text-xs text-slate-500">Daftar pertanyaan yang memicu respon fallback pada bot AI.</p>
        </div>
        
        {unansweredItems.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {visibleUnanswered.map((item, index) => (
                <li key={`${item.question}-${index}`} className="hover:bg-slate-50/60 transition-all">
                  <button 
                    className="w-full text-left p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" 
                    onClick={() => openSession(item)} 
                    type="button"
                  >
                    <div className="space-y-1.5 max-w-4xl">
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                        <span className="text-indigo-600 font-mono text-xs bg-indigo-50 px-1.5 py-0.5 rounded mr-1.5">Q</span>
                        {item.question}
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed truncate">
                        <span className="text-rose-600 font-mono text-[10px] bg-rose-50 px-1.5 py-0.5 rounded mr-1.5 font-bold">A</span>
                        {item.answer}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1">
                      Lihat Sesi
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="p-4 border-t border-slate-100 bg-slate-50/30">
              <PaginationControls
                pagination={{
                  page: unansweredPage,
                  limit: UNANSWERED_PAGE_SIZE,
                  total: unansweredItems.length,
                  totalPages
                }}
                onPageChange={setUnansweredPage}
              />
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-sm text-slate-400">Belum ada sampel jawaban bermasalah.</div>
        )}
      </section>

      {/* POP-UP MODAL RIWAYAT CHAT */}
      {selectedUnanswered ? (
        <SessionConversationDialog
          item={selectedUnanswered}
          pairs={sessionPairs}
          loading={sessionLoading}
          error={sessionError}
          onClose={() => {
            setSelectedUnanswered(null);
            setSessionPairs([]);
            setSessionError("");
          }}
        />
      ) : null}
    </div>
  );
}

function SessionConversationDialog({
  item,
  pairs,
  loading,
  error,
  onClose
}: {
  item: UnansweredItem;
  pairs: ChatPair[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const [contextPair, setContextPair] = useState<ChatPair | null>(null);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div aria-modal="true" className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150" role="dialog">
        
        {/* Head Dialog */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-rose-500">Log Evaluasi Percakapan</span>
            <h3 className="text-sm font-mono text-slate-700 mt-0.5 truncate max-w-[24rem] sm:max-w-xl">ID: {item.sessionId}</h3>
            <p className="text-xs text-slate-400 mt-1 truncate max-w-[24rem] sm:max-w-xl">
              Kasus Pemicu: <span className="text-slate-600 font-medium">"{item.question}"</span>
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1 leading-none" onClick={onClose} type="button">
            ×
          </button>
        </div>

        {/* Content Chat Box Scroll */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-6">
          {loading && <LoadingNotice text="Memuat seluruh percakapan session..." />}
          {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">{error}</div>}

          {!loading && !error && (
            <div className="space-y-6">
              {pairs.map((pair, index) => (
                <div key={`${pair.createdAt || "chat"}-${index}`} className="space-y-2">
                  
                  {/* Metadata Bar Obrolan */}
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] text-slate-400 font-medium">{formatIndonesianDateTime(pair.createdAt)}</span>
                    {pair.isFallback && (
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold uppercase tracking-wider">
                        Jawaban bermasalah
                      </span>
                    )}
                  </div>

                  {/* Bubble User (Rata Kiri, Latar Abu-abu) */}
                  <div className="flex flex-col items-start max-w-[85%]">
                    <div className="bg-slate-200 text-slate-800 rounded-2xl rounded-bl-none px-4 py-2.5 shadow-sm text-sm">
                      <span className="block text-[10px] text-slate-500 font-bold uppercase mb-0.5">User:</span>
                      <p className="whitespace-pre-wrap leading-relaxed">{pair.question || "-"}</p>
                    </div>
                  </div>

                  {/* Bubble Bot (Rata Kanan, Latar Indigo/Rose jika Fallback) */}
                  <div className="flex flex-col items-end max-w-[85%] ml-auto">
                    <div className={`rounded-2xl rounded-br-none px-4 py-2.5 shadow-sm text-sm ${
                      pair.isFallback ? "bg-rose-50 text-rose-950 border border-rose-200" : "bg-indigo-600 text-white"
                    }`}>
                      <span className={`block text-[10px] font-bold uppercase mb-0.5 ${pair.isFallback ? "text-rose-500" : "text-indigo-200"}`}>Bot AI:</span>
                      <p className="whitespace-pre-wrap leading-relaxed">{pair.answer || "-"}</p>
                    </div>

                    {/* Tombol Aksi di Bawah Balon Percakapan */}
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
                      {pair.responseTimeMs != null && (
                        <span>Speed: {Number(pair.responseTimeMs).toLocaleString("id-ID")} ms</span>
                      )}
                      {getContextItems(pair.context).length ? (
                        <button 
                          className="text-indigo-600 hover:text-indigo-800 font-semibold underline bg-transparent border-none p-0 cursor-pointer" 
                          onClick={() => setContextPair(pair)} 
                          type="button"
                        >
                          • Lihat Context
                        </button>
                      ) : null}
                    </div>
                  </div>

                </div>
              ))}
              {!pairs.length && <div className="p-8 text-center text-sm text-slate-400">Tidak ada percakapan pada session ini.</div>}
            </div>
          )}
        </div>

        {/* Footer Dialog */}
        <div className="p-4 border-t border-slate-100 bg-white text-right shrink-0">
          <button 
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition-all" 
            onClick={onClose} 
            type="button"
          >
            Tutup Jendela
          </button>
        </div>

        {contextPair ? <ContextDetailDialog pair={contextPair} onClose={() => setContextPair(null)} /> : null}
      </div>
    </div>
  );
}