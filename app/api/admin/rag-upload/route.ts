import { NextResponse } from "next/server";
import { getCurrentAdmin, isAuthenticated } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

type UploadMode = "reject" | "overwrite" | "duplicate";

function splitFileName(fileName: string) {
  const match = fileName.match(/^(.*?)(\.[^.]+)?$/);
  return {
    base: match?.[1] || fileName,
    ext: match?.[2] || ""
  };
}

// columnsBySheet: { [sheetName]: string[] } — header kolom tiap sheet, dikirim
// dari frontend (hasil parsing SheetJS sebelum file diupload ke n8n). Disimpan
// LANGSUNG oleh backend Next.js, TIDAK bergantung pada n8n mengetahui struktur
// file ini — jadi "kolom apa saja" selalu bisa diketahui walau n8n belum/tidak
// mengembalikan info itu.
async function upsertMetadataStatus(
  uploadFileName: string,
  status: "processing" | "success" | "failed",
  errorMessage?: string,
  columnsBySheet?: Record<string, string[]>
) {
  await withClient(async (client) => {
    const info = await getColumns(client, "metadata_table");
    const nameColumn = pickColumn(info.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);
    const statusColumn = pickColumn(info.columns, ["status", "upload_status"]);
    const errorColumn = pickColumn(info.columns, ["error_message", "errorMessage", "last_error"]);
    const updatedColumn = pickColumn(info.columns, ["updated_at", "updatedAt"]);
    const columnsColumn = pickColumn(info.columns, ["columns", "column_list", "headers"]);

    if (!nameColumn) return;

    await client.query(
      `
        insert into ${info.table.sql} (${quoteIdent(nameColumn)})
        select $1::text
        where not exists (
          select 1 from ${info.table.sql}
          where lower(${quoteIdent(nameColumn)}::text) = lower($1::text)
        )
      `,
      [uploadFileName]
    );

    const sets: string[] = [];
    const params: Array<string> = [uploadFileName];

    if (statusColumn) {
      params.push(status);
      sets.push(`${quoteIdent(statusColumn)} = $${params.length}::text`);
    }

    if (errorColumn) {
      params.push(errorMessage || "");
      sets.push(`${quoteIdent(errorColumn)} = nullif($${params.length}::text, '')`);
    }

    // Simpan struktur kolom cuma kalau memang dikirim (biasanya sekali, saat
    // status "processing" pertama kali) — supaya tidak menimpa data yang
    // sudah ada dengan null saat status di-update ke "success"/"failed".
    if (columnsColumn && columnsBySheet) {
      params.push(JSON.stringify(columnsBySheet));
      sets.push(`${quoteIdent(columnsColumn)} = $${params.length}::jsonb`);
    }

    if (updatedColumn) {
      sets.push(`${quoteIdent(updatedColumn)} = now()`);
    }

    if (sets.length) {
      await client.query(
        `
          update ${info.table.sql}
          set ${sets.join(", ")}
          where lower(${quoteIdent(nameColumn)}::text) = lower($1::text)
        `,
        params
      );
    }
  });
}

async function checkDuplicateFileName(fileName: string) {
  const { base: fileBaseName } = splitFileName(fileName);

  return withClient(async (client) => {
    const info = await getColumns(client, "metadata_table");
    const nameColumn = pickColumn(info.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);

    if (!nameColumn) return false;

    const result = await client.query(
      `
        select 1
        from ${info.table.sql}
        where lower(${quoteIdent(nameColumn)}::text) in (lower($1::text), lower($2::text))
        limit 1
      `,
      [fileName, fileBaseName]
    );

    return (result.rowCount || 0) > 0;
  });
}

