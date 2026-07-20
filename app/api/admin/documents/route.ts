import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { checkRateLimit, getIpAddress } from "@/lib/rate-limit";
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

// Helper internal: ambil field-field (Pertanyaan/Jawaban, atau kolom lain)
// dari satu baris hasil query, dengan urutan prioritas yang AMAN — tidak
// menebak-nebak label dari isi teks bebas, karena itu berisiko salah potong
// kalau isi jawaban kebetulan mengandung tanda ":" (jam buka, URL, alamat,
// "Catatan: ..." di dalam jawaban, dll).
//
// 1) PALING AKURAT: kalau metadata punya field terstruktur eksplisit
//    (misalnya n8n menyimpan `metadata.fields = { "Kategori": "...", ... }`
//    saat chunk dibuat), pakai itu APA ADANYA — tidak ada tebak-tebakan sama
//    sekali, karena n8n yang tahu persis kolom aslinya dari spreadsheet.
//    Ini kunci untuk dukungan multi-kolom yang benar-benar aman di masa depan.
// 2) FALLBACK untuk data lama: cari HANYA dua label yang memang sudah pasti
//    dipakai n8n saat chunking ("Pertanyaan:" dan "Jawaban:"), bukan label
//    sembarang. Supaya aman, label ini HARUS di awal baris (^) — jadi kalimat
//    di tengah jawaban yang kebetulan ada titik dua tidak akan salah kepotong.
function extractFieldsFromChunk(metaRaw: any, fallbackText: string): Record<string, string> {
  const meta = metaRaw || {};

  // 1) Sumber paling akurat: field terstruktur dari n8n (kalau ada).
  //    Kalau metadata juga punya `columns` (array urutan nama kolom asli),
  //    urutan itu dipakai supaya kolom Excel hasil export PERSIS sama urutan
  //    kolom sumbernya — tidak bergantung urutan key di object JSON.
  if (meta.fields && typeof meta.fields === "object" && !Array.isArray(meta.fields)) {
    const orderedKeys: string[] =
      Array.isArray(meta.columns) && meta.columns.length
        ? meta.columns.filter((key: string) => Object.prototype.hasOwnProperty.call(meta.fields, key))
        : Object.keys(meta.fields);

    const result: Record<string, string> = {};
    for (const key of orderedKeys) {
      const value = meta.fields[key];
      result[key] = value === null || value === undefined ? "" : String(value);
    }
    if (Object.keys(result).length) return result;
  }

  // 2) Fallback: HANYA cari "Pertanyaan:" dan "Jawaban:" (label tetap, bukan tebakan)
  const textContent = String(meta.text || meta.pageContent || meta.content || fallbackText || "");
  const qMatch = textContent.match(/^Pertanyaan:\s*([\s\S]*?)(?=\nJawaban:|$)/);
  const aMatch = textContent.match(/\nJawaban:\s*([\s\S]*)/);

  if (qMatch || aMatch) {
    return {
      Pertanyaan: qMatch ? qMatch[1].trim() : "",
      Jawaban: aMatch ? aMatch[1].trim() : ""
    };
  }

  // 3) Tidak match pola apapun → satu kolom apa adanya, tanpa tebakan
  return { Isi: textContent.trim() };
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
//   4. Membalas JSON — WAJIB balas dalam 20 detik (lihat N8N_CRUD_TIMEOUT_MS),
//      kalau tidak, request dianggap gagal dan user melihat pesan "n8n tidak aktif":
//
//        create_chunk sukses : { "success": true, "id": "uuid-baru", "eventType": "create_chunk" }
//        create_chunk gagal  : { "success": false, "error": "...", "eventType": "create_chunk" }
//        update_chunk sukses : { "success": true, "eventType": "update_chunk" }
//        update_chunk gagal  : { "success": false, "error": "...", "eventType": "update_chunk" }
//
//      Kalau n8n mati/down/tidak merespons, Next.js otomatis menampilkan pesan
//      error yang jelas ke admin (bukan hang selamanya) — lihat callN8nCrudWebhook().
//
// Body yang dikirim Next.js ke n8n selalu punya field "eventType":
//   - "create_chunk"    { eventType, metadataName, text, sheet, columns, fields }
//   - "update_chunk"    { eventType, id, text, metadataName, sheet, row, columns, fields }
//     ("columns" = daftar nama kolom sesuai struktur file aslinya, "fields" =
//      isi tiap kolom untuk baris ini. n8n TINGGAL PAKAI ini apa adanya untuk
//      membentuk metadata.columns/metadata.fields di tabel documents — tidak
//      perlu menebak struktur dari teks "text" sama sekali.)
//
// CATATAN: hapus SATU CHUNK maupun hapus SATU FILE PENUH TIDAK lewat n8n —
// keduanya langsung SQL DELETE + ANALYZE documents di Next.js, karena tidak
// butuh embedding/AI apapun. Lihat handler DELETE di bawah untuk detailnya.
//
// Bentuk kolom `metadata` (jsonb) di tabel `documents` untuk data hasil upload
// Excel asli terlihat seperti ini (contoh nyata dari DB):
//   {
//     "loc": { "lines": { "from": 1, "to": 2 } },
//     "sheet": "Data Basis Pengetahuan Chatbot.xlsx",
//     "source": "blob",
//     "blobType": "text/plain",
//     "metadata_name": "Data Basis Pengetahuan Chatbot.xlsx"
//   }
// Untuk chunk yang ditambah/diedit MANUAL lewat panel admin ini, n8n cukup
// membentuk metadata dengan pola yang sama, tapi:
//   - "sheet" diisi dari field `sheet` yang dikirim payload ini
//     (untuk create baru = "Manual_Added", untuk edit = sheet asli chunk itu)
//   - "source" diisi "manual" (bukan "blob") supaya kelihatan asalnya
//   - "loc.lines.from"/"to" boleh diisi null/0 — nomor baris asli spreadsheet
//     TIDAK relevan untuk entri manual, jadi tidak perlu dikirim dari sini.
//   - "metadata_name" = nilai `metadataName` di payload ini
// ========================================================

type N8nCrudResult = {
  success?: boolean;
  id?: string;
  deleted?: number;
  error?: string;
  eventType?: string;
};

const N8N_CRUD_TIMEOUT_MS = 20000; // 20 detik — kalau n8n tidak balas sampai batas ini, dianggap gagal

async function callN8nCrudWebhook(payload: Record<string, unknown>): Promise<N8nCrudResult> {
  const webhookUrl = process.env.N8N_RAG_CRUD_WEBHOOK;
  if (!webhookUrl) {
    throw new Error("N8N_RAG_CRUD_WEBHOOK belum diatur di environment (.env.production).");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), N8N_CRUD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Server n8n tidak merespons dalam ${N8N_CRUD_TIMEOUT_MS / 1000} detik. Pastikan workflow n8n aktif (tidak sedang berhenti/di-pause) dan webhook "${payload.eventType}" tersambung dengan benar.`
      );
    }
    throw new Error(
      "Tidak dapat terhubung ke server n8n. Kemungkinan n8n sedang mati/down, URL webhook salah, atau ada masalah jaringan/firewall di VPS."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let parsed: N8nCrudResult = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // n8n merespons tapi bukan JSON valid (misal workflow belum di-set node "Respond to Webhook"
    // dengan benar, atau error HTML dari server) — anggap gagal dan tunjukkan potongan responsnya.
    throw new Error(
      `Server n8n merespons tapi formatnya bukan JSON yang valid (kemungkinan node "Respond to Webhook" belum dikonfigurasi). Respons mentah: ${text.slice(0, 200) || "(kosong)"}`
    );
  }

  if (!response.ok || parsed.success === false) {
    throw new Error(parsed.error || `Webhook n8n menolak permintaan (status HTTP ${response.status}).`);
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
  const globalSearch = (url.searchParams.get("globalSearch") || "").trim();
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 100);
  const offset = (page - 1) * limit;

  // ------------------------------------------------------------
  // MODE PENCARIAN LINTAS FILE: ?globalSearch=... — cari isi chunk di
  // SEMUA file sekaligus, tidak perlu buka file satu-satu dulu.
  // ------------------------------------------------------------
  if (globalSearch) {
    try {
      const result = await withClient(async (client) => {
        const info = await getColumns(client, "documents");
        const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
        const metaColumn = pickColumn(info.columns, ["metadata"]);
        const contentColumn = pickColumn(info.columns, ["content", "pageContent", "text", "document"]);

        const metadataNameExpression =
          metaColumn === "metadata"
            ? `coalesce(d.metadata->>'metadata_name', d.metadata->>'metadataName', d.metadata->'source'->>'source', d.metadata->>'source', d.metadata->>'fileName', 'Tanpa metadata')`
            : "'Tanpa metadata'";

        const countRes = await client.query(
          `
            select count(*)::int as total
            from ${info.table.sql} d
            where ${contentColumn ? `d.${quoteIdent(contentColumn)}::text ilike $1::text` : "false"}
          `,
          [`%${globalSearch}%`]
        );
        const total = countRes.rows[0]?.total || 0;

        const dataRes = await client.query(
          `
            select
              ${idColumn ? `d.${quoteIdent(idColumn)}::text` : "row_number() over ()::text"} as id,
              ${metadataNameExpression} as metadata_name,
              ${contentColumn ? `left(d.${quoteIdent(contentColumn)}::text, 240)` : "''"} as preview
            from ${info.table.sql} d
            where ${contentColumn ? `d.${quoteIdent(contentColumn)}::text ilike $1::text` : "false"}
            order by ${idColumn ? `d.${quoteIdent(idColumn)}` : "1"} asc
            limit $2::int offset $3::int
          `,
          [`%${globalSearch}%`, limit, offset]
        );

        return {
          rows: dataRes.rows,
          pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
        };
      });

      return NextResponse.json({ mode: "global-search", ...result });
    } catch (error) {
      return NextResponse.json(
        { error: formatDbError(error, "Gagal mencari di semua file.") },
        { status: 500 }
      );
    }
  }

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
      const metadataColumnsColumn = pickColumn(metadataInfo.columns, ["columns", "column_list", "headers"]);

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
        const sheetFieldOrder: Record<string, string[]> = {};

        queryResult.rows.forEach((row) => {
          const sheetName = row.metadata_raw?.sheet || "Sheet1";
          const fields = extractFieldsFromChunk(row.metadata_raw, row.text_content);

          if (!sheetsData[sheetName]) {
            sheetsData[sheetName] = [];
            sheetFieldOrder[sheetName] = [];
          }

          // Kumpulkan urutan kolom (union dari semua label yang pernah muncul
          // di sheet ini), supaya header Excel konsisten walau tidak semua
          // baris punya field yang sama persis.
          for (const label of Object.keys(fields)) {
            if (!sheetFieldOrder[sheetName].includes(label)) {
              sheetFieldOrder[sheetName].push(label);
            }
          }

          sheetsData[sheetName].push(fields);
        });

        if (Object.keys(sheetsData).length === 0) {
          sheetsData["Sheet1"] = [{ Isi: "Tidak ada data ditemukan" }];
          sheetFieldOrder["Sheet1"] = ["Isi"];
        }

        const workbook = XLSX.utils.book_new();
        Object.entries(sheetsData).forEach(([sheetName, rows]) => {
          const columns = sheetFieldOrder[sheetName] || [];
          // Normalisasi tiap baris supaya semua kolom ada (isi "" kalau baris
          // itu tidak punya field tersebut), dan urutannya konsisten.
          const normalizedRows = rows.map((rowFields) => {
            const normalized: Record<string, string> = {};
            for (const column of columns) {
              normalized[column] = rowFields[column] || "";
            }
            return normalized;
          });

          const worksheet = XLSX.utils.json_to_sheet(normalizedRows, { header: columns });
          worksheet["!cols"] = columns.map(() => ({ wch: 50 }));
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
                ${metadataColumnsColumn ? `mt.${quoteIdent(metadataColumnsColumn)}` : "null"} as columns,
                count(d.${quoteIdent(idColumn || "id")})::int as document_count
              from ${metadataInfo.table.sql} mt
              left join ${info.table.sql} d
                on ${metaColumn ? `${metadataNameExpression} = mt.${quoteIdent(metadataNameColumn)}::text` : "false"}
              ${metadataFilter}
              group by mt.${quoteIdent(metadataNameColumn)}
                ${metadataCreatedColumn ? `, mt.${quoteIdent(metadataCreatedColumn)}` : ""}
                ${metadataStatusColumn ? `, mt.${quoteIdent(metadataStatusColumn)}` : ""}
                ${metadataErrorColumn ? `, mt.${quoteIdent(metadataErrorColumn)}` : ""}
                ${metadataColumnsColumn ? `, mt.${quoteIdent(metadataColumnsColumn)}` : ""}
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

  const rateLimit = checkRateLimit(`documents-write:${admin.id}:${getIpAddress(request)}`, 30, 5 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.` },
      { status: 429 }
    );
  }

  const { metadataName, text, sheet, columns, fields } = await request.json().catch(() => ({}));
  if (!metadataName || !text) {
    return NextResponse.json({ error: "Metadata berkas tujuan dan isi teks wajib diisi." }, { status: 400 });
  }

  try {
    const result = await callN8nCrudWebhook({
      eventType: "create_chunk",
      metadataName,
      text,
      sheet: sheet || "Manual_Added",
      columns: columns || undefined,
      fields: fields || undefined
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "create_rag_chunk",
      detail: { metadataName, id: result.id }
    });

    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("Gagal menambah chunk via n8n:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal menambahkan chunk baru. Periksa apakah workflow n8n aktif.") },
      { status: 502 }
    );
  }
}

