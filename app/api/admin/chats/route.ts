import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import * as XLSX from "xlsx";

// ==========================================
// 1. GET: EKSPOR POSTGRESQL KE EXCEL MULTI-SHEET
// ==========================================
export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const metadataName = url.searchParams.get("file");

  if (!metadataName) {
    return NextResponse.json({ error: "Parameter file diperlukan" }, { status: 400 });
  }

  try {
    const excelBuffer = await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      const metadataColumn = pickColumn(docInfo.columns, ["metadata_name", "metadataName"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw"]);
      const idColumn = pickColumn(docInfo.columns, ["id"]);

      if (!metadataColumn || !rawColumn) {
        throw new Error("Struktur tabel documents tidak sesuai.");
      }

      // Ambil seluruh data chunk dari PostgreSQL berdasarkan nama file metadata
      const result = await client.query<{
        id: string;
        preview: string;
        raw: any;
      }>(
        `
          select 
            ${idColumn ? quoteIdent(idColumn) : "null"} as id,
            ${previewColumn ? quoteIdent(previewColumn) : "null"} as preview,
            ${quoteIdent(rawColumn)} as raw
          from ${docInfo.table.sql}
          where ${quoteIdent(metadataColumn)}::text = $1::text
          order by id asc
        `,
        [metadataName]
      );

      // Kelompokkan data secara dinamis berdasarkan nama 'sheet' dari objek raw JSON
      const sheetsData: Record<string, any[]> = {};

      result.rows.forEach((row) => {
        const rawMeta = typeof row.raw === "string" ? JSON.parse(row.raw) : row.raw;
        const sheetName = rawMeta?.sheet || "Sheet1";
        const textContent = String(rawMeta?.text || row.preview || "");

        // Parsing teks RAG "Pertanyaan: ... \nJawaban: ..." menjadi kolom Excel yang rapi
        const qMatch = textContent.match(/Pertanyaan:\s*([\s\S]*?)(?=\nJawaban:|$)/);
        const aMatch = textContent.match(/Jawaban:\s*([\s\S]*)/);

        const question = qMatch ? qMatch[1].trim() : textContent;
        const answer = aMatch ? aMatch[1].trim() : "";

        if (!sheetsData[sheetName]) {
          sheetsData[sheetName] = [];
        }

        sheetsData[sheetName].push({
          "No. Baris Asal": rawMeta?.row || "",
          "Pertanyaan": question,
          "Jawaban": answer
        });
      });

      // Proses pembuatan multi-sheet menggunakan SheetJS (XLSX)
      const workbook = XLSX.utils.book_new();

      Object.entries(sheetsData).forEach(([sheetName, rows]) => {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        
        // Atur lebar kolom agar tampilan data rapi saat dibuka
        worksheet["!cols"] = [
          { wch: 15 },
          { wch: 50 },
          { wch: 50 }
        ];

        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      });

      return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    });

    return new NextResponse(new Uint8Array(excelBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(metadataName)}"`
      }
    });

  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal mengekspor berkas.") }, { status: 500 });
  }
}

