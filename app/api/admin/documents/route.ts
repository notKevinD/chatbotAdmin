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

export async function GET(request: Request) {
  if (!(await getCurrentAdmin()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

      // ========================================================
      // SUB-LOGIKA 1: JIKA USER MEMINTA UNDUH (EKSPOR MULTI-SHEET)
      // ========================================================
      if (fileToExport) {
        const queryResult = await client.query(
          `
            select
              ${idColumn ? `d.${quoteIdent(idColumn)}::text` : "null"} as id,
              ${contentColumn ? `d.${quoteIdent(contentColumn)}::text` : "''"} as text_content,
              ${metaColumn ? `d.${quoteIdent(metaColumn)}` : "null"} as metadata_raw
            from ${info.table.sql} d
            where ${metadataNameExpression} = $1::text
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

        const workbook = XLSX.utils.book_new();
        Object.entries(sheetsData).forEach(([sheetName, rows]) => {
          const worksheet = XLSX.utils.json_to_sheet(rows);
          worksheet["!cols"] = [{ wch: 15 }, { wch: 55 }, { wch: 55 }];
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        });

        const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        return { isBufferMode: true, excelBuffer, fileName: fileToExport };
      }

      // ========================================================
      // LOGIKA BAWAAN: AMBIL DATA METADATA LIST ATAU CHUNKS LIST
      // ========================================================
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

      // Detil Dokumen per File
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
          "Content-Disposition": `attachment; filename="${encodeURIComponent(data.fileName || "")}.xlsx"`
        }
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca dokumen.") }, { status: 500 });
  }
}

// ==========================================
// POST: TAMBAH DATA CHUNK BARU SECARA MANUAL
// ==========================================
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { metadataName, text, sheet } = await request.json().catch(() => ({}));
    if (!metadataName || !text) {
      return NextResponse.json({ error: "Metadata berkas tujuan dan isi teks wajib diisi." }, { status: 400 });
    }

    const newChunkId = crypto.randomUUID();

    await withClient(async (client) => {
      const info = await getColumns(client, "documents");
      const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
      const metaColumn = pickColumn(info.columns, ["metadata"]);
      const contentColumn = pickColumn(info.columns, ["content", "pageContent", "text", "document"]);

      const countRes = await client.query(`select count(*)::int as count from ...`, [metadataName || ""]);
      const nextVirtualRow = (countRes.rows[0]?.count || 0) + 1;

      const rawMetadata = {
        metadata_name: metadataName,
        sheet: sheet || "Manual_Added",
        row: nextVirtualRow,
        text: text,
        source: metadataName
      };

      await client.query(
        `
          insert into ${info.table.sql} (${quoteIdent(idColumn || "id")}, ${contentColumn ? quoteIdent(contentColumn) : "content"}, ${metaColumn ? quoteIdent(metaColumn) : "metadata"})
          values ($1, $2, $3)
        `,
        [newChunkId, text, JSON.stringify(rawMetadata)]
      );
    });

    const N8N_CREATE_WEBHOOK_URL = process.env.N8N_CREATE_WEBHOOK_URL;
    if (N8N_CREATE_WEBHOOK_URL) {
      fetch(N8N_CREATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_chunk", chunkId: newChunkId, metadataName, text, sheet: sheet || "Manual_Added" })
      }).catch((e) => console.error("Gagal mengirim data create ke n8n:", e));
    }

    return NextResponse.json({ success: true, id: newChunkId });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menambahkan chunk baru.") }, { status: 500 });
  }
}

// ==========================================
// PUT: PERBARUI ISI CHUNK DATA & METADATA TEXT
// ==========================================
export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, text, metadataName } = await request.json().catch(() => ({}));
    if (!id || !text) {
      return NextResponse.json({ error: "ID chunk dan konten teks baru wajib dikirimkan." }, { status: 400 });
    }

    await withClient(async (client) => {
      const info = await getColumns(client, "documents");
      const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
      const metaColumn = pickColumn(info.columns, ["metadata"]);
      const contentColumn = pickColumn(info.columns, ["content", "pageContent", "text", "document"]);

      const currentRes = await client.query(
        `select ${metaColumn ? quoteIdent(metaColumn) : "metadata"} as meta from ${info.table.sql} where ${quoteIdent(idColumn || "id")}::text = $1`,
        [String(id)]
      );
      if (!currentRes.rows.length) throw new Error("Data chunk tidak ditemukan di database.");

      const oldMeta = typeof currentRes.rows[0].meta === "string" ? JSON.parse(currentRes.rows[0].meta) : currentRes.rows[0].meta || {};
      const updatedMeta = { ...oldMeta, text: text };

      await client.query(
        `
          update ${info.table.sql}
          set 
            ${contentColumn ? `${quoteIdent(contentColumn)} = $1,` : ""}
            ${quoteIdent(metaColumn || "metadata")} = $2
          where ${quoteIdent(idColumn || "id")}::text = $3
        `,
        [text, JSON.stringify(updatedMeta), String(id)]
      );
    });

    const N8N_UPDATE_WEBHOOK_URL = process.env.N8N_UPDATE_WEBHOOK_URL;
    if (N8N_UPDATE_WEBHOOK_URL) {
      fetch(N8N_UPDATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_chunk", chunkId: id, metadataName, text })
      }).catch((e) => console.error("Gagal mengirim data update ke n8n:", e));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal memperbarui segmen data chunk.") }, { status: 500 });
  }
}

// ==========================================
// DELETE: HAPUS CHUNK ATAU METADATA LENGKAP
// ==========================================
export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, metadataName } = await request.json().catch(() => ({}));

  if (!id && !metadataName) {
    return NextResponse.json(
      { error: "Kirim id atau metadataName untuk delete." },
      { status: 400 },
    );
  }

  try {
    const result = await withClient(async (client) => {
      const info = await getColumns(client, "documents");
      const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
      const metaColumn = pickColumn(info.columns, ["metadata"]);

      if (id && idColumn) {
        const deleteResult = await client.query(
          `delete from ${info.table.sql} where ${quoteIdent(idColumn)}::text = $1`,
          [String(id)],
        );
        
        const N8N_DELETE_WEBHOOK_URL = process.env.N8N_DELETE_WEBHOOK_URL;
        if (N8N_DELETE_WEBHOOK_URL) {
          fetch(N8N_DELETE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_chunk", chunkId: String(id), metadataName })
          }).catch((e) => console.error("Gagal kirim delete webhook n8n:", e));
        }

        await writeAuditLog({
          request,
          userId: admin.id,
          action: "delete_rag_chunk",
          detail: { id: String(id), deletedDocuments: deleteResult.rowCount || 0 }
        });
        return deleteResult;
      }

      if (metadataName && metaColumn) {
        // PERBAIKAN BUG: Menghilangkan alias 'd.' yang tidak terdefinisi di query DELETE
        const deleteDocuments = await client.query(
          `
            delete from ${info.table.sql}
            where ${quoteIdent(metaColumn)}->>'metadata_name' = $1
              or ${quoteIdent(metaColumn)}->>'metadataName' = $1
              or ${quoteIdent(metaColumn)}->'source'->>'source' = $1
              or ${quoteIdent(metaColumn)}->>'source' = $1
              or ${quoteIdent(metaColumn)}->>'fileName' = $1
          `,
          [String(metadataName)],
        );
        
        const metadataInfo = await getColumns(client, "metadata_table");
        const metadataNameColumn = pickColumn(metadataInfo.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);

        if (metadataNameColumn) {
          await client.query(
            `delete from ${metadataInfo.table.sql} where ${quoteIdent(metadataNameColumn)}::text = $1::text`,
            [String(metadataName)],
          );
        }

        await writeAuditLog({
          request,
          userId: admin.id,
          action: "delete_rag_metadata",
          detail: { metadataName: String(metadataName), deletedDocuments: deleteDocuments.rowCount || 0 }
        });

        return deleteDocuments;
      }

      throw new Error("Kolom id/metadata tidak ditemukan untuk menghapus dokumen.");
    });

    return NextResponse.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menghapus dokumen.") }, { status: 500 });
  }
}