"use client";

import { useState } from "react";
import {
  ChatPair,
  DocumentRow,
  ExcelPreview,
  PaginationInfo,
  Range
} from "@/app/admin/types";
import { getContextItems } from "@/app/admin/utils";

export function ContextDetailDialog({ pair, onClose }: { pair: ChatPair; onClose: () => void }) {
  const contexts = getContextItems(pair.context);

  return (
    <div className="modal-backdrop nested-modal" role="presentation">
      <div aria-modal="true" className="detail-dialog context-dialog" role="dialog">
        <div className="detail-head">
          <div>
            <span className="eyebrow">Retrieval Context</span>
            <h3>Context yang digunakan chatbot</h3>
            <p className="muted">{contexts.length} context ditemukan.</p>
          </div>
          <button aria-label="Tutup detail context" className="alert-close" onClick={onClose} type="button">
            x
          </button>
        </div>
        <div className="context-list">
          {contexts.map((context, index) => (
            <article className="context-card" key={`${pair.id || "context"}-${index}`}>
              <div className="context-number">Context {index + 1}</div>
              <pre>{context.content}</pre>
              {context.metadata != null ? (
                <details>
                  <summary>Metadata sumber</summary>
                  <pre>{JSON.stringify(context.metadata, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          ))}
          {!contexts.length ? <div className="empty">Context tidak tersedia.</div> : null}
        </div>
      </div>
    </div>
  );
}

export function LoadingNotice({ text }: { text: string }) {
  return (
    <div className="loading-notice">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function DismissibleAlert({
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

export function ConfirmDialog({
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

export function DocumentDetailDialog({ document, onClose }: { document: DocumentRow; onClose: () => void }) {
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

export function ExcelPreviewDialog({
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

export function QuestionChart({
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
          : range === "this_year" || range === "all"
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

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value.toLocaleString("id-ID")}</strong>
    </article>
  );
}

export function PaginationControls({
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

export function StatusBadge({ status, errorMessage }: { status?: string; errorMessage?: string }) {
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
