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
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" role="presentation">
      <div aria-modal="true" className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden border border-slate-200" role="dialog">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Retrieval Context</span>
            <h3 className="text-base font-bold text-slate-800">Context yang digunakan chatbot</h3>
            <p className="text-xs text-slate-400 mt-0.5">{contexts.length} konteks referensi ditemukan.</p>
          </div>
          <button aria-label="Tutup detail context" className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/30">
          {contexts.map((context, index) => (
            <article className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-3" key={`${pair.id || "context"}-${index}`}>
              <div className="text-xs font-bold text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded w-max">Konteks #{index + 1}</div>
              <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed break-words bg-slate-50 p-3 border border-slate-100 rounded-md">{context.content}</pre>
              {context.metadata != null ? (
                <details className="text-xs group">
                  <summary className="font-semibold text-slate-500 cursor-pointer hover:text-slate-800 select-none flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
                    Metadata Sumber
                  </summary>
                  <pre className="mt-2 bg-slate-900 text-slate-200 font-mono p-3 rounded-md text-[11px] overflow-x-auto leading-normal shadow-inner">{JSON.stringify(context.metadata, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          ))}
          {!contexts.length ? <div className="p-12 text-center text-sm text-slate-400">Context tidak tersedia.</div> : null}
        </div>
      </div>
    </div>
  );
}

export function LoadingNotice({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 gap-3">
      <span className="w-8 h-8 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      <span className="text-sm font-medium text-slate-500">{text}</span>
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
    <div className={`p-4 rounded-lg flex justify-between items-center text-sm border ${
      kind === "error" 
        ? "bg-rose-50 border-rose-200 text-rose-700" 
        : "bg-emerald-50 border-emerald-200 text-emerald-700"
    }`}>
      <span>{text}</span>
      <button aria-label="Tutup notifikasi" className="text-lg font-bold opacity-60 hover:opacity-100 px-1" onClick={onClose} type="button">
        ×
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
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" role="presentation">
      <div aria-modal="true" className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-slate-200 flex gap-4" role="dialog">
        <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 text-rose-600 font-bold flex items-center justify-center text-lg shrink-0">!</div>
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">{body}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button className="px-3.5 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-all" disabled={loading} onClick={onCancel} type="button">
              Batal
            </button>
            <button className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all" disabled={loading} onClick={onConfirm} type="button">
              {loading ? "Memproses..." : confirmLabel}
            </button>
          </div>
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
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" role="presentation">
      <div aria-modal="true" className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden border border-slate-200" role="dialog">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Dokumen Fragmen</span>
            <h3 className="text-base font-bold text-slate-800 truncate max-w-xl">{document.metadata_name || "Data Chatbot"}</h3>
          </div>
          <button aria-label="Tutup detail data" className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/30">
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Isi Data Segmen</h4>
            <div className="bg-white border border-slate-200 text-sm text-slate-700 rounded-xl p-4 shadow-sm whitespace-pre-wrap leading-relaxed">
              {content || "Tidak ada konten teks di data ini."}
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Metadata Sumber terindeks</h4>
            <pre className="bg-slate-900 text-slate-200 font-mono p-4 rounded-xl text-xs overflow-x-auto shadow-inner leading-normal">{safeJson(metadata)}</pre>
          </div>
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
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" role="presentation">
      <div aria-modal="true" className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-slate-200" role="dialog">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Alur Validasi Berkas</span>
            <h3 className="text-base font-bold text-slate-800">{preview.fileName}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {preview.sheets.length} sheet terbaca — aktif: <span className="text-slate-700 font-medium">"{activeSheet.sheetName}"</span> ({activeSheet.totalRows} baris)
            </p>
          </div>
          <button aria-label="Batalkan upload" className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1" disabled={loading} onClick={onCancel} type="button">
            ×
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 shrink-0 space-y-2 bg-white">
          {duplicateWarning ? <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg font-medium">{duplicateWarning}</div> : null}
          {uploadError ? <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg font-medium">{uploadError}</div> : null}
          {uploadMessage ? <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-lg font-medium">{uploadMessage}</div> : null}

          <div className="flex gap-1 overflow-x-auto pb-1" aria-label="Daftar sheet Excel">
            {preview.sheets.map((sheet) => (
              <button
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                  sheet.sheetName === activeSheet.sheetName
                    ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
                key={sheet.sheetName}
                onClick={() => setActiveSheetName(sheet.sheetName)}
                type="button"
              >
                <span>{sheet.sheetName}</span>
                <span className={`px-1 rounded text-[10px] ${sheet.sheetName === activeSheet.sheetName ? "bg-indigo-700 text-indigo-100" : "bg-slate-200 text-slate-500"}`}>{sheet.totalRows}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 bg-slate-50/40">
          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                  {activeSheet.headers.map((header, index) => (
                    <th className="p-3" key={`${header}-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                {activeSheet.rows.map((row, rowIndex) => (
                  <tr key={`${activeSheet.sheetName}-preview-${rowIndex}`} className="hover:bg-slate-50/50">
                    {activeSheet.headers.map((header, columnIndex) => (
                      <td className="p-3 max-w-sm truncate" key={`${header}-${columnIndex}`}>
                        {row[columnIndex] || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
                {!activeSheet.rows.length ? (
                  <tr>
                    <td className="p-8 text-center text-slate-400" colSpan={Math.max(activeSheet.headers.length, 1)}>
                      Sheet ini belum punya data baris untuk dipreview.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
          <div className="text-[11px] text-slate-400 font-medium">Preview menampilkan maksimal 10 baris pertama sebelum file dikirim ke n8n.</div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button className="flex-1 sm:flex-initial px-4 py-2 border border-slate-200 rounded-lg text-slate-700 text-sm font-semibold bg-white hover:bg-slate-50 transition-all" disabled={loading} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className={`flex-1 sm:flex-initial px-4 py-2 text-white rounded-lg text-sm font-semibold shadow-sm transition-all ${duplicateWarning ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"}`} disabled={loading} onClick={onUpload} type="button">
              {loading ? "Mengirim..." : duplicateWarning ? "Timpa & Upload" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QuestionChart({
  granularity,
  range,
  series
}: {
  granularity?: "three_hour" | "day" | "week" | "month";
  range: Range;
  series: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(...series.map((item) => item.count), 1);
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * (4 - index)));
  const granularityTitle =
    granularity === "three_hour"
      ? "Grafik Tren Aktivitas Pertanyaan"
      : granularity === "day"
        ? "Grafik Pertanyaan per Hari"
        : granularity === "week"
          ? "Grafik Pertanyaan per Minggu"
          : granularity === "month"
            ? "Grafik Pertanyaan per Bulan"
            : undefined;

  const title =
    granularityTitle ||
    (range === "today" || range === "yesterday"
      ? "Grafik Tren Aktivitas Pertanyaan"
      : range === "this_week" || range === "last_week"
        ? "Grafik Pertanyaan per Hari"
        : range === "this_month" || range === "last_month"
          ? "Grafik Pertanyaan per Minggu"
          : range === "this_year" || range === "all"
            ? "Grafik Pertanyaan per Bulan"
            : range === "custom"
              ? "Grafik Pertanyaan Custom"
              : "Grafik Pertanyaan per Tanggal");

  return (
    <section className="p-5 bg-white">
      <div className="mb-6">
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400 mt-0.5">Jumlah pertanyaan user berdasarkan filter dashboard.</p>
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
                      className="bar-fill bg-indigo-600 rounded-t-sm hover:bg-indigo-700 transition-colors"
                      style={{ height: `${Math.max((item.count / max) * 100, item.count ? 4 : 0)}%` }}
                      title={`${item.label}: ${item.count} pertanyaan`}
                    />
                    <span className="bar-label truncate text-[10px] text-slate-400 font-medium mt-1.5">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl">Belum ada data waktu pertanyaan untuk grafik.</div>
        )}
      </div>
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{label}</span>
      <strong className="text-3xl font-black text-slate-800 tracking-tight">{value.toLocaleString("id-ID")}</strong>
    </div>
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
    <div className="flex flex-col sm:flex-row justify-between items-center gap-3 w-full text-xs text-slate-500 font-medium">
      <span>
        Halaman <span className="text-slate-700 font-semibold">{pagination.page}</span> dari <span className="text-slate-700 font-semibold">{pagination.totalPages}</span> ({pagination.total.toLocaleString("id-ID")} data)
      </span>
      <div className="flex items-center gap-1.5 w-full sm:w-auto">
        <button
          className="flex-1 sm:flex-initial px-3 py-1.5 border border-slate-200 rounded-md bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-all shadow-sm"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          type="button"
        >
          Sebelumnya
        </button>
        <button
          className="flex-1 sm:flex-initial px-3 py-1.5 border border-slate-200 rounded-md bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-all shadow-sm"
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
  const config = 
    normalized === "success" 
      ? { label: "Success", styles: "bg-emerald-50 border-emerald-200 text-emerald-700" }
      : normalized === "processing"
      ? { label: "Processing", styles: "bg-indigo-50 border-indigo-200 text-indigo-700 animate-pulse" }
      : normalized === "failed"
      ? { label: "Failed", styles: "bg-rose-50 border-rose-200 text-rose-700" }
      : { label: "Unknown", styles: "bg-slate-100 border-slate-200 text-slate-600" };

  return (
    <span 
      className={`inline-flex items-center px-2.5 py-0.5 border text-xs font-semibold rounded-md ${config.styles}`} 
      title={errorMessage || config.label}
    >
      {config.label}
    </span>
  );
}