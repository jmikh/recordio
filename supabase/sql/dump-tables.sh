#!/bin/bash
# Dumps the current schema for each public table into sql/tables/<tablename>.sql
# These files are reference snapshots — not used for migrations.
#
# Usage:
#   ./dump-tables.sh              # dumps from the linked remote project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPABASE_DIR="$SCRIPT_DIR/.."
TABLES_DIR="$SCRIPT_DIR/tables"
mkdir -p "$TABLES_DIR"

DB_FLAGS="--linked"

# Get list of public tables
TABLES=$(supabase db query $DB_FLAGS -o csv \
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename" \
    | tail -n +2)

if [[ -z "$TABLES" ]]; then
    echo "No tables found (is Supabase running?)"
    exit 1
fi

COUNT=0
for TABLE in $TABLES; do
    OUT="$TABLES_DIR/$TABLE.sql"
    supabase db query $DB_FLAGS "
        SELECT
            'CREATE TABLE IF NOT EXISTS public.$TABLE (' || E'\n' ||
            string_agg(
                '    \"' || c.column_name || '\" ' ||
                UPPER(c.data_type) ||
                CASE WHEN c.character_maximum_length IS NOT NULL
                     THEN '(' || c.character_maximum_length || ')'
                     ELSE '' END ||
                CASE WHEN c.numeric_precision IS NOT NULL AND c.data_type = 'numeric'
                     THEN '(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                     ELSE '' END ||
                CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
                CASE WHEN c.column_default IS NOT NULL
                     THEN ' DEFAULT ' || c.column_default
                     ELSE '' END,
                ',' || E'\n'
                ORDER BY c.ordinal_position
            ) || E'\n);' AS ddl
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = '$TABLE';
    " | sed '1d' > "$OUT"

    echo "  $TABLE -> sql/tables/$TABLE.sql"
    COUNT=$((COUNT + 1))
done

echo "Dumped $COUNT tables into sql/tables/"
