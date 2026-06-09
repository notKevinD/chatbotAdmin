"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

type Tab = "dashboard" | "rag" | "chat";
type Range = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

type Overview = {
  stats: {
    users: number;
    chats: number;
    unanswered: number;
  };
  questionSeries: Array<{ label: string; count: number }>;
  unansweredSamples: UnansweredItem[];
};

type UnansweredItem = {
  sessionId: string;
  question: string;
  answer: string;
  createdAt?: string;
};

type DocumentRow = {
  id: string;
  metadata_name: string;
  preview: string;
  raw: Record<string, unknown>;
};

type MetadataRow = {
  metadata_name: string;
  created_at?: string;
  document_count: number;
  status?: string;
  error_message?: string;
};

type DocumentsResponse = {
  mode: "metadata" | "documents";
  metadataName?: string;
  rows: Array<DocumentRow | MetadataRow>;
  pagination?: PaginationInfo;
  columns?: string[];
  idColumn?: string;
  metaColumn?: string;
};

type ChatSession = {
  sessionId: string;
  total: number;
  lastSeen?: string;
};

type ChatPair = {
  sessionId?: string;
  question: string;
  answer: string;
  category?: string;
  createdAt?: string;
};

type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type ExcelSheetPreview = {
  sheetName: string;
  totalRows: number;
  totalColumns: number;
  headers: string[];
  rows: string[][];
};

type ExcelPreview = ExcelSheetPreview & {
  fileName: string;
  sheets: ExcelSheetPreview[];
};

type ConfirmDialogState = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

type DuplicateCheckResponse = {
  duplicate: boolean;
};

const PAGE_SIZE = 10;
const UNANSWERED_PAGE_SIZE = 5;

const rangeLabel: Record<Range, string> = {
  today: "Hari Ini",
  yesterday: "Kemarin",
  this_week: "Minggu Ini",
  last_week: "Minggu Lalu",
  this_month: "Bulan Ini",
  last_month: "Bulan Lalu",
  custom: "Custom"
};

