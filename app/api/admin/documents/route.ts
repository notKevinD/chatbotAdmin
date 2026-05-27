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

export async function GET(request: Request) {
  if (!(await getCurrentAdmin()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const selectedMetadata = url.searchParams.get("metadata");
  const search = (url.searchParams.get("q") || "").trim();
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 100);
  const offset = (page - 1) * limit;

  try {
    const data = await withClient(async (client) => {
      const info = await getColumns(client, "documents");
      const idColumn = pickColumn(info.columns, ["id", "uuid", "document_id"]);
      const metaColumn = pickColumn(info.columns, ["metadata"]);
      const contentColumn = pickColumn(info.columns, [
        "content",
        "pageContent",
        "text",
        "document",
      ]);
      const metadataInfo = await getColumns(client, "metadata_table");
      const metadataNameColumn = pickColumn(metadataInfo.columns, [
        "metadata_name",
        "metadataName",
        "name",
        "fileName",
        "source",
        "title",
      ]);
      const metadataCreatedColumn = pickColumn(metadataInfo.columns, [
        "created_at",
        "createdAt",
        "date",
      ]);
      const metadataStatusColumn = pickColumn(metadataInfo.columns, ["status", "upload_status"]);
      const metadataErrorColumn = pickColumn(metadataInfo.columns, ["error_message", "errorMessage", "last_error"]);

      if (!metadataNameColumn) {
        throw new Error(
          "Kolom metadata_name tidak ditemukan di metadata_table.",
        );
      }

      const metadataNameExpression =
        metaColumn === "metadata"
          ? `
      coalesce(
        d.metadata->>'metadata_name',
        d.metadata->>'metadataName',
        d.metadata->'source'->>'source',
        d.metadata->>'source',
        d.metadata->>'fileName',
        'Tanpa metadata'
      )
    `
          : "'Tanpa metadata'";

      if (!selectedMetadata) {
        const metadataFilter = search
          ? `where mt.${quoteIdent(metadataNameColumn)}::text ilike $1::text`
          : "";
        const countParams = search ? [`%${search}%`] : [];
        const listParams = search ? [`%${search}%`, limit, offset] : [limit, offset];
        const limitParam = search ? "$2" : "$1";
        const offsetParam = search ? "$3" : "$2";

        const [countResult, result] = await Promise.all([
          client.query(
            `select count(*)::int as total from ${metadataInfo.table.sql} mt ${metadataFilter}`,
            countParams
          ),
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
            listParams,
          ),
        ]);
        const total = countResult.rows[0]?.total || 0;

        return {
          mode: "metadata",
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
          },
          rows: result.rows,
        };
      }

      const documentSearchCondition = search
        ? `and (
            ${contentColumn ? `d.${quoteIdent(contentColumn)}::text ilike $2::text or` : ""}
            ${metaColumn ? `d.${quoteIdent(metaColumn)}::text ilike $2::text` : "false"}
          )`
        : "";
      const detailParams = search ? [selectedMetadata, `%${search}%`] : [selectedMetadata];
      const detailLimitParam = search ? "$3" : "$2";
      const detailOffsetParam = search ? "$4" : "$3";

      const [countResult, result] = await Promise.all([
        client.query(
          `
            select count(*)::int as total
            from ${info.table.sql} d
            where ${metadataNameExpression} = $1::text
              ${documentSearchCondition}
          `,
          detailParams,
        ),
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
          [...detailParams, limit, offset],
        ),
      ]);
      const total = countResult.rows[0]?.total || 0;

      return {
        mode: "documents",
        metadataName: selectedMetadata,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        },
        columns: info.columns.map((column) => column.column_name),
        idColumn,
        metaColumn,
        rows: result.rows,
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal membaca dokumen.") },
      { status: 500 },
    );
  }
}

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
        await writeAuditLog({
          request,
          userId: admin.id,
          action: "delete_rag_chunk",
          detail: { id: String(id), deletedDocuments: deleteResult.rowCount || 0 }
        });
        return deleteResult;
      }

      if (metadataName && metaColumn) {
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
        const metadataNameColumn = pickColumn(metadataInfo.columns, [
          "metadata_name",
          "metadataName",
          "name",
          "fileName",
          "source",
          "title",
        ]);

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

      throw new Error(
        "Kolom id/metadata tidak ditemukan untuk menghapus dokumen.",
      );
    });

    return NextResponse.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal menghapus dokumen.") },
      { status: 500 },
    );
  }
}