async function countDocumentsBySource(fileName: string) {
  const { base: fileBaseName } = splitFileName(fileName);

  return withClient(async (client) => {
    const info = await getColumns(client, "documents");
    const metadataColumn = pickColumn(info.columns, ["metadata"]);
    const metadataSourceColumn = pickColumn(info.columns, ["metadata_source", "metadataSource"]);
    const conditions: string[] = [];

    if (metadataSourceColumn) {
      conditions.push(
        `lower(${quoteIdent(metadataSourceColumn)}::text) in (lower($1::text), lower($2::text))`
      );
    }

    if (metadataColumn) {
      const metadata = quoteIdent(metadataColumn);
      conditions.push(`lower(${metadata}->>'source') in (lower($1::text), lower($2::text))`);
      conditions.push(`lower(${metadata}#>>'{source,source}') in (lower($1::text), lower($2::text))`);
      conditions.push(`lower(${metadata}->>'metadata_name') in (lower($1::text), lower($2::text))`);
      conditions.push(`lower(${metadata}->>'metadataName') in (lower($1::text), lower($2::text))`);
      conditions.push(`lower(${metadata}->>'fileName') in (lower($1::text), lower($2::text))`);
    }

    if (!conditions.length) return 0;

    const result = await client.query<{ count: number }>(
      `
        select count(*)::int as count
        from ${info.table.sql}
        where ${conditions.join(" or ")}
      `,
      [fileName, fileBaseName]
    );

    return result.rows[0]?.count || 0;
  });
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const fileName = url.searchParams.get("fileName")?.trim();

  if (!fileName) {
    return NextResponse.json({ error: "Nama file wajib dikirim." }, { status: 400 });
  }

  try {
    const duplicate = await checkDuplicateFileName(fileName);
    return NextResponse.json({ duplicate });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal mengecek metadata file.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const webhook = process.env.N8N_RAG_UPLOAD_WEBHOOK;
  if (!webhook) {
    return NextResponse.json({ error: "N8N_RAG_UPLOAD_WEBHOOK belum diatur." }, { status: 500 });
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  const requestedMode = String(incoming.get("mode") || "reject");
  const mode: UploadMode =
    requestedMode === "overwrite" || requestedMode === "duplicate" ? requestedMode : "reject";

  // Struktur kolom (header) tiap sheet, dikirim frontend hasil parsing SheetJS
  // SEBELUM file dikirim ke n8n. Ini disimpan backend sendiri ke metadata_table,
  // independen dari apapun yang n8n lakukan/kembalikan.
  const columnsBySheetRaw = String(incoming.get("columnsBySheet") || "");
  let columnsBySheet: Record<string, string[]> | undefined;
  if (columnsBySheetRaw) {
    try {
      const parsed = JSON.parse(columnsBySheetRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        columnsBySheet = parsed;
      }
    } catch {
      columnsBySheet = undefined;
    }
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File Excel wajib dipilih." }, { status: 400 });
  }

  const fileName = file.name;
  const { base: fileBaseName, ext } = splitFileName(fileName);
  const uploadFileName =
    mode === "duplicate"
      ? `${fileBaseName}-duplikat-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}${ext}`
      : fileName;

  try {
    const duplicate = await checkDuplicateFileName(fileName).catch(() => false);

    if (duplicate && mode === "reject") {
      return NextResponse.json(
        {
          duplicate: true,
          error: "File ini sudah pernah diupload. Kirim mode overwrite jika ingin menimpa data lama."
        },
        { status: 409 }
      );
    }

    if (duplicate && mode === "overwrite") {
      await withClient(async (client) => {
        const metadataInfo = await getColumns(client, "metadata_table");
        const documentInfo = await getColumns(client, "documents");
        const nameColumn = pickColumn(metadataInfo.columns, ["metadata_name", "metadataName", "name", "fileName", "source", "title"]);
        const metadataColumn = pickColumn(documentInfo.columns, ["metadata"]);
        const metadataSourceColumn = pickColumn(documentInfo.columns, ["metadata_source", "metadataSource"]);

        if (metadataColumn || metadataSourceColumn) {
          const conditions = [];
          if (metadataSourceColumn) {
            conditions.push(`${quoteIdent(metadataSourceColumn)}::text in ($1::text, $2::text)`);
          }
          if (metadataColumn) {
            conditions.push(`${quoteIdent(metadataColumn)}->>'source' in ($1::text, $2::text)`);
            conditions.push(`${quoteIdent(metadataColumn)}->>'metadata_name' in ($1::text, $2::text)`);
            conditions.push(`${quoteIdent(metadataColumn)}->>'metadataName' in ($1::text, $2::text)`);
            conditions.push(`${quoteIdent(metadataColumn)}->>'fileName' in ($1::text, $2::text)`);
          }

          await client.query(
            `
              delete from ${documentInfo.table.sql}
              where ${conditions.join(" or ")}
            `,
            [fileName, fileBaseName]
          );
        }

        if (nameColumn) {
          await client.query(
            `delete from ${metadataInfo.table.sql} where ${quoteIdent(nameColumn)}::text in ($1::text, $2::text)`,
            [fileName, fileBaseName]
          );
        }
      });
    }

    const uploadFile =
      uploadFileName === fileName
        ? file
        : new File([await file.arrayBuffer()], uploadFileName, {
            type: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          });
    const form = new FormData();
    form.set("file", uploadFile);

    await upsertMetadataStatus(uploadFileName, "processing", undefined, columnsBySheet);

    const response = await fetch(webhook, {
      method: "POST",
      body: form
    });

    const text = await response.text();

    if (!response.ok) {
      await upsertMetadataStatus(uploadFileName, "failed", text || "Webhook n8n gagal memproses upload.");
      await writeAuditLog({
        request,
        userId: admin.id,
        action: "upload_rag_failed",
        detail: { fileName, uploadFileName, mode, duplicate, webhookStatus: response.status }
      });
      return NextResponse.json({ error: "Webhook n8n gagal memproses upload.", detail: text }, { status: 502 });
    }

    const documentCount = await countDocumentsBySource(uploadFileName);

    if (documentCount < 1) {
      const verificationError =
        "Webhook n8n merespons berhasil, tetapi tidak ada data baru yang ditemukan di tabel documents. Periksa node chunking, embedding, dan PGVector Store.";
      await upsertMetadataStatus(uploadFileName, "failed", verificationError);
      await writeAuditLog({
        request,
        userId: admin.id,
        action: "upload_rag_verification_failed",
        detail: {
          fileName,
          uploadFileName,
          mode,
          duplicate,
          webhookStatus: response.status,
          webhookResponse: text.slice(0, 1000)
        }
      });
      return NextResponse.json(
        {
          error: verificationError,
          detail: text
        },
        { status: 502 }
      );
    }

    await upsertMetadataStatus(uploadFileName, "success");
    await writeAuditLog({
      request,
      userId: admin.id,
      action: mode === "overwrite" ? "overwrite_rag_upload" : "upload_rag_success",
      detail: { fileName, uploadFileName, mode, duplicate, documentCount }
    });

    return NextResponse.json({
      ok: true,
      duplicate,
      mode,
      metadataName: uploadFileName,
      documentCount,
      response: text
    });
  } catch (error) {
    if (typeof uploadFileName === "string") {
      await upsertMetadataStatus(uploadFileName, "failed", formatDbError(error, "Upload gagal.")).catch(() => undefined);
    }
    await writeAuditLog({
      request,
      userId: admin.id,
      action: "upload_rag_error",
      detail: { fileName, uploadFileName, mode, error: formatDbError(error, "Upload gagal.") }
    });
    return NextResponse.json({ error: formatDbError(error, "Upload gagal.") }, { status: 500 });
  }
}