import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, withClient } from "@/lib/db";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await withClient(async (client) => {
      const statsResult = await client.query(`
        select
          relname as table_name,
          n_live_tup as row_count,
          last_analyze::text as last_analyze,
          last_autoanalyze::text as last_autoanalyze,
          analyze_count,
          autoanalyze_count,
          pg_size_pretty(pg_total_relation_size(relid)) as total_size
        from pg_stat_user_tables
        where relname in ('documents', 'chat_history', 'metadata_table', 'visitors', 'chat_sessions')
        order by pg_total_relation_size(relid) desc
      `);

      const indexResult = await client.query(`
        select
          indexname as index_name,
          tablename as table_name,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        from pg_indexes
        join pg_class on pg_class.relname = indexname
        join pg_stat_user_indexes on pg_stat_user_indexes.indexrelname = indexname
        where schemaname = 'public'
          and tablename in ('documents', 'chat_history', 'metadata_table', 'visitors', 'chat_sessions')
        order by pg_relation_size(indexrelid) desc
      `).catch(() => ({ rows: [] }));

      const dbSizeResult = await client.query(`select pg_size_pretty(pg_database_size(current_database())) as db_size`);

      return {
        tables: statsResult.rows,
        indexes: indexResult.rows,
        databaseSize: dbSizeResult.rows[0]?.db_size || null
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat statistik database.") },
      { status: 500 }
    );
  }
}