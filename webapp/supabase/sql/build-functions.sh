#!/bin/bash
# Builds two idempotent migration files from sql/ source directories:
#   migrations/<timestamp>_functions.sql  — from sql/functions/*.sql
#   migrations/<timestamp>_crons.sql      — from sql/crons/*.sql
#
# All definitions use CREATE OR REPLACE / IF NOT EXISTS, so re-running is safe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNCTIONS_DIR="$SCRIPT_DIR/functions"
CRONS_DIR="$SCRIPT_DIR/crons"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"
COUNTER=0

build_migration() {
    local src_dir="$1"
    local label="$2"
    local ts="$(date -u '+%Y%m%d%H%M%S')"
    # Offset each migration by 1 second to avoid duplicate timestamps
    ts=$((ts + COUNTER))
    COUNTER=$((COUNTER + 1))
    local out="$MIGRATIONS_DIR/${ts}_${label}.sql"

    if ! ls "$src_dir"/*.sql &>/dev/null; then
        echo "No .sql files in $src_dir — skipping $label"
        return
    fi

    {
        echo "-- Auto-generated from sql/${label}/*.sql"
        echo "-- Run sql/build-functions.sh to regenerate"
        echo "-- $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        echo ""

        for f in "$src_dir"/*.sql; do
            echo "-- ============================================================"
            echo "-- Source: $(basename "$f")"
            echo "-- ============================================================"
            cat "$f"
            echo ""
        done
    } > "$out"

    echo "Wrote $out"
}

build_migration "$FUNCTIONS_DIR" "functions"
build_migration "$CRONS_DIR" "crons"
