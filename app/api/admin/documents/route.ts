import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  formatDbError,
  getColumns,
  pickColumn,
  quoteIdent,
  rowsToJsonExpression,
  withClient,
} from "@/lib/db";
import * as XLSX from "xlsx";

// Helper internal untuk mengonversi data context ke teks bersih
function extractTextFromRaw(rawMeta: any, previewText: string): { question: string; answer: string } {
  const textContent = String(rawMeta?.text || rawMeta?.pageContent || rawMeta?.content || previewText || "");
  const qMatch = textContent.match(/Pertanyaan:\s*([\s\S]*?)(?=\nJawaban:|$)/);
  const aMatch = textContent.match(/Jawaban:\s*([\s\S]*)/);

  return {
    question: qMatch ? qMatch[1].trim() : textContent,
    answer: aMatch ? aMatch[1].trim() : ""
  };
}

// ========================================================
// KONTRAK WEBHOOK N8N TUNGGAL UNTUK SEMUA MUTASI (CREATE/UPDATE/DELETE)
// ========================================================
// Semua operasi tulis (tambah, edit, hapus chunk, hapus file) dikirim ke SATU
// webhook n8n (env: N8N_RAG_CRUD_WEBHOOK). n8n bertanggung jawab untuk:
//   1. Generate embedding (OpenAI text-embedding-3-small) untuk create/update
//   2. Insert/update/delete langsung ke tabel `documents` (dan `metadata_table`
//      untuk delete_metadata)
//   3. Menjalankan `ANALYZE documents;` setelah mutasi selesai
//   4. Membalas JSON: { "success": true, "id"?: string, "deleted"?: number }
//      atau { "success": false, "error": string } jika gagal
//
// Body yang dikirim Next.js ke n8n selalu punya field "eventType":
//   - "create_chunk"    { eventType, metadataName, text, sheet }
//   - "update_chunk"    { eventType, id, text, metadataName }
//   - "delete_chunk"    { eventType, id, metadataName }
//   - "delete_metadata" { eventType, metadataName }
// ========================================================

type N8nCrudResult = {
  success?: boolean;
  id?: string;
  deleted?: number;
  error?: string;
};

