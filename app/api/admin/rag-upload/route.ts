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

    const uploadFile =
      uploadFileName === fileName
        ? file
        : new File([await file.arrayBuffer()], uploadFileName, {
            type: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          });
    const form = new FormData();
    form.set("file", uploadFile);
    form.set("mode", mode);
    form.set("originalFileName", fileName);
    form.set("uploadFileName", uploadFileName);

    const response = await fetch(webhook, {
      method: "POST",
      body: form
    });

    const text = await response.text();
    let webhookResult: Record<string, unknown> = {};
    try {
      webhookResult = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      webhookResult = {};
    }

    if (!response.ok) {
      await writeAuditLog({
        request,
        userId: admin.id,
        action: "upload_rag_failed",
        detail: { fileName, uploadFileName, mode, duplicate, webhookStatus: response.status }
      });
      return NextResponse.json({ error: "Webhook n8n gagal memproses upload.", detail: text }, { status: 502 });
    }

    const webhookOk = webhookResult.ok === true || webhookResult.success === true;
    const documentCount = Number(
      webhookResult.documentCount ?? webhookResult.document_count ?? webhookResult.count ?? 0
    );

    if (!webhookOk || !Number.isFinite(documentCount) || documentCount < 1) {
      const verificationError =
        "Respons n8n belum menyatakan proses RAG berhasil. Pastikan workflow mengembalikan ok: true dan documentCount setelah metadata, chunk, dan embedding tersimpan.";
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
          webhookResponse: text.slice(0, 1000),
          webhookOk,
          documentCount
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
      response: webhookResult
    });
  } catch (error) {
    await writeAuditLog({
      request,
      userId: admin.id,
      action: "upload_rag_error",
      detail: { fileName, uploadFileName, mode, error: formatDbError(error, "Upload gagal.") }
    });
    return NextResponse.json({ error: formatDbError(error, "Upload gagal.") }, { status: 500 });
  }
}
