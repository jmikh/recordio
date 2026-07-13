/**
 * Minimal query surface of pg.Pool. The real adapter is a pg Pool pointed
 * at Supavisor; end-to-end tests use a pool pointed at the local
 * `supabase start` Postgres — SQL is never faked.
 */
export interface Db {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
