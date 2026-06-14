"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatPanel } from "@/app/admin/chat-panel";
import { Dashboard } from "@/app/admin/dashboard";
import { DismissibleAlert, LoadingNotice } from "@/app/admin/shared";
import { RagPanel } from "@/app/admin/rag-panel";
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
  Tab
} from "@/app/admin/types";
import { fetchJson } from "@/app/admin/utils";

export default function AdminApp() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
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
    if (tab === "rag") return "Data Chatbot";
    return "Riwayat Chat";
  }, [tab]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>AI Agent Admin</strong>
          <span>Admin chatbot PMB</span>
        </div>
        <nav className="nav" aria-label="Menu admin">
          <button className={`nav-button ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
            Dashboard
          </button>
          <button className={`nav-button ${tab === "rag" ? "active" : ""}`} onClick={() => setTab("rag")}>
            Data Chatbot
          </button>
          <button className={`nav-button ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
            Chat
          </button>
        </nav>
          <button className="button secondary logout-button" onClick={logout}>
              Keluar
            </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="page-title">
            <h1>{title}</h1>
            <p className="muted">Database chatbot, webhook n8n, dan chat memory dalam satu panel.</p>
          </div>
        </header>

        {tab === "dashboard" ? (
          <div className="report-bar">
            <div className="report-row">
              <span className="report-label">Periode laporan</span>
              <div className="report-pills">
                {[
                  ["today", "Hari ini"],
                  ["yesterday", "Kemarin"],
                  ["this_week", "Minggu ini"],
                  ["last_week", "Minggu lalu"],
                  ["this_month", "Bulan ini"],
                  ["last_month", "Bulan lalu"],
                  ["custom", "Custom"]
                ].map(([value, label]) => (
                  <button
                    className={`report-pill ${range === value ? "active" : ""}`}
                    key={value}
                    onClick={() => setRange(value as Range)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
              {range === "custom" ? (
              <div className="custom-date-panel">
                <div className="field compact-field">
                  <label htmlFor="customStartDate">Dari tanggal</label>
                  <input
                    className="input date-input"
                    id="customStartDate"
                    type="date"
                    value={customStartDate}
                    onChange={(event) => setCustomStartDate(event.target.value)}
                  />
                </div>
                <div className="field compact-field">
                  <label htmlFor="customEndDate">Sampai tanggal</label>
                  <input
                    className="input date-input"
                    id="customEndDate"
                    type="date"
                    value={customEndDate}
                    onChange={(event) => setCustomEndDate(event.target.value)}
                  />
                </div>
                <button className="button secondary" onClick={loadOverview} type="button">
                  Terapkan
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <DismissibleAlert kind="error" text={error} onClose={() => setError("")} /> : null}
        {message ? <DismissibleAlert kind="success" text={message} onClose={() => setMessage("")} /> : null}
        {loading && loadingText ? <LoadingNotice text={loadingText} /> : null}

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
      </main>
    </div>
  );
}