async function callN8nCrudWebhook(payload: Record<string, unknown>): Promise<N8nCrudResult> {
  const webhookUrl = process.env.N8N_RAG_CRUD_WEBHOOK;
  if (!webhookUrl) {
    throw new Error("N8N_RAG_CRUD_WEBHOOK belum diatur di environment.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let parsed: N8nCrudResult = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok || parsed.success === false) {
    throw new Error(parsed.error || `Webhook n8n gagal (status ${response.status}).`);
  }

  return parsed;
}

// ========================================================
// 1. GET: MENAMPILKAN DATA (METADATA/CHUNKS) & EKSPOR EXCEL
// (tidak berubah — tetap baca langsung dari Postgres, ini operasi baca saja)
// ========================================================
export async function GET(request: Request) {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const selectedMetadata = url.searchParams.get("metadata");
  const fileToExport = url.searchParams.get("file");
  const search = (url.searchParams.get("q") || "").trim();
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 100);
  const offset = (page - 1) * limit;

  try {
    const data = await withClient(async (client) => {
      const info = await getColumns(client, "documents");
      const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
      const metaColumn = pickColumn(info.columns, ["metadata"]);
      const contentColumn = pickColumn(info.columns, ["content", "pageContent", "text", "document"]);

      const metadataInfo = await getColumns(client, "metadata_table");
      const metadataNameColumn = pickColumn(metadataInfo.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);
      const metadataCreatedColumn = pickColumn(metadataInfo.columns, ["created_at", "createdAt", "date"]);
      const metadataStatusColumn = pickColumn(metadataInfo.columns, ["status", "upload_status"]);
      const metadataErrorColumn = pickColumn(metadataInfo.columns, ["error_message", "errorMessage", "last_error"]);

      if (!metadataNameColumn) {
        throw new Error("Kolom metadata_name tidak ditemukan di metadata_table.");
      }

      const metadataNameExpression =
        metaColumn === "metadata"
          ? `coalesce(d.metadata->>'metadata_name', d.metadata->>'metadataName', d.metadata->'source'->>'source', d.metadata->>'source', d.metadata->>'fileName', 'Tanpa metadata')`
          : "'Tanpa metadata'";

      // --------------------------------------------------------
      // SUB-LOGIKA A: JIKA USER MEMINTA UNDUH (EKSPOR MULTI-SHEET)
      // --------------------------------------------------------
      if (fileToExport) {
        const queryResult = await client.query(
          `
            select
              ${idColumn ? `d.${quoteIdent(idColumn)}::text` : "null"} as id,
              ${contentColumn ? `d.${quoteIdent(contentColumn)}::text` : "''"} as text_content,
              ${metaColumn ? `d.${quoteIdent(metaColumn)}` : "null"} as metadata_raw
            from ${info.table.sql} d
            where lower(${metadataNameExpression}) = lower($1::text)
            order by ${idColumn ? `d.${quoteIdent(idColumn)}` : "1"} asc
          `,
          [fileToExport]
        );

        const sheetsData: Record<string, any[]> = {};

        queryResult.rows.forEach((row) => {
          const sheetName = row.metadata_raw?.sheet || "Sheet1";
          const { question, answer } = extractTextFromRaw(row.metadata_raw, row.text_content);

          if (!sheetsData[sheetName]) {
            sheetsData[sheetName] = [];
          }

          sheetsData[sheetName].push({
            "No. Baris Asal": row.metadata_raw?.row || "",
            "Pertanyaan": question,
            "Jawaban": answer
          });
        });

        if (Object.keys(sheetsData).length === 0) {
          sheetsData["Sheet1"] = [{ "No. Baris Asal": "", "Pertanyaan": "Tidak ada data ditemukan", "Jawaban": "" }];
        }

        const workbook = XLSX.utils.book_new();
        Object.entries(sheetsData).forEach(([sheetName, rows]) => {
          const worksheet = XLSX.utils.json_to_sheet(rows);
          worksheet["!cols"] = [{ wch: 15 }, { wch: 60 }, { wch: 60 }];
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
        });

        const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        return { isBufferMode: true, excelBuffer, fileName: fileToExport };
      }

      // --------------------------------------------------------
      // SUB-LOGIKA B: AMBIL DATA UTAMA LIST FILE METADATA
      // --------------------------------------------------------
      if (!selectedMetadata) {
        const metadataFilter = search ? `where mt.${quoteIdent(metadataNameColumn)}::text ilike $1::text` : "";
        const countParams = search ? [`%${search}%`] : [];
        const listParams = search ? [`%${search}%`, limit, offset] : [limit, offset];
        const limitParam = search ? "$2" : "$1";
        const offsetParam = search ? "$3" : "$2";

        const [countResult, result] = await Promise.all([
          client.query(`select count(*)::int as total from ${metadataInfo.table.sql} mt ${metadataFilter}`, countParams),
          client.query(
            `
              select
                mt.${quoteIdent(metadataNameColumn)}::text as metadata_name,
                ${metadataCreatedColumn ? `mt.${quoteIdent(metadataCreatedColumn)}::text` : "null"} as created_at,
                ${metadataStatusColumn ? `mt.${quoteIdent(metadataStatusColumn)}::text` : "'unknown'"} as status,
                ${metadataErrorColumn ? `mt.${quoteIdent(metadataErrorColumn)}::text` : "null"} as error_message,
                count(d.${quoteIdent(idColumn || "id")})::int as document_count
              from ${metadataInfo.table.sql} mt
              left join ${info.table.sql} d
                on ${metaColumn ? `${metadataNameExpression} = mt.${quoteIdent(metadataNameColumn)}::text` : "false"}
              ${metadataFilter}
              group by mt.${quoteIdent(metadataNameColumn)}
                ${metadataCreatedColumn ? `, mt.${quoteIdent(metadataCreatedColumn)}` : ""}
                ${metadataStatusColumn ? `, mt.${quoteIdent(metadataStatusColumn)}` : ""}
                ${metadataErrorColumn ? `, mt.${quoteIdent(metadataErrorColumn)}` : ""}
              order by ${metadataCreatedColumn ? `mt.${quoteIdent(metadataCreatedColumn)} desc` : `mt.${quoteIdent(metadataNameColumn)} asc`}
              limit ${limitParam}::int offset ${offsetParam}::int
            `,
            listParams
          )
        ]);
        const total = countResult.rows[0]?.total || 0;

        return {
          mode: "metadata",
          pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
          rows: result.rows
        };
      }

      // --------------------------------------------------------
      // SUB-LOGIKA C: DETAIL DATA SEGMEN CHUNKS PER FILE METADATA
      // --------------------------------------------------------
      const documentSearchCondition = search
        ? `and (${contentColumn ? `d.${quoteIdent(contentColumn)}::text ilike $2::text or` : ""} ${metaColumn ? `d.${quoteIdent(metaColumn)}::text ilike $2::text` : "false"})`
        : "";
      const detailParams = search ? [selectedMetadata, `%${search}%`] : [selectedMetadata];
      const detailLimitParam = search ? "$3" : "$2";
      const detailOffsetParam = search ? "$4" : "$3";

      const [countResult, result] = await Promise.all([
        client.query(`select count(*)::int as total from ${info.table.sql} d where ${metadataNameExpression} = $1::text ${documentSearchCondition}`, detailParams),
        client.query(
          `
            select
              ${idColumn ? `d.${quoteIdent(idColumn)}::text` : "row_number() over ()::text"} as id,
              ${metadataNameExpression} as metadata_name,
              ${contentColumn ? `left(d.${quoteIdent(contentColumn)}::text, 240)` : "''"} as preview,
              ${rowsToJsonExpression("d", info.columns)} as raw
            from ${info.table.sql} d
            where ${metadataNameExpression} = $1::text
              ${documentSearchCondition}
            order by ${idColumn ? `d.${quoteIdent(idColumn)}` : "1"} asc
            limit ${detailLimitParam}::int offset ${detailOffsetParam}::int
          `,
          [...detailParams, limit, offset]
        )
      ]);
      const total = countResult.rows[0]?.total || 0;

      return {
        mode: "documents",
        metadataName: selectedMetadata,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
        columns: info.columns.map((column) => column.column_name),
        idColumn,
        metaColumn,
        rows: result.rows
      };
    });

    if (data && "isBufferMode" in data) {
      return new NextResponse(new Uint8Array(data.excelBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(data.fileName || "ekspor")}.xlsx"`
        }
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca dokumen RAG.") }, { status: 500 });
  }
}

// ========================================================
// 2. POST: TAMBAH DATA CHUNK BARU — diproses n8n (embedding + insert + ANALYZE)
// ========================================================
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { metadataName, text, sheet } = await request.json().catch(() => ({}));
  if (!metadataName || !text) {
    return NextResponse.json({ error: "Metadata berkas tujuan dan isi teks wajib diisi." }, { status: 400 });
  }

  try {
    const result = await callN8nCrudWebhook({
      eventType: "create_chunk",
      metadataName,
      text,
      sheet: sheet || "Manual_Added"
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "create_rag_chunk",
      detail: { metadataName, id: result.id }
    });

    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menambahkan chunk baru.") }, { status: 500 });
  }
}

