"use client";

import { useState } from "react";
import { ChatPair, ChatSession, PaginationInfo, Range } from "@/app/admin/types";
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
  const [contextPair, setContextPair] = useState<ChatPair | null>(null);

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
              </div>
              <div className="bubble user-bubble">
                <span>Question from user</span>
                <p>{pair.question || "-"}</p>
              </div>
              <div className="bubble bot-bubble">
                <span>Answer from bot</span>
                <p>{pair.answer || "-"}</p>
              </div>
              <div className="conversation-actions">
                {pair.responseTimeMs != null ? (
                  <span className="muted">Waktu respons: {Number(pair.responseTimeMs).toLocaleString("id-ID")} ms</span>
                ) : null}
                {getContextItems(pair.context).length ? (
                  <button className="button secondary compact-button" onClick={() => setContextPair(pair)} type="button">
                    Lihat Context
                  </button>
                ) : null}
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
      {contextPair ? <ContextDetailDialog pair={contextPair} onClose={() => setContextPair(null)} /> : null}
    </div>
  );
}
