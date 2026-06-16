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
    <div className="grid">
      <section className="grid stats">
        <Stat label={`Pengguna ${rangeLabel[range]}`} value={stats.users} />
        <Stat label={`Pertanyaan ${rangeLabel[range]}`} value={stats.chats} />
        <Stat label="Jawaban Bermasalah" value={stats.unanswered} />
      </section>

      <QuestionChart range={range} series={overview?.questionSeries || []} />

      <section className="panel">
        <div className="panel-head">
          <h2>Jawaban Bermasalah</h2>
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
  const [contextPair, setContextPair] = useState<ChatPair | null>(null);

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
                <div className="conversation-meta-line">
                  <div className="conversation-time">{formatIndonesianDateTime(pair.createdAt)}</div>
                  {pair.isFallback ? <span className="status-badge status-failed">Jawaban bermasalah</span> : null}
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
            {!pairs.length ? <div className="empty">Tidak ada percakapan pada session ini.</div> : null}
          </div>
        ) : null}
        {contextPair ? <ContextDetailDialog pair={contextPair} onClose={() => setContextPair(null)} /> : null}
      </div>
    </div>
  );
}