function formatIndonesianDateTime(value?: string) {
  if (!value) return "-";

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/
  );

  if (!match) return value;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const wibDate = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 1,
      Number(minute),
      Number(second)
    )
  );
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember"
  ];
  const twoDigit = (item: number) => String(item).padStart(2, "0");

  return `${days[wibDate.getUTCDay()]}, ${twoDigit(wibDate.getUTCDate())} ${
    months[wibDate.getUTCMonth()]
  } ${wibDate.getUTCFullYear()} pukul ${twoDigit(wibDate.getUTCHours())}.${twoDigit(
    wibDate.getUTCMinutes()
  )}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request gagal.");
  }
  return data;
}

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

function Dashboard({ overview, range }: { overview: Overview | null; range: Range }) {
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
    <div className="grid">
      <section className="grid stats">
        <Stat label={`Pengguna ${rangeLabel[range]}`} value={stats.users} />
        <Stat label={`Pertanyaan ${rangeLabel[range]}`} value={stats.chats} />
        <Stat label="Jawaban Bermasalah" value={stats.unanswered} />
      </section>

      <QuestionChart range={range} series={overview?.questionSeries || []} />

      <section className="panel">
        <div className="panel-head">
          <h2>Pertanyaan yang Belum Terjawab</h2>
        </div>
        {unansweredItems.length ? (
          <>
          <ul className="top-list unanswered-list">
            {visibleUnanswered.map((item, index) => (
              <li key={`${item.question}-${index}`}>
                <button className="unanswered-item" onClick={() => openSession(item)} type="button">
                  <span>
                  <strong>Q:</strong> {item.question}
                  <br />
                  <span className="muted">
                    <strong>A:</strong> {item.answer}
                  </span>
                  </span>
                  <span className="unanswered-action">Lihat percakapan</span>
                </button>
              </li>
            ))}
          </ul>
          <PaginationControls
            pagination={{
              page: unansweredPage,
              limit: UNANSWERED_PAGE_SIZE,
              total: unansweredItems.length,
              totalPages
            }}
            onPageChange={setUnansweredPage}
          />
          </>
        ) : (
          <div className="empty">Belum ada sampel jawaban bermasalah.</div>
        )}
      </section>

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
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="detail-dialog session-dialog" role="dialog">
        <div className="detail-head">
          <div>
            <span className="eyebrow">Riwayat Session</span>
            <h3>{item.sessionId}</h3>
            <p className="muted">
              Pertanyaan bermasalah: {item.question}
            </p>
          </div>
          <button aria-label="Tutup riwayat session" className="alert-close" onClick={onClose} type="button">
            x
          </button>
        </div>

        {loading ? <LoadingNotice text="Memuat seluruh percakapan session..." /> : null}
        {error ? <div className="alert error">{error}</div> : null}

        {!loading && !error ? (
          <div className="conversation-list session-conversation-list">
            {pairs.map((pair, index) => (
              <article className="conversation-card" key={`${pair.createdAt || "chat"}-${index}`}>
                <div className="conversation-time">{formatIndonesianDateTime(pair.createdAt)}</div>
                <div className="bubble user-bubble">
                  <span>Question from user</span>
                  <p>{pair.question || "-"}</p>
                </div>
                <div className="bubble bot-bubble">
                  <span>Answer from bot</span>
                  <p>{pair.answer || "-"}</p>
                </div>
              </article>
            ))}
            {!pairs.length ? <div className="empty">Tidak ada percakapan pada session ini.</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadingNotice({ text }: { text: string }) {
  return (
    <div className="loading-notice">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

function DismissibleAlert({
  kind,
  text,
  onClose
}: {
  kind: "error" | "success";
  text: string;
  onClose: () => void;
}) {
  return (
    <div className={`alert ${kind}`}>
      <span>{text}</span>
      <button aria-label="Tutup notifikasi" className="alert-close" onClick={onClose} type="button">
        x
      </button>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  loading,
  onCancel,
  onConfirm
}: {
  title: string;
  body: string;
  confirmLabel: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="confirm-dialog" role="dialog">
        <div className="confirm-icon">!</div>
        <div>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
        <div className="confirm-actions">
          <button className="button secondary" disabled={loading} onClick={onCancel} type="button">
            Batal
          </button>
          <button className="button danger" disabled={loading} onClick={onConfirm} type="button">
            {loading ? "Menghapus..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function DocumentDetailDialog({ document, onClose }: { document: DocumentRow; onClose: () => void }) {
  const raw = document.raw || {};
  const content = String(
    raw.text ?? raw.content ?? raw.pageContent ?? raw.document ?? raw.page_content ?? document.preview ?? ""
  );
  const metadata = raw.metadata ?? {
    source: document.metadata_name
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="detail-dialog" role="dialog">
        <div className="detail-head">
          <div>
            <span className="eyebrow">Detail Data</span>
            <h3>{document.metadata_name || "Data Chatbot"}</h3>
          </div>
          <button aria-label="Tutup detail data" className="alert-close" onClick={onClose} type="button">
            x
          </button>
        </div>

        <div className="detail-section">
          <h4>Isi Data</h4>
          <pre>{content || "Tidak ada konten teks di data ini."}</pre>
        </div>

        <div className="detail-section">
          <h4>Sumber Data</h4>
          <pre>{safeJson(metadata)}</pre>
        </div>
      </div>
    </div>
  );
}

function ExcelPreviewDialog({
  preview,
  duplicateWarning,
  uploadError,
  uploadMessage,
  loading,
  onCancel,
  onUpload
}: {
  preview: ExcelPreview;
  duplicateWarning: string;
  uploadError: string;
  uploadMessage: string;
  loading: boolean;
  onCancel: () => void;
  onUpload: () => void;
}) {
  const [activeSheetName, setActiveSheetName] = useState(preview.sheets[0]?.sheetName || preview.sheetName);
  const activeSheet = preview.sheets.find((sheet) => sheet.sheetName === activeSheetName) || preview.sheets[0] || preview;

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="preview-dialog" role="dialog">
        <div className="detail-head">
          <div>
            <span className="eyebrow">Preview Excel</span>
            <h3>{preview.fileName}</h3>
            <p className="muted">
              {preview.sheets.length} sheet terbaca - aktif: {activeSheet.sheetName} - {activeSheet.totalRows} baris
            </p>
          </div>
          <button aria-label="Batalkan upload" className="alert-close" disabled={loading} onClick={onCancel} type="button">
            x
          </button>
        </div>

        {duplicateWarning ? <div className="alert warning">{duplicateWarning}</div> : null}
        {uploadError ? <div className="alert error">{uploadError}</div> : null}
        {uploadMessage ? <div className="alert success">{uploadMessage}</div> : null}

        <div className="sheet-tabs" aria-label="Daftar sheet Excel">
          {preview.sheets.map((sheet) => (
            <button
              className={sheet.sheetName === activeSheet.sheetName ? "sheet-tab active" : "sheet-tab"}
              key={sheet.sheetName}
              onClick={() => setActiveSheetName(sheet.sheetName)}
              type="button"
            >
              <span>{sheet.sheetName}</span>
              <small>{sheet.totalRows} baris</small>
            </button>
          ))}
        </div>

        <div className="table-scroll preview-modal-table">
          <table>
            <thead>
              <tr>
                {activeSheet.headers.map((header, index) => (
                  <th key={`${header}-${index}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeSheet.rows.map((row, rowIndex) => (
                <tr key={`${activeSheet.sheetName}-preview-${rowIndex}`}>
                  {activeSheet.headers.map((header, columnIndex) => (
                    <td className="preview-cell" key={`${header}-${columnIndex}`}>
                      {row[columnIndex] || "-"}
                    </td>
                  ))}
                </tr>
              ))}
              {!activeSheet.rows.length ? (
                <tr>
                  <td className="empty" colSpan={Math.max(activeSheet.headers.length, 1)}>
                    Sheet ini belum punya data baris untuk dipreview.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="preview-actions">
          <div className="preview-note-inline">Preview menampilkan maksimal 10 baris pertama sebelum file dikirim ke n8n.</div>
          <div className="preview-buttons">
            <button className="button secondary" disabled={loading} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className={duplicateWarning ? "button danger" : "button"} disabled={loading} onClick={onUpload} type="button">
              {loading ? "Mengirim..." : duplicateWarning ? "Timpa & Upload" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionChart({
  range,
  series
}: {
  range: Range;
  series: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(...series.map((item) => item.count), 1);
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * (4 - index)));
  const title =
    range === "today" || range === "yesterday"
      ? "Grafik Pertanyaan per 3 Jam"
      : range === "this_week" || range === "last_week"
        ? "Grafik Pertanyaan per Hari"
        : range === "this_month" || range === "last_month"
          ? "Grafik Pertanyaan per Minggu"
        : range === "custom"
          ? "Grafik Pertanyaan Custom"
          : "Grafik Pertanyaan per Tanggal";

  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">Jumlah pertanyaan user berdasarkan filter dashboard.</p>
        </div>
      </div>
      <div className="bar-chart" aria-label={title}>
        {series.length ? (
          <div className="chart-frame">
            <div className="chart-y-axis">
              {ticks.map((tick, index) => (
                <span key={`${tick}-${index}`}>{tick}</span>
              ))}
            </div>
            <div className="chart-plot">
              <div className="chart-grid-lines">
                {ticks.map((tick, index) => (
                  <span key={`${tick}-${index}`} />
                ))}
              </div>
              <div className="chart-bars">
                {series.map((item, index) => (
                  <div className="bar-item" key={`${item.label}-${index}`}>
                    <div
                      className="bar-fill"
                      style={{ height: `${Math.max((item.count / max) * 100, item.count ? 4 : 0)}%` }}
                      title={`${item.label}: ${item.count} pertanyaan`}
                    />
                    <span className="bar-label">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">Belum ada data waktu pertanyaan untuk grafik.</div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value.toLocaleString("id-ID")}</strong>
    </article>
  );
}

function PaginationControls({
  pagination,
  onPageChange
}: {
  pagination: PaginationInfo | null;
  onPageChange: (page: number) => void;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;

  return (
    <div className="pagination">
      <span>
        Halaman {pagination.page} dari {pagination.totalPages} ({pagination.total.toLocaleString("id-ID")} data)
      </span>
      <div className="pagination-actions">
        <button
          className="button secondary"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          type="button"
        >
          Sebelumnya
        </button>
        <button
          className="button secondary"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
          type="button"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status, errorMessage }: { status?: string; errorMessage?: string }) {
  const normalized = (status || "unknown").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const label =
    normalized === "processing"
      ? "Processing"
      : normalized === "success"
        ? "Success"
        : normalized === "failed"
          ? "Failed"
          : "Belum ada status";

  return (
    <span className={`status-badge status-${normalized}`} title={errorMessage || label}>
      {label}
    </span>
  );
}

function RagPanel({
  metadataRows,
  metadataPagination,
  documents,
  documentPagination,
  selectedMetadata,
  ragSearch,
  setRagSearch,
  documentSearch,
  setDocumentSearch,
  loading,
  setLoading,
  setLoadingText,
  setMessage,
  setError,
  reload,
  loadDetails
}: {
  metadataRows: MetadataRow[];
  metadataPagination: PaginationInfo | null;
  documents: DocumentRow[];
  documentPagination: PaginationInfo | null;
  selectedMetadata: string;
  ragSearch: string;
  setRagSearch: (value: string) => void;
  documentSearch: string;
  setDocumentSearch: (value: string) => void;
  loading: boolean;
  setLoading: (value: boolean) => void;
  setLoadingText: (value: string) => void;
  setMessage: (value: string) => void;
  setError: (value: string) => void;
  reload: (page?: number) => Promise<void>;
  loadDetails: (metadataName: string, page?: number) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [excelPreview, setExcelPreview] = useState<ExcelPreview | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [uploadModalError, setUploadModalError] = useState("");
  const [uploadModalMessage, setUploadModalMessage] = useState("");
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [detailDocument, setDetailDocument] = useState<DocumentRow | null>(null);

  function clearSelectedFile() {
    setFile(null);
    setExcelPreview(null);
    setDuplicateWarning("");
    setUploadModalError("");
    setUploadModalMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function upload(mode: "reject" | "overwrite" = "reject") {
    if (!file) {
      setError("Pilih file Excel terlebih dahulu.");
      return;
    }
    if (duplicateWarning && mode !== "overwrite") {
      setConfirmDialog({
        title: "Timpa file lama?",
        body: `File "${file.name}" sudah pernah diupload. Jika dilanjutkan, data chatbot lama dari file ini akan dihapus dulu, lalu file baru diproses.`,
        confirmLabel: "Timpa & Upload",
        onConfirm: () => upload("overwrite")
      });
      return;
    }

    setLoading(true);
    setLoadingText("Mengupload file dan menunggu proses webhook n8n...");
    setError("");
    setMessage("");
    setUploadModalError("");
    setUploadModalMessage("");

    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);

    try {
      const result = await fetchJson<{ documentCount?: number }>("/api/admin/rag-upload", {
        method: "POST",
        body: form
      });
      const storedCount = result.documentCount || 0;
      const successMessage =
        mode === "overwrite"
          ? `Data lama berhasil ditimpa dan ${storedCount.toLocaleString("id-ID")} data baru terverifikasi di database.`
          : `${storedCount.toLocaleString("id-ID")} data berhasil diproses dan terverifikasi di database.`;
      setUploadModalMessage(successMessage);
      setMessage(successMessage);
      clearSelectedFile();
      await reload(1);
    } catch (err) {
      const uploadError = err instanceof Error ? err.message : "Upload gagal.";
      setUploadModalError(uploadError);
      setError(uploadError);
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  function deleteMetadata(metadataName: string) {
    setConfirmDialog({
      title: "Hapus file data?",
      body: `File data "${metadataName}" dan semua isi data terkait akan dihapus. Tindakan ini tidak bisa dibatalkan.`,
      confirmLabel: "Hapus File",
      onConfirm: () => performDeleteMetadata(metadataName)
    });
  }

  async function performDeleteMetadata(metadataName: string) {
    setError("");
    setMessage("");
    setLoading(true);
    setLoadingText("Menghapus file data dan isi terkait...");
    try {
      await fetchJson("/api/admin/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadataName })
      });
      setMessage("File data dan isi terkait berhasil dihapus.");
      await reload(metadataPagination?.page || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus file data.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setExcelPreview(null);
    setDuplicateWarning("");
    setUploadModalError("");
    setUploadModalMessage("");
    setError("");

    if (!selectedFile) return;

    try {
      setCheckingDuplicate(true);
      const duplicateData = await fetchJson<DuplicateCheckResponse>(
        `/api/admin/rag-upload?fileName=${encodeURIComponent(selectedFile.name)}`
      );
      if (duplicateData.duplicate) {
        setDuplicateWarning(
          `File "${selectedFile.name}" sudah pernah diupload. Jika dilanjutkan, data lama akan ditimpa.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengecek file data.");
    } finally {
      setCheckingDuplicate(false);
    }

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetNames = workbook.SheetNames;

      if (!sheetNames.length) {
        setError("File Excel tidak punya sheet yang bisa dibaca.");
        return;
      }

      const sheets = sheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
          header: 1,
          blankrows: false,
          defval: ""
        });
        const normalizedRows = matrix.map((row) => row.map((cell) => String(cell ?? "")));
        const totalColumns = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
        const headers =
          normalizedRows[0]?.map((cell, index) => cell.trim() || `Kolom ${index + 1}`) ||
          Array.from({ length: totalColumns }, (_, index) => `Kolom ${index + 1}`);
        const bodyRows = normalizedRows.slice(1, 11).map((row) =>
          Array.from({ length: headers.length }, (_, index) => row[index] || "")
        );

        return {
          sheetName,
          totalRows: Math.max(normalizedRows.length - 1, 0),
          totalColumns: headers.length,
          headers,
          rows: bodyRows
        };
      });
      const firstSheet = sheets[0];

      setExcelPreview({
        fileName: selectedFile.name,
        sheetName: firstSheet.sheetName,
        totalRows: firstSheet.totalRows,
        totalColumns: firstSheet.totalColumns,
        headers: firstSheet.headers,
        rows: firstSheet.rows,
        sheets
      });
    } catch {
      setError("Preview file gagal dibaca. Pastikan file berbentuk .xlsx, .xls, atau .csv.");
    }
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Upload Excel ke n8n</h2>
        </div>
        <div className="upload-row">
          <div className="field">
            <label htmlFor="file">File Excel</label>
            <input
              ref={fileInputRef}
              className="input"
              id="file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFileChange}
            />
          </div>
        </div>
        {checkingDuplicate ? <div className="inline-note">Mengecek file data...</div> : null}
        {!excelPreview && duplicateWarning ? <div className="alert warning">{duplicateWarning}</div> : null}
      </section>

      {excelPreview ? (
        <ExcelPreviewDialog
          preview={excelPreview}
          duplicateWarning={duplicateWarning}
          uploadError={uploadModalError}
          uploadMessage={uploadModalMessage}
          loading={loading}
          onCancel={clearSelectedFile}
          onUpload={upload}
        />
      ) : null}

      {excelPreview ? (
        <section className="table-wrap legacy-preview-hidden">
          <div className="table-title">
            <div>
              <h2>Preview Excel</h2>
              <p className="muted">
                {excelPreview.fileName} · Sheet {excelPreview.sheetName} · {excelPreview.totalRows} baris ·{" "}
                {excelPreview.totalColumns} kolom
              </p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {excelPreview.headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {excelPreview.rows.map((row, rowIndex) => (
                  <tr key={`preview-${rowIndex}`}>
                    {excelPreview.headers.map((header, columnIndex) => (
                      <td className="preview-cell" key={`${header}-${columnIndex}`}>
                        {row[columnIndex] || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
                {!excelPreview.rows.length ? (
                  <tr>
                    <td className="empty" colSpan={Math.max(excelPreview.headers.length, 1)}>
                      Sheet ini belum punya data baris untuk dipreview.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="preview-note">Preview menampilkan maksimal 10 baris pertama sebelum file dikirim ke n8n.</div>
        </section>
      ) : null}

      <section className="table-wrap">
        <div className="table-title">
          <h2>Daftar File Data</h2>
          <div className="table-tools">
            <input
              className="input search-input"
              placeholder="Cari nama file data..."
              value={ragSearch}
              onChange={(event) => setRagSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") reload(1);
              }}
            />
            <button className="button secondary" onClick={() => reload(1)}>
              Cari
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setRagSearch("");
                window.setTimeout(() => reload(1), 0);
              }}
            >
              Hapus Filter
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>File Data</th>
                <th>Status Upload</th>
                <th>Jumlah Data</th>
                <th>Dibuat</th>
                <th className="actions-col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {metadataRows.map((row) => (
                <tr key={row.metadata_name}>
                  <td>{row.metadata_name}</td>
                  <td>
                    <StatusBadge status={row.status} errorMessage={row.error_message} />
                  </td>
                  <td>{row.document_count}</td>
                  <td>{formatIndonesianDateTime(row.created_at)}</td>
                  <td className="actions-cell">
                    <div className="table-actions">
                      <button className="button secondary table-button" onClick={() => loadDetails(row.metadata_name, 1)}>
                      Detail
                      </button>
                      <button className="button danger table-button" onClick={() => deleteMetadata(row.metadata_name)}>
                      Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!metadataRows.length ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada file data chatbot.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <PaginationControls pagination={metadataPagination} onPageChange={(page) => reload(page)} />
      </section>

      <section className="table-wrap">
        <div className="table-title">
          <h2>{selectedMetadata ? `Isi Data: ${selectedMetadata}` : "Isi Data"}</h2>
          <div className="table-tools">
            <input
              className="input search-input"
              disabled={!selectedMetadata}
              placeholder="Cari isi data..."
              value={documentSearch}
              onChange={(event) => setDocumentSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && selectedMetadata) loadDetails(selectedMetadata, 1);
              }}
            />
            <button
              className="button secondary"
              disabled={!selectedMetadata}
              onClick={() => selectedMetadata && loadDetails(selectedMetadata, 1)}
            >
              Cari
            </button>
            <button
              className="button secondary"
              disabled={!selectedMetadata}
              onClick={() => {
                setDocumentSearch("");
                if (selectedMetadata) window.setTimeout(() => loadDetails(selectedMetadata, 1), 0);
              }}
            >
              Hapus Filter
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Isi Data</th>
                <th className="actions-col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((row) => (
                <tr key={`${row.id}-${row.metadata_name}`}>
                  <td className="truncate">{row.preview}</td>
                  <td className="actions-cell">
                    <div className="table-actions">
                      <button className="button secondary table-button" onClick={() => setDetailDocument(row)}>
                      Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!documents.length ? (
                <tr>
                  <td colSpan={2} className="empty">
                    {selectedMetadata ? "Belum ada isi data untuk file ini." : "Klik Detail pada file data untuk melihat isinya."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <PaginationControls
          pagination={documentPagination}
          onPageChange={(page) => selectedMetadata && loadDetails(selectedMetadata, page)}
        />
      </section>
      {confirmDialog ? (
        <ConfirmDialog
          title={confirmDialog.title}
          body={confirmDialog.body}
          confirmLabel={confirmDialog.confirmLabel}
          loading={confirmLoading}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={async () => {
            setConfirmLoading(true);
            try {
              await confirmDialog.onConfirm();
              setConfirmDialog(null);
            } finally {
              setConfirmLoading(false);
            }
          }}
        />
      ) : null}
      {detailDocument ? <DocumentDetailDialog document={detailDocument} onClose={() => setDetailDocument(null)} /> : null}
    </div>
  );
}

function ChatPanel({
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
  pairs,
  chatPagination,
  loadSessions,
  onSelect
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
  onSelect: (sessionId: string, page?: number) => void;
}) {
  function exportRagas() {
    const params = new URLSearchParams({ export: "ragas", range });
    if (search.trim()) params.set("q", search.trim());
    if (range === "custom") {
      if (customStartDate) params.set("startDate", customStartDate);
      if (customEndDate) params.set("endDate", customEndDate);
    }
    window.location.href = `/api/admin/chats?${params.toString()}`;
  }

  return (
    <div className="grid chat-stack">
      <section className="report-bar">
        <div className="report-row">
          <span className="report-label">Filter Riwayat Chat</span>
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
              <label htmlFor="chatStartDate">Dari tanggal</label>
              <input
                className="input date-input"
                id="chatStartDate"
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
              />
            </div>
            <div className="field compact-field">
              <label htmlFor="chatEndDate">Sampai tanggal</label>
              <input
                className="input date-input"
                id="chatEndDate"
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
              />
            </div>
            <button className="button secondary" onClick={() => loadSessions(1)} type="button">
              Terapkan
            </button>
          </div>
        ) : null}
        <div className="report-actions">
          <input
            className="input search-input"
            placeholder="Cari session, pertanyaan, atau jawaban..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") loadSessions(1);
            }}
          />
          <button className="button secondary" onClick={() => loadSessions(1)} type="button">
            Cari
          </button>
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              window.setTimeout(() => loadSessions(1), 0);
            }}
            type="button"
          >
            Hapus Filter
          </button>
          <button className="button secondary" onClick={exportRagas} type="button">
            Ekspor Data RAGAS
          </button>
        </div>
      </section>

      <section className="table-wrap">
        <div className="table-title">
          <h2>Session Pengguna</h2>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={`session-card ${selectedSession === session.sessionId ? "active" : ""}`}
              key={session.sessionId}
              onClick={() => onSelect(session.sessionId, 1)}
              type="button"
            >
              <span className="session-id">{session.sessionId}</span>
              <span className="session-meta">
                <span>{session.total} pertanyaan</span>
                <span>{formatIndonesianDateTime(session.lastSeen)}</span>
              </span>
            </button>
          ))}
          {!sessions.length ? <div className="empty">Belum ada session.</div> : null}
        </div>
        <PaginationControls pagination={sessionPagination} onPageChange={(page) => loadSessions(page)} />
      </section>

      <section className="table-wrap">
        <div className="table-title">
          <h2>{selectedSession ? `Percakapan ${selectedSession}` : "Detail Percakapan"}</h2>
        </div>
        <div className="conversation-list">
          {pairs.map((pair, index) => (
            <article className="conversation-card" key={`${pair.createdAt}-${index}`}>
              <div className="conversation-meta-line">
                <div className="conversation-time">{formatIndonesianDateTime(pair.createdAt)}</div>
                {pair.category ? <span className="category-badge">{pair.category}</span> : null}
              </div>
              <div className="bubble user-bubble">
                <span>Question from user</span>
                <p>{pair.question || "-"}</p>
              </div>
              <div className="bubble bot-bubble">
                <span>Answer from bot</span>
                <p>{pair.answer || "-"}</p>
              </div>
            </article>
          ))}
          {!pairs.length ? (
            <div className="empty">Pilih session untuk melihat percakapan.</div>
          ) : null}
        </div>
        <PaginationControls
          pagination={chatPagination}
          onPageChange={(page) => selectedSession && onSelect(selectedSession, page)}
        />
      </section>
    </div>
  );
}