// ==========================================
// 2. POST: TAMBAH DATA CHUNK BARU (MANUAL)
// ==========================================
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { metadataName, text, sheet } = await request.json();
    if (!metadataName || !text) {
      return NextResponse.json({ error: "Metadata tujuan dan teks wajib diisi" }, { status: 400 });
    }

    const newChunkId = crypto.randomUUID();

    await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      const metadataColumn = pickColumn(docInfo.columns, ["metadata_name", "metadataName"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw"]);
      const idColumn = pickColumn(docInfo.columns, ["id"]);

      // Cari total data saat ini untuk menentukan row index virtual berikutnya
      const countRes = await client.query<{ count: number }>(
        `select count(*)::int as count from ${docInfo.table.sql} where ${quoteIdent(metadataColumn || "")} = $1`,
        [metadataName]
      );
      const nextVirtualRow = (countRes.rows[0]?.count || 0) + 1;

      const newRawMetadata = {
        source: metadataName,
        sheet: sheet || "Manual_Added",
        row: nextVirtualRow,
        text: text,
        blobType: "text/plain",
        loc: { lines: { from: 1, to: 2 } }
      };

      await client.query(
        `
          insert into ${docInfo.table.sql} (${quoteIdent(idColumn || "id")}, ${quoteIdent(metadataColumn || "metadata_name")}, ${quoteIdent(previewColumn || "preview")}, ${quoteIdent(rawColumn || "raw")})
          values ($1, $2, $3, $4)
        `,
        [newChunkId, metadataName, text.substring(0, 200), JSON.stringify(newRawMetadata)]
      );
    });

    // Jalankan asinkronus trigger webhook n8n untuk penyelarasan Vector Store Embedding
    const N8N_CREATE_WEBHOOK_URL = process.env.N8N_CREATE_WEBHOOK_URL;
    if (N8N_CREATE_WEBHOOK_URL) {
      fetch(N8N_CREATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_chunk", chunkId: newChunkId, metadataName, text, sheet: sheet || "Manual_Added" })
      }).catch((err) => console.error("Webhook n8n error:", err));
    }

    return NextResponse.json({ success: true, message: "Data manual disimpan." });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menambah data manual.") }, { status: 500 });
  }
}

// ==========================================
// 3. PUT: PERBARUI ISI CHUNK DATA
// ==========================================
export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, text, metadataName } = await request.json();
    if (!id || !text) return NextResponse.json({ error: "ID dan teks wajib diisi" }, { status: 400 });

    await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      const idColumn = pickColumn(docInfo.columns, ["id"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw"]);

      const oldRes = await client.query<{ raw: any }>(
        `select ${quoteIdent(rawColumn || "raw")} as raw from ${docInfo.table.sql} where ${quoteIdent(idColumn || "id")} = $1`,
        [id]
      );
      if (!oldRes.rows.length) throw new Error("Chunk tidak ditemukan.");

      const currentRaw = typeof oldRes.rows[0].raw === "string" ? JSON.parse(oldRes.rows[0].raw) : oldRes.rows[0].raw;
      const updatedRaw = { ...currentRaw, text: text };

      await client.query(
        `update ${docInfo.table.sql} set ${quoteIdent(previewColumn || "preview")} = $1, ${quoteIdent(rawColumn || "raw")} = $2 where ${quoteIdent(idColumn || "id")} = $3`,
        [text.substring(0, 200), JSON.stringify(updatedRaw), id]
      );
    });

    const N8N_UPDATE_WEBHOOK_URL = process.env.N8N_UPDATE_WEBHOOK_URL;
    if (N8N_UPDATE_WEBHOOK_URL) {
      fetch(N8N_UPDATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_chunk", chunkId: id, metadataName, text })
      }).catch((err) => console.error("Webhook n8n error:", err));
    }

    return NextResponse.json({ success: true, message: "Chunk berhasil diperbarui." });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal mengupdate chunk.") }, { status: 500 });
  }
}

// ==========================================
// 4. DELETE: HAPUS SEGMEN CHUNK TERTENTU
// ==========================================
export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const metadataName = url.searchParams.get("metadataName");

    if (!id) return NextResponse.json({ error: "ID chunk diperlukan" }, { status: 400 });

    await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      const idColumn = pickColumn(docInfo.columns, ["id"]);
      await client.query(`delete from ${docInfo.table.sql} where ${quoteIdent(idColumn || "id")} = $1`, [id]);
    });

    const N8N_DELETE_WEBHOOK_URL = process.env.N8N_DELETE_WEBHOOK_URL;
    if (N8N_DELETE_WEBHOOK_URL) {
      fetch(N8N_DELETE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_chunk", chunkId: id, metadataName })
      }).catch((err) => console.error("Webhook n8n error:", err));
    }

    return NextResponse.json({ success: true, message: "Chunk berhasil dihapus." });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menghapus chunk.") }, { status: 500 });
  }
}