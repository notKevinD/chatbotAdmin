"use client";

import { ChangeEvent, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ConfirmDialogState,
  DocumentRow,
  DuplicateCheckResponse,
  ExcelPreview,
  MetadataRow,
  PaginationInfo
} from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime } from "@/app/admin/utils";
import {
  ConfirmDialog,
  DocumentDetailDialog,
  ExcelPreviewDialog,
  PaginationControls,
  StatusBadge
} from "@/app/admin/shared";

export function RagPanel({
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
