import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var chatbotPool: Pool | undefined;
}

export type ColumnInfo = {
  column_name: string;
  data_type: string;
};

export function getPool() {
  const connectionString =
    process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/chatbot";

  if (!global.chatbotPool) {
    global.chatbotPool = new Pool({
      connectionString
    });
  }

  return global.chatbotPool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function resolveTable(client: PoolClient, wantedName: string) {
  const result = await client.query<{ table_schema: string; table_name: string }>(
    `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema')
        and lower(table_name) = lower($1)
      order by case when table_schema = 'public' then 0 else 1 end
      limit 1
    `,
    [wantedName]
  );

  const table = result.rows[0];
  if (!table) {
    throw new Error(`Tabel ${wantedName} tidak ditemukan di database.`);
  }

  return {
    schema: table.table_schema,
    name: table.table_name,
    sql: `${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`
  };
}

export async function getColumns(client: PoolClient, tableName: string) {
  const table = await resolveTable(client, tableName);
  const result = await client.query<ColumnInfo>(
    `
      select column_name, data_type
      from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position
    `,
    [table.schema, table.name]
  );
  return { table, columns: result.rows };
}

export function pickColumn(columns: ColumnInfo[], candidates: string[]) {
  const normalized = columns.map((column) => ({
    original: column.column_name,
    key: column.column_name.toLowerCase().replace(/[^a-z0-9]/g, "")
  }));

  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = normalized.find((column) => column.key === key || column.key.includes(key));
    if (match) return match.original;
  }

  return undefined;
}

export function rowsToJsonExpression(tableAlias: string, columns: ColumnInfo[]) {
  const pairs = columns
    .filter((column) => column.data_type !== "USER-DEFINED" && column.column_name !== "embedding")
    .map((column) => `'${column.column_name}', ${tableAlias}.${quoteIdent(column.column_name)}`)
    .join(", ");
  return `jsonb_build_object(${pairs || "'empty', null"})`;
}

export function formatDbError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; detail?: unknown; code?: unknown; cause?: unknown };
    const parts = [candidate.message, candidate.detail, candidate.code]
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean);

    if (parts.length) return parts.join(" ");
    if (candidate.cause) return formatDbError(candidate.cause, fallback);
  }

  return fallback;
}