// ========================================================
// 3. PUT: PERBARUI ISI TEXT SEGMEN CHUNK — diproses n8n (re-embed + update + ANALYZE)
// ========================================================
export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, text, metadataName } = await request.json().catch(() => ({}));
  if (!id || !text) {
    return NextResponse.json({ error: "ID chunk dan konten teks baru wajib dikirimkan." }, { status: 400 });
  }

  try {
    await callN8nCrudWebhook({
      eventType: "update_chunk",
      id: String(id),
      text,
      metadataName
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "update_rag_chunk",
      detail: { id: String(id), metadataName }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal memperbarui segmen data chunk.") }, { status: 500 });
  }
}

// ========================================================
// 4. DELETE: HAPUS SATU CHUNK ATAU SELURUH FILE METADATA — diproses n8n (delete + ANALYZE)
// ========================================================
// Dua cara mengirim parameter (mengikuti frontend yang sudah ada):
//   - Hapus satu chunk: query string  ?id=...&metadataName=...
//   - Hapus satu file penuh: JSON body { metadataName }
export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const idFromQuery = url.searchParams.get("id") || "";
  const metadataNameFromQuery = url.searchParams.get("metadataName") || "";

  const bodyJson = await request.json().catch(() => ({}));
  const metadataNameFromBody = bodyJson?.metadataName || "";
  const idFromBody = bodyJson?.id || "";

  const id = idFromQuery || idFromBody;
  const metadataName = metadataNameFromQuery || metadataNameFromBody;

  if (!id && !metadataName) {
    return NextResponse.json({ error: "Kirim id atau metadataName untuk melakukan penghapusan." }, { status: 400 });
  }

  try {
    const eventType = id ? "delete_chunk" : "delete_metadata";
    const result = await callN8nCrudWebhook({
      eventType,
      id: id ? String(id) : undefined,
      metadataName: metadataName || undefined
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: id ? "delete_rag_chunk" : "delete_rag_metadata",
      detail: { id: id ? String(id) : undefined, metadataName: metadataName || undefined, deleted: result.deleted }
    });

    return NextResponse.json({ ok: true, deleted: result.deleted ?? 1 });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menghapus dokumen.") }, { status: 500 });
  }
}