// ========================================================
// 3. PUT: PERBARUI ISI TEXT SEGMEN CHUNK — diproses n8n (re-embed + update + ANALYZE)
// ========================================================
export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimit = checkRateLimit(`documents-write:${admin.id}:${getIpAddress(request)}`, 30, 5 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.` },
      { status: 429 }
    );
  }

  const { id, text, metadataName, sheet, row, columns, fields } = await request.json().catch(() => ({}));
  if (!id || !text) {
    return NextResponse.json({ error: "ID chunk dan konten teks baru wajib dikirimkan." }, { status: 400 });
  }

  try {
    await callN8nCrudWebhook({
      eventType: "update_chunk",
      id: String(id),
      text,
      metadataName,
      sheet: sheet || "Manual_Edited",
      row: row ?? null,
      columns: columns || undefined,
      fields: fields || undefined
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "update_rag_chunk",
      detail: { id: String(id), metadataName }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Gagal update chunk via n8n:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memperbarui segmen data chunk. Periksa apakah workflow n8n aktif.") },
      { status: 502 }
    );
  }
}

// ========================================================
// 4. DELETE: HAPUS SATU CHUNK ATAU SELURUH FILE METADATA — LANGSUNG DB
// ========================================================
// Baik hapus satu chunk maupun hapus satu file penuh TIDAK lewat n8n —
// keduanya murni SQL DELETE, tidak butuh embedding/AI apapun. Setelah delete,
// `ANALYZE documents;` dijalankan langsung di sini supaya statistik index
// vector (HNSW) & query planner tetap akurat, tanpa bergantung pada n8n aktif
// atau tidak.
//
// Dua cara mengirim parameter (mengikuti frontend yang sudah ada):
//   - Hapus satu chunk: query string  ?id=...&metadataName=...
//   - Hapus satu file penuh: JSON body { metadataName }
export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimit = checkRateLimit(`documents-write:${admin.id}:${getIpAddress(request)}`, 30, 5 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.` },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const idFromQuery = url.searchParams.get("id") || "";
  const metadataNameFromQuery = url.searchParams.get("metadataName") || "";

  const bodyJson = await request.json().catch(() => ({}));

  // Dukungan BULK DELETE: kirim { ids: string[] } di body untuk hapus
  // banyak chunk sekaligus (dipakai fitur pilih banyak di rag-panel.tsx)
  if (Array.isArray(bodyJson?.ids) && bodyJson.ids.length) {
    try {
      const deletedCount = await withClient(async (client) => {
        const documentInfo = await getColumns(client, "documents");
        const idColumn = pickColumn(documentInfo.columns, ["id", "uuid", "document_id"]);
        if (!idColumn) throw new Error("Kolom id tidak ditemukan di tabel documents.");

        const ids = (bodyJson.ids as unknown[]).map((v) => String(v));
        const result = await client.query(
          `delete from ${documentInfo.table.sql} where ${quoteIdent(idColumn)}::text = ANY($1::text[])`,
          [ids]
        );

        try {
          await client.query("ANALYZE documents");
        } catch (analyzeError) {
          console.error("Peringatan: ANALYZE documents gagal setelah bulk delete_chunk (data tetap terhapus):", analyzeError);
        }

        return result.rowCount || 0;
      });

      await writeAuditLog({
        request,
        userId: admin.id,
        action: "bulk_delete_rag_chunk",
        detail: { count: deletedCount, ids: bodyJson.ids }
      });

      return NextResponse.json({ ok: true, deleted: deletedCount });
    } catch (error) {
      console.error("Gagal bulk hapus chunk langsung di DB:", error);
      return NextResponse.json(
        { error: formatDbError(error, "Gagal menghapus chunk terpilih.") },
        { status: 500 }
      );
    }
  }

  const metadataNameFromBody = bodyJson?.metadataName || "";
  const idFromBody = bodyJson?.id || "";

  const id = idFromQuery || idFromBody;
  const metadataName = metadataNameFromQuery || metadataNameFromBody;

  if (!id && !metadataName) {
    return NextResponse.json({ error: "Kirim id atau metadataName untuk melakukan penghapusan." }, { status: 400 });
  }

  // --------------------------------------------------------
  // Hapus SATU CHUNK → langsung ke database
  // --------------------------------------------------------
  if (id) {
    try {
      const deletedCount = await withClient(async (client) => {
        const documentInfo = await getColumns(client, "documents");
        const idColumn = pickColumn(documentInfo.columns, ["id", "uuid", "document_id"]);

        if (!idColumn) {
          throw new Error("Kolom id tidak ditemukan di tabel documents.");
        }

        const result = await client.query(
          `delete from ${documentInfo.table.sql} where ${quoteIdent(idColumn)}::text = $1::text`,
          [String(id)]
        );

        // Refresh statistik index vector (HNSW) setelah penghapusan.
        // DELETE di atas sudah ter-commit, jadi kalau ANALYZE gagal, itu TIDAK
        // boleh dilaporkan sebagai "gagal menghapus" — datanya sudah terhapus.
        // Cukup dicatat di log server saja.
        try {
          await client.query("ANALYZE documents");
        } catch (analyzeError) {
          console.error("Peringatan: ANALYZE documents gagal setelah delete_chunk (data tetap terhapus):", analyzeError);
        }

        return result.rowCount || 0;
      });

      await writeAuditLog({
        request,
        userId: admin.id,
        action: "delete_rag_chunk",
        detail: { id: String(id), metadataName: metadataName || undefined, deleted: deletedCount }
      });

      return NextResponse.json({ ok: true, deleted: deletedCount });
    } catch (error) {
      console.error("Gagal hapus chunk langsung di DB:", error);
      return NextResponse.json(
        { error: formatDbError(error, "Gagal menghapus chunk.") },
        { status: 500 }
      );
    }
  }

  // --------------------------------------------------------
  // Hapus SATU FILE PENUH → langsung ke database
  // --------------------------------------------------------
  try {
    const deletedCount = await withClient(async (client) => {
      const metadataInfo = await getColumns(client, "metadata_table");
      const documentInfo = await getColumns(client, "documents");
      const nameColumn = pickColumn(metadataInfo.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);
      const metadataColumn = pickColumn(documentInfo.columns, ["metadata"]);

      let deletedDocs = 0;

      // Hapus chunk yang match lewat field jsonb (menjaga kompatibilitas data lama)
      if (metadataColumn) {
        const metaQuote = quoteIdent(metadataColumn);
        const conditions = [
          `${metaQuote}->>'metadata_name' = $1::text`,
          `${metaQuote}->>'metadataName' = $1::text`,
          `${metaQuote}->>'source' = $1::text`,
          `${metaQuote}->>'fileName' = $1::text`
        ];
        const result = await client.query(
          `delete from ${documentInfo.table.sql} where ${conditions.join(" or ")}`,
          [metadataName]
        );
        deletedDocs += result.rowCount || 0;
      }

      // Hapus baris metadata_table — FK CASCADE otomatis membereskan sisa
      // chunk yang terhubung lewat metadata_id (kalau ada)
      if (nameColumn) {
        await client.query(
          `delete from ${metadataInfo.table.sql} where ${quoteIdent(nameColumn)}::text = $1::text`,
          [metadataName]
        );
      }

      // Refresh statistik index HNSW/vector setelah penghapusan massal.
      // Sama seperti delete_chunk: kalau ANALYZE gagal, jangan dilaporkan
      // sebagai "gagal menghapus file" — data sudah ter-commit dihapus.
      try {
        await client.query("ANALYZE documents");
      } catch (analyzeError) {
        console.error("Peringatan: ANALYZE documents gagal setelah delete_metadata (data tetap terhapus):", analyzeError);
      }

      return deletedDocs;
    });

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "delete_rag_metadata",
      detail: { metadataName, deleted: deletedCount }
    });

    return NextResponse.json({ ok: true, deleted: deletedCount });
  } catch (error) {
    console.error("Gagal hapus metadata langsung di DB:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal menghapus file data.") },
      { status: 500 }
    );
  }
}