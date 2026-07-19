"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatPanel } from "@/app/admin/chat-panel";
import { Dashboard } from "@/app/admin/dashboard";
import { DismissibleAlert, LoadingNotice } from "@/app/admin/shared";
import { RagPanel } from "@/app/admin/rag-panel";
import { SystemPanel } from "@/app/admin/system-panel";
import {
  ChatPair,
  ChatSession,
  DocumentRow,
  DocumentsResponse,
  MetadataRow,
  Overview,
  PAGE_SIZE,
  PaginationInfo,
  Range,
  Tab,
  reportRangeOptions
} from "@/app/admin/types";
import { fetchJson } from "@/app/admin/utils";

export default function AdminApp() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [range, setRange] = useState<Range>("today");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [chatRange, setChatRange] = useState<Range>("this_week");
  const [chatCustomStartDate, setChatCustomStartDate] = useState("");
  const [chatCustomEndDate, setChatCustomEndDate] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([]);
  const [metadataPagination, setMetadataPagination] = useState<PaginationInfo | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentPagination, setDocumentPagination] = useState<PaginationInfo | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState("");
  const [ragSearch, setRagSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionPagination, setSessionPagination] = useState<PaginationInfo | null>(null);
  const [selectedSession, setSelectedSession] = useState("");
  const [chatPairs, setChatPairs] = useState<ChatPair[]>([]);
  const [chatPagination, setChatPagination] = useState<PaginationInfo | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  useEffect(() => {
    loadOverview();
  }, [range]);

  useEffect(() => {
    if (tab === "rag") loadDocuments();
    if (tab === "chat") loadSessions();
  }, [tab]);

  useEffect(() => {
    if (tab === "chat") loadSessions(1);
  }, [chatRange]);

  // Debounced auto-search: nunggu user berhenti mengetik ~450ms baru fetch,
  // supaya tidak spam request tiap huruf, tapi tetap terasa otomatis
  // (tombol "Cari" tetap ada untuk trigger instan kalau mau).
  const isFirstRagSearch = useRef(true);
  useEffect(() => {
    if (isFirstRagSearch.current) {
      isFirstRagSearch.current = false;
      return;
    }
    if (tab !== "rag") return;
    const timeout = window.setTimeout(() => {
      loadDocuments(1);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [ragSearch]);

  const isFirstDocumentSearch = useRef(true);
  useEffect(() => {
    if (isFirstDocumentSearch.current) {
      isFirstDocumentSearch.current = false;
      return;
    }
    if (!selectedMetadata) return;
    const timeout = window.setTimeout(() => {
      loadDocumentDetails(selectedMetadata, 1);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [documentSearch]);

  const isFirstChatSearch = useRef(true);
  useEffect(() => {
    if (isFirstChatSearch.current) {
      isFirstChatSearch.current = false;
      return;
    }
    if (tab !== "chat") return;
    const timeout = window.setTimeout(() => {
      loadSessions(1);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [chatSearch]);

  useEffect(() => {
    if (!error && !message) return;

    const timeout = window.setTimeout(() => {
      setError("");
      setMessage("");
    }, error ? 9000 : 5000);

    return () => window.clearTimeout(timeout);
  }, [error, message]);

  async function loadOverview() {
    setError("");
    setLoading(true);
    setLoadingText("Memuat laporan dashboard...");
    try {
      const params = new URLSearchParams({ range });
      if (range === "custom") {
        if (customStartDate) params.set("startDate", customStartDate);
        if (customEndDate) params.set("endDate", customEndDate);
      }
      const data = await fetchJson<Overview>(`/api/admin/overview?${params.toString()}`);
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat dashboard.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function loadDocuments(page = 1) {
    setError("");
    setLoading(true);
    setLoadingText("Memuat daftar file data chatbot...");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (ragSearch.trim()) params.set("q", ragSearch.trim());
      const data = await fetchJson<DocumentsResponse>(`/api/admin/documents?${params.toString()}`);
      setMetadataRows((data.rows || []) as unknown as MetadataRow[]);
      setMetadataPagination(data.pagination || null);
      setDocuments([]);
      setDocumentPagination(null);
      setSelectedMetadata("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data chatbot.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function loadDocumentDetails(metadataName: string, page = 1) {
    setError("");
    setSelectedMetadata(metadataName);
    setLoading(true);
    setLoadingText("Memuat isi data chatbot...");
    try {
      const params = new URLSearchParams({
        metadata: metadataName,
        page: String(page),
        limit: String(PAGE_SIZE)
      });
      if (documentSearch.trim()) params.set("q", documentSearch.trim());
      const data = await fetchJson<DocumentsResponse>(`/api/admin/documents?${params.toString()}`);
      setDocuments((data.rows || []) as DocumentRow[]);
      setDocumentPagination(data.pagination || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat isi data chatbot.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function loadSessions(page = 1) {
    setError("");
    setLoading(true);
    setLoadingText("Memuat session pengguna...");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), range: chatRange });
      if (chatSearch.trim()) params.set("q", chatSearch.trim());
      if (chatRange === "custom") {
        if (chatCustomStartDate) params.set("startDate", chatCustomStartDate);
        if (chatCustomEndDate) params.set("endDate", chatCustomEndDate);
      }
      const data = await fetchJson<{ sessions: ChatSession[]; pagination?: PaginationInfo }>(
        `/api/admin/chats?${params.toString()}`
      );
      setSessions(data.sessions);
      setSessionPagination(data.pagination || null);
      setSelectedSession("");
      setChatPairs([]);
      setChatPagination(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat session.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function loadChatDetail(sessionId: string, page = 1) {
    setSelectedSession(sessionId);
    setError("");
    setLoading(true);
    setLoadingText("Memuat detail percakapan...");
    try {
      const params = new URLSearchParams({
        session: sessionId,
        page: String(page),
        limit: "5",
        range: chatRange
      });
      if (chatSearch.trim()) params.set("q", chatSearch.trim());
      if (chatRange === "custom") {
        if (chatCustomStartDate) params.set("startDate", chatCustomStartDate);
        if (chatCustomEndDate) params.set("endDate", chatCustomEndDate);
      }
      const data = await fetchJson<{ pairs: ChatPair[]; pagination?: PaginationInfo }>(
        `/api/admin/chats?${params.toString()}`
      );
      setChatPairs(data.pairs);
      setChatPagination(data.pagination || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat detail chat.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const title = useMemo(() => {
    if (tab === "dashboard") return "Dashboard Penggunaan";
    if (tab === "rag") return "Data Chatbot RAG";
    if (tab === "system") return "Status Sistem & Log Aktivitas";
    return "Riwayat Percakapan Memory";
  }, [tab]);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setIsSidebarOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      {/* OVERLAY BACKDROP UNTUK DRAWER MOBILE */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* SIDEBAR NAVIGATION AREA */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col justify-between p-5 border-r border-slate-800 shrink-0 transform transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-sm tracking-tight shrink-0" aria-hidden="true">UBL</div>
              <div className="flex flex-col min-w-0">
                <strong className="text-white text-sm font-bold truncate">Universitas Bandar Lampung</strong>
                <span className="text-[11px] text-slate-500 font-semibold tracking-wide uppercase mt-0.5">Admin Chatbot PMB</span>
              </div>
            </div>
            <button
              className="lg:hidden text-slate-400 hover:text-white p-1 shrink-0"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Tutup menu"
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          
          <nav className="flex flex-col gap-1" aria-label="Menu admin">
            <button 
              className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left ${
                tab === "dashboard" ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-slate-800 hover:text-white"
              }`} 
              onClick={() => selectTab("dashboard")}
            >
              Dashboard Laporan
            </button>
            <button 
              className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left ${
                tab === "rag" ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-slate-800 hover:text-white"
              }`} 
              onClick={() => selectTab("rag")}
            >
              Kelola Basis Pengetahuan AI
            </button>
            <button 
              className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left ${
                tab === "chat" ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-slate-800 hover:text-white"
              }`} 
              onClick={() => selectTab("chat")}
            >
              Riwayat Percakapan
            </button>
            <button 
              className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left ${
                tab === "system" ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-slate-800 hover:text-white"
              }`} 
              onClick={() => selectTab("system")}
            >
              Status Sistem
            </button>
          </nav>
        </div>

        <button className="w-full py-2 border border-slate-800 bg-slate-950/40 hover:bg-rose-950/20 hover:border-rose-900 hover:text-rose-400 text-xs font-bold rounded-lg transition-all pt-2 border-t border-slate-800" onClick={logout}>
          Keluar Panel
        </button>
      </aside>

      {/* MAIN CONTENT WRAPPER */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-4 sm:py-5 flex items-center gap-3 shrink-0">
          <button
            className="lg:hidden text-slate-500 hover:text-slate-800 p-1.5 -ml-1 shrink-0"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Buka menu"
            type="button"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight truncate">{title}</h1>
            <p className="hidden sm:block text-xs text-slate-400 mt-0.5 font-medium">Database chatbot, webhook n8n, dan chat memory dalam satu panel terintegrasi.</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
          {/* TOP REPORT RANGE CONTROLLER PILLS */}
          {tab === "dashboard" && (
            <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider">Periode Laporan:</span>
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  {reportRangeOptions.map(({ value, label }) => (
                    <button
                      className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                        range === value ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
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
                <div className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200 animate-fadeIn">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600" htmlFor="customStartDate">Dari Tanggal</label>
                    <input
                      className="border border-slate-300 bg-white text-slate-800 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      id="customStartDate"
                      type="date"
                      value={customStartDate}
                      onChange={(event) => setCustomStartDate(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600" htmlFor="customEndDate">Sampai Tanggal</label>
                    <input
                      className="border border-slate-300 bg-white text-slate-800 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      id="customEndDate"
                      type="date"
                      value={customEndDate}
                      onChange={(event) => setCustomEndDate(event.target.value)}
                    />
                  </div>
                  <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-all" onClick={loadOverview} type="button">
                    Terapkan Filter
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STATUS NOTIFICATION AREA */}
          {error && <DismissibleAlert kind="error" text={error} onClose={() => setError("")} />}
          {message && <DismissibleAlert kind="success" text={message} onClose={() => setMessage("")} />}
          {loading && loadingText && <LoadingNotice text={loadingText} />}

          {/* RENDERING SECTIONS ACCORDING TO THE ACTIVE TAB TAB */}
          <div className="space-y-6">
            {tab === "dashboard" ? (
              <Dashboard overview={overview} range={range} />
            ) : tab === "rag" ? (
              <RagPanel
                metadataRows={metadataRows}
                metadataPagination={metadataPagination}
                documents={documents}
                documentPagination={documentPagination}
                selectedMetadata={selectedMetadata}
                ragSearch={ragSearch}
                setRagSearch={setRagSearch}
                documentSearch={documentSearch}
                setDocumentSearch={setDocumentSearch}
                loading={loading}
                setLoading={setLoading}
                setLoadingText={setLoadingText}
                setMessage={setMessage}
                setError={setError}
                reload={loadDocuments}
                loadDetails={loadDocumentDetails}
              />
            ) : tab === "system" ? (
              <SystemPanel />
            ) : (
              <ChatPanel
                sessions={sessions}
                sessionPagination={sessionPagination}
                selectedSession={selectedSession}
                range={chatRange}
                setRange={setChatRange}
                customStartDate={chatCustomStartDate}
                setCustomStartDate={setChatCustomStartDate}
                customEndDate={chatCustomEndDate}
                setCustomEndDate={setChatCustomEndDate}
                search={chatSearch}
                setSearch={setChatSearch}
                pairs={chatPairs}
                chatPagination={chatPagination}
                loadSessions={loadSessions}
                onSelect={loadChatDetail}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}