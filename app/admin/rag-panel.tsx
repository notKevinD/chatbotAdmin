"use client";

import { ChangeEvent, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ConfirmDialogState,
  DocumentRow,
  DuplicateCheckResponse,
  ExcelPreview,
  MetadataRow,
  PaginationInfo,
} from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime } from "@/app/admin/utils";
import {
  ConfirmDialog,
  DocumentDetailDialog,
  ExcelPreviewDialog,
  PaginationControls,
  StatusBadge,
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
  loadDetails,
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
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [detailDocument, setDetailDocument] = useState<DocumentRow | null>(
    null,
  );

  // State baru untuk penanganan Modal Dialog Pop-up
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedChunkForEdit, setSelectedChunkForEdit] =
    useState<DocumentRow | null>(null);

  // Form Field States
  const [targetMetadata, setTargetMetadata] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [submittingModal, setSubmittingModal] = useState(false);

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

  // Ekspor Basis Data dari PostgreSQL ke Excel
  function downloadMetadata(metadataName: string) {
    const params = new URLSearchParams({ file: metadataName });
    window.location.href = `/api/admin/documents?${params.toString()}`;
  }

  // Tambah Chunk Data Baru secara Manual ke DB & n8n
  async function handleCreateManualChunk(e: React.FormEvent) {
    e.preventDefault();
    if (!targetMetadata || !newQuestion.trim() || !newAnswer.trim()) return;

    setSubmittingModal(true);
    setError("");
    setMessage("");
    const fullText = `Pertanyaan: ${newQuestion.trim()}\nJawaban: ${newAnswer.trim()}`;

    try {
      await fetchJson("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadataName: targetMetadata,
          text: fullText,
          sheet: "Manual_Added",
        }),
      });

      setMessage("Data pengetahuan baru berhasil ditambahkan secara manual.");
      setNewQuestion("");
      setNewAnswer("");
      setIsAddModalOpen(false);

      await reload(metadataPagination?.page || 1);
      if (selectedMetadata === targetMetadata) {
        await loadDetails(selectedMetadata, documentPagination?.page || 1);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal menambahkan data. Pastikan workflow n8n aktif dan dapat diakses.",
      );
    } finally {
      setSubmittingModal(false);
    }
  }

  // Edit Segmen Chunk Data & Update Embedding Vector Store via n8n
  async function handleUpdateManualChunk(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChunkForEdit || !editQuestion.trim() || !editAnswer.trim())
      return;

    setSubmittingModal(true);
    setError("");
    setMessage("");
    const fullText = `Pertanyaan: ${editQuestion.trim()}\nJawaban: ${editAnswer.trim()}`;

    try {
      const originalSheet =
        (selectedChunkForEdit.raw as any)?.metadata?.sheet ||
        (selectedChunkForEdit.raw as any)?.metadata?.["sheet"] ||
        "Manual_Edited";

      await fetchJson("/api/admin/documents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedChunkForEdit.id,
          text: fullText,
          metadataName: selectedChunkForEdit.metadata_name,
          sheet: originalSheet,
        }),
      });

      setMessage("Segmen chunk data berhasil diperbarui.");
      setIsEditModalOpen(false);
      await loadDetails(selectedMetadata, documentPagination?.page || 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memperbarui chunk. Pastikan workflow n8n aktif dan dapat diakses.",
      );
    } finally {
      setSubmittingModal(false);
    }
  }

  // Hapus Segmen Chunk Permanen via n8n
  function deleteDocumentChunk(row: DocumentRow) {
    setConfirmDialog({
      title: "Hapus segmen chunk?",
      body: "Segmen chunk knowledge ini akan dihapus secara permanen dari basis pengetahuan AI Vector DB. Tindakan ini tidak dapat dibatalkan.",
      confirmLabel: "Hapus Chunk",
      onConfirm: async () => {
        setError("");
        setMessage("");
        setLoading(true);
        setLoadingText("Menghapus segmen data...");
        try {
          await fetchJson(
            `/api/admin/documents?id=${encodeURIComponent(row.id)}&metadataName=${encodeURIComponent(row.metadata_name)}`,
            {
              method: "DELETE",
            },
          );
          setMessage("Segmen data chunk berhasil dihapus.");
          await loadDetails(selectedMetadata, documentPagination?.page || 1);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Gagal menghapus chunk.",
          );
        } finally {
          setLoading(false);
          setLoadingText("");
        }
      },
    });
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
        onConfirm: () => upload("overwrite"),
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
      const result = await fetchJson<{ documentCount?: number }>(
        "/api/admin/rag-upload",
        {
          method: "POST",
          body: form,
        },
      );
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
      onConfirm: () => performDeleteMetadata(metadataName),
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
        body: JSON.stringify({ metadataName }),
      });
      setMessage("File data dan isi terkait berhasil dihapus.");
      await reload(metadataPagination?.page || 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menghapus file data.",
      );
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
        `/api/admin/rag-upload?fileName=${encodeURIComponent(selectedFile.name)}`,
      );
      if (duplicateData.duplicate) {
        setDuplicateWarning(
          `File "${selectedFile.name}" sudah pernah diupload. Jika dilanjutkan, data lama akan ditimpa.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal mengecek file data.",
      );
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
        const matrix = XLSX.utils.sheet_to_json<
          Array<string | number | boolean | null>
        >(sheet, {
          header: 1,
          blankrows: false,
          defval: "",
        });
        const normalizedRows = matrix.map((row) =>
          row.map((cell) => String(cell ?? "")),
        );
        const totalColumns = normalizedRows.reduce(
          (max, row) => Math.max(max, row.length),
          0,
        );
        const headers =
          normalizedRows[0]?.map(
            (cell, index) => cell.trim() || `Kolom ${index + 1}`,
          ) ||
          Array.from(
            { length: totalColumns },
            (_, index) => `Kolom ${index + 1}`,
          );
        const bodyRows = normalizedRows
          .slice(1, 11)
          .map((row) =>
            Array.from(
              { length: headers.length },
              (_, index) => row[index] || "",
            ),
          );

        return {
          sheetName,
          totalRows: Math.max(normalizedRows.length - 1, 0),
          totalColumns: headers.length,
          headers,
          rows: bodyRows,
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
        sheets,
      });
    } catch {
      setError(
        "Preview file gagal dibaca. Pastikan file berbentuk .xlsx, .xls, atau .csv.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* SECTION 1: UPLOAD AREA */}
      <section className="panel bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="panel-head border-b border-slate-100 pb-3 mb-4">
          <h2 className="text-base font-bold text-slate-800">
            Upload Excel ke n8n
          </h2>
        </div>
        <div className="upload-row">
          <div className="field flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold text-slate-600"
              htmlFor="file"
            >
              File Excel
            </label>
            <input
              ref={fileInputRef}
              className="input border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
              id="file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFileChange}
            />
          </div>
        </div>
        {checkingDuplicate ? (
          <div className="inline-note text-xs text-indigo-600 mt-2 font-medium">
            Mengecek berkas duplikasi...
          </div>
        ) : null}
        {!excelPreview && duplicateWarning ? (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs mt-3">
            {duplicateWarning}
          </div>
        ) : null}
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

      {/* SECTION 2: FILE PREVIEW */}
      {excelPreview ? (
        <section className="table-wrap legacy-preview-hidden bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <h2>Preview Excel</h2>
            <p className="muted text-xs text-slate-500">
              {excelPreview.fileName} · Sheet {excelPreview.sheetName} ·{" "}
              {excelPreview.totalRows} baris · {excelPreview.totalColumns} kolom
            </p>
          </div>
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                  {excelPreview.headers.map((header, index) => (
                    <th
                      className="p-3 font-semibold"
                      key={`${header}-${index}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                {excelPreview.rows.map((row, rowIndex) => (
                  <tr key={`preview-${rowIndex}`}>
                    {excelPreview.headers.map((header, columnIndex) => (
                      <td
                        className="p-3 truncate max-w-xs"
                        key={`${header}-${columnIndex}`}
                      >
                        {row[columnIndex] || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
                {!excelPreview.rows.length ? (
                  <tr>
                    <td
                      className="p-6 text-center text-slate-400"
                      colSpan={Math.max(excelPreview.headers.length, 1)}
                    >
                      Sheet ini belum punya data baris untuk dipreview.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 text-[11px] text-slate-400 border-t border-slate-100">
            Preview menampilkan maksimal 10 baris pertama sebelum file dikirim
            ke n8n.
          </div>
        </section>
      ) : null}

      {/* SECTION 3: DAFTAR BERKAS METADATA KNOWLEDGE */}
      <section className="table-wrap bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Daftar File Data
            </h2>
            <p className="text-xs text-slate-500">
              Kelola kumpulan file basis pengetahuan AI.
            </p>
          </div>
          <div className="table-tools flex flex-wrap gap-2 items-center">
            <input
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white text-slate-800 placeholder-slate-400 focus:outline-indigo-600"
              placeholder="Cari nama file..."
              value={ragSearch}
              onChange={(event) => setRagSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") reload(1);
              }}
            />
            <button
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs rounded-lg shadow-sm"
              onClick={() => reload(1)}
            >
              Cari
            </button>
            <button
              className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg"
              onClick={() => {
                setRagSearch("");
                window.setTimeout(() => reload(1), 0);
              }}
            >
              Reset
            </button>
            <button
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm flex items-center gap-1"
              onClick={() => {
                if (selectedMetadata) setTargetMetadata(selectedMetadata);
                setIsAddModalOpen(true);
              }}
            >
              + Tambah Chunk
            </button>
          </div>
        </div>
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3">File Data</th>
                <th className="p-3">Status Upload</th>
                <th className="p-3">Jumlah Data</th>
                <th className="p-3">Dibuat</th>
                <th className="p-3 text-right" style={{ width: "240px" }}>
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-600">
              {metadataRows.map((row) => (
                <tr
                  key={row.metadata_name}
                  className="hover:bg-slate-50/40 transition-all"
                >
                  <td className="p-3 font-medium text-slate-800">
                    {row.metadata_name}
                  </td>
                  <td className="p-3">
                    <StatusBadge
                      status={row.status}
                      errorMessage={row.error_message}
                    />
                  </td>
                  <td className="p-3">{row.document_count} chunks</td>
                  <td className="p-3 text-xs">
                    {formatIndonesianDateTime(row.created_at)}
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <button
                      className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                      onClick={() => loadDetails(row.metadata_name, 1)}
                    >
                      Detail
                    </button>
                    <button
                      className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                      onClick={() => downloadMetadata(row.metadata_name)}
                    >
                      Unduh
                    </button>
                    <button
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100/70"
                      onClick={() => deleteMetadata(row.metadata_name)}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
              {!metadataRows.length ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    Belum ada file data chatbot.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50/30">
          <PaginationControls
            pagination={metadataPagination}
            onPageChange={(page) => reload(page)}
          />
        </div>
      </section>

      {/* SECTION 4: ISI CHUNK DATA DARI FILE YANG DIPILIH */}
      <section className="table-wrap bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {selectedMetadata ? `Isi Data: ${selectedMetadata}` : "Isi Data"}
            </h2>
            <p className="text-xs text-slate-500">
              Tinjau segmen fragmen chunk vector yang diindeks oleh mesin AI.
            </p>
          </div>
          <div className="table-tools flex gap-2 items-center">
            <input
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white text-slate-800 placeholder-slate-400 focus:outline-indigo-600 disabled:opacity-50"
              disabled={!selectedMetadata}
              placeholder="Cari teks isi data..."
              value={documentSearch}
              onChange={(event) => setDocumentSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && selectedMetadata)
                  loadDetails(selectedMetadata, 1);
              }}
            />
            <button
              className="px-3 py-1.5 bg-slate-800 text-white font-medium text-xs rounded-lg disabled:opacity-50"
              disabled={!selectedMetadata}
              onClick={() =>
                selectedMetadata && loadDetails(selectedMetadata, 1)
              }
            >
              Cari
            </button>
            <button
              className="px-3 py-1.5 border border-slate-200 bg-white text-slate-600 text-xs font-medium rounded-lg disabled:opacity-50"
              disabled={!selectedMetadata}
              onClick={() => {
                setDocumentSearch("");
                if (selectedMetadata)
                  window.setTimeout(() => loadDetails(selectedMetadata, 1), 0);
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3">Isi Data Segmen</th>
                <th className="p-3 text-right" style={{ width: "200px" }}>
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-600">
              {documents.map((row) => (
                <tr
                  key={`${row.id}-${row.metadata_name}`}
                  className="hover:bg-slate-50/40 transition-all"
                >
                  <td
                    className="p-3 leading-relaxed break-words"
                    style={{ whiteSpace: "normal" }}
                  >
                    {row.preview}
                  </td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap align-middle">
                    <button
                      className="px-2 py-1 text-xs font-semibold rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                      onClick={() => setDetailDocument(row)}
                    >
                      Detail
                    </button>
                    <button
                      className="px-2 py-1 text-xs font-semibold rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                      onClick={() => {
                        setSelectedChunkForEdit(row);
                        const textContent = String(
                          row.raw?.text || row.preview || "",
                        );
                        const qMatch = textContent.match(
                          /Pertanyaan:\s*([\s\S]*?)(?=\nJawaban:|$)/,
                        );
                        const aMatch =
                          textContent.match(/Jawaban:\s*([\s\S]*)/);

                        setEditQuestion(
                          qMatch ? qMatch[1].trim() : textContent,
                        );
                        setEditAnswer(aMatch ? aMatch[1].trim() : "");
                        setIsEditModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="px-2 py-1 text-xs font-semibold rounded bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100/70"
                      onClick={() => deleteDocumentChunk(row)}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
              {!documents.length ? (
                <tr>
                  <td colSpan={2} className="p-8 text-center text-slate-400">
                    {selectedMetadata
                      ? "Belum ada isi data untuk file ini."
                      : "Klik Detail pada file data untuk melihat isinya."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50/30">
          <PaginationControls
            pagination={documentPagination}
            onPageChange={(page) =>
              selectedMetadata && loadDetails(selectedMetadata, page)
            }
          />
        </div>
      </section>

      {/* ========================================== */}
      {/* POP-UP 1: MODAL TAMBAH DATA CHUNK MANUAL    */}
      {/* ========================================== */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            aria-modal="true"
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200"
            role="dialog"
          >
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                  Basis Pengetahuan
                </span>
                <h3 className="text-base font-bold text-slate-800">
                  Tambah Data Secara Manual
                </h3>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1 leading-none"
                onClick={() => setIsAddModalOpen(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateManualChunk} className="p-6 space-y-4">
              <div className="field flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Pilih Target Berkas (Metadata)
                </label>
                <select
                  className="w-full border border-slate-300 bg-white text-slate-800 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  value={targetMetadata}
                  onChange={(e) => setTargetMetadata(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    -- Pilih Berkas Tujuan --
                  </option>
                  {metadataRows.map((row) => (
                    <option key={row.metadata_name} value={row.metadata_name}>
                      {row.metadata_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Pertanyaan
                </label>
                <textarea
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                  placeholder="Ketik pertanyaan RAG..."
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  required
                />
              </div>

              <div className="field flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Jawaban
                </label>
                <textarea
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                  placeholder="Ketik jawaban RAG..."
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-sm"
                >
                  {submittingModal ? "Menunggu balasan n8n..." : "Simpan & Embed"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* POP-UP 2: MODAL EDIT CHUNK KNOWLEDGE DATA  */}
      {/* ========================================== */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            aria-modal="true"
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200"
            role="dialog"
          >
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
                  Perbarui Data
                </span>
                <h3 className="text-base font-bold text-slate-800">
                  Edit Segmen Chunk Knowledge
                </h3>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1 leading-none"
                onClick={() => setIsEditModalOpen(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateManualChunk} className="p-6 space-y-4">
              <div className="field flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-400">
                  ID Chunk Terdaftar
                </label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 text-slate-400 rounded-lg p-2 text-xs font-mono"
                  value={selectedChunkForEdit?.id || ""}
                  disabled
                />
              </div>

              <div className="field flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Pertanyaan
                </label>
                <textarea
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                  value={editQuestion}
                  onChange={(e) => setEditQuestion(e.target.value)}
                  required
                />
              </div>

              <div className="field flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Jawaban
                </label>
                <textarea
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-800"
                  value={editAnswer}
                  onChange={(e) => setEditAnswer(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold shadow-sm"
                >
                  {submittingModal ? "Menunggu balasan n8n..." : "Simpan Perubahan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
      {detailDocument ? (
        <DocumentDetailDialog
          document={detailDocument}
          onClose={() => setDetailDocument(null)}
        />
      ) : null}
    </div>
  );
}