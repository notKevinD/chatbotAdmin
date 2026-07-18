import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import * as XLSX from "xlsx";
import crypto from "crypto";

// ==========================================
// 1. GET: EKSPOR POSTGRESQL KE EXCEL MULTI-SHEET
// ==========================================
export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const metadataName = url.searchParams.get("file")?.trim();

  if (!metadataName) {
    return NextResponse.json({ error: "Parameter file diperlukan" }, { status: 400 });
  }

  try {
    const excelBuffer = await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      
      // Deteksi kolom secara adaptif
      const metadataSourceColumn = pickColumn(docInfo.columns, ["metadata_source", "metadataSource"]);
      const metadataColumn = pickColumn(docInfo.columns, ["metadata"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview", "content"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw", "data"]);
      const idColumn = pickColumn(docInfo.columns, ["id"]);

      if (!rawColumn) {
        throw new Error("Struktur tabel documents tidak memiliki kolom data/raw JSON.");
      }

      // Bangun klausa WHERE secara adaptif mirip dengan fungsi verifikasi n8n
      const conditions: string[] = [];
      const params: string[] = [metadataName];

      if (metadataSourceColumn) {
        conditions.push(`lower(${quoteIdent(metadataSourceColumn)}::text) = lower($1::text)`);
      }
      if (metadataColumn) {
        const meta = quoteIdent(metadataColumn);
        conditions.push(`lower(${meta}->>'source') = lower($1::text)`);
        conditions.push(`lower(${meta}#>>'{source,source}') = lower($1::text)`);
        conditions.push(`lower(${meta}->>'metadata_name') = lower($1::text)`);
        conditions.push(`lower(${meta}->>'metadataName') = lower($1::text)`);
        conditions.push(`lower(${meta}->>'fileName') = lower($1::text)`);
      }

      if (!conditions.length) {
        throw new Error("Tidak menemukan kolom metadata identifikasi file pada tabel documents.");
      }

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
          where ${conditions.join(" or ")}
          order by id asc
        `,
        params
      );

      const sheetsData: Record<string, any[]> = {};

      result.rows.forEach((row) => {
        const rawMeta = typeof row.raw === "string" ? JSON.parse(row.raw) : row.raw;
        const sheetName = rawMeta?.sheet || "Sheet1";
        const textContent = String(rawMeta?.text || row.preview || "");

        // Parsing teks RAG menjadi kolom Pertanyaan & Jawaban
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

      if (Object.keys(sheetsData).length === 0) {
        sheetsData["Sheet1"] = [{ "No. Baris Asal": "", "Pertanyaan": "Tidak ada data", "Jawaban": "" }];
      }

      const workbook = XLSX.utils.book_new();

      Object.entries(sheetsData).forEach(([sheetName, rows]) => {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 15 }, { wch: 60 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31)); // Batasan panjang sheet name XLSX
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
      const metadataSourceColumn = pickColumn(docInfo.columns, ["metadata_source", "metadataSource"]);
      const metadataColumn = pickColumn(docInfo.columns, ["metadata"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview", "content"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw", "data"]);
      const idColumn = pickColumn(docInfo.columns, ["id"]);

      // Bangun klausa WHERE hitung baris secara dinamis
      const conditions: string[] = [];
      if (metadataSourceColumn) conditions.push(`lower(${quoteIdent(metadataSourceColumn)}::text) = lower($1::text)`);
      if (metadataColumn) {
        const meta = quoteIdent(metadataColumn);
        conditions.push(`lower(${meta}->>'source') = lower($1::text)`);
        conditions.push(`lower(${meta}->>'metadata_name') = lower($1::text)`);
      }

      const countRes = await client.query<{ count: number }>(
        `select count(*)::int as count from ${docInfo.table.sql} where ${conditions.length ? conditions.join(" or ") : "1=0"}`,
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

      const insertColumns: string[] = [];
      const insertValues: any[] = [newChunkId];
      const valPlaceholders: string[] = ["$1"];

      if (idColumn) insertColumns.push(quoteIdent(idColumn));
      else insertColumns.push('"id"');

      if (metadataSourceColumn) {
        insertColumns.push(quoteIdent(metadataSourceColumn));
        insertValues.push(metadataName);
        valPlaceholders.push(`$${insertValues.length}`);
      }

      if (metadataColumn) {
        insertColumns.push(quoteIdent(metadataColumn));
        insertValues.push(JSON.stringify({ source: metadataName, metadata_name: metadataName }));
        valPlaceholders.push(`$${insertValues.length}`);
      }

      if (previewColumn) {
        insertColumns.push(quoteIdent(previewColumn));
        insertValues.push(text.substring(0, 500));
        valPlaceholders.push(`$${insertValues.length}`);
      }

      if (rawColumn) {
        insertColumns.push(quoteIdent(rawColumn));
        insertValues.push(JSON.stringify(newRawMetadata));
        valPlaceholders.push(`$${insertValues.length}`);
      }

      await client.query(
        `insert into ${docInfo.table.sql} (${insertColumns.join(", ")}) values (${valPlaceholders.join(", ")})`,
        insertValues
      );
    });

    // Pemicu Webhook Asinkronus ke n8n
    const N8N_CREATE_WEBHOOK_URL = process.env.N8N_CREATE_WEBHOOK_URL;
    if (N8N_CREATE_WEBHOOK_URL) {
      fetch(N8N_CREATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_chunk", chunkId: newChunkId, metadataName, text, sheet: sheet || "Manual_Added" })
      }).catch((err) => console.error("Webhook n8n create error:", err));
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
      const previewColumn = pickColumn(docInfo.columns, ["preview", "content"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw", "data"]);

      if (!idColumn) throw new Error("Kolom ID tidak ditemukan.");

      const oldRes = await client.query<{ raw: any }>(
        `select ${rawColumn ? quoteIdent(rawColumn) : "raw"} as raw from ${docInfo.table.sql} where ${quoteIdent(idColumn)} = $1`,
        [id]
      );
      if (!oldRes.rows.length) throw new Error("Chunk tidak ditemukan.");

      const currentRaw = typeof oldRes.rows[0].raw === "string" ? JSON.parse(oldRes.rows[0].raw) : oldRes.rows[0].raw;
      const updatedRaw = { ...currentRaw, text: text };

      const sets: string[] = [];
      const params: any[] = [text.substring(0, 500), JSON.stringify(updatedRaw), id];

      if (previewColumn) sets.push(`${quoteIdent(previewColumn)} = $1`);
      if (rawColumn) sets.push(`${quoteIdent(rawColumn)} = $2`);

      await client.query(
        `update ${docInfo.table.sql} set ${sets.join(", ")} where ${quoteIdent(idColumn)} = $3`,
        params
      );
    });

    const N8N_UPDATE_WEBHOOK_URL = process.env.N8N_UPDATE_WEBHOOK_URL;
    if (N8N_UPDATE_WEBHOOK_URL) {
      fetch(N8N_UPDATE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_chunk", chunkId: id, metadataName, text })
      }).catch((err) => console.error("Webhook n8n update error:", err));
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
      
      if (!idColumn) throw new Error("Kolom ID tidak teridentifikasi.");
      
      await client.query(`delete from ${docInfo.table.sql} where ${quoteIdent(idColumn)} = $1`, [id]);
    });

    const N8N_DELETE_WEBHOOK_URL = process.env.N8N_DELETE_WEBHOOK_URL;
    if (N8N_DELETE_WEBHOOK_URL) {
      fetch(N8N_DELETE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_chunk", chunkId: id, metadataName })
      }).catch((err) => console.error("Webhook n8n delete error:", err));
    }

    return NextResponse.json({ success: true, message: "Chunk berhasil dihapus." });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal menghapus chunk.") }, { status: 500 });
  }
}