#!/bin/bash
# Concatenates all individual function files into a single migration-compatible SQL file.
# Usage: ./build-functions.sh > ../migrations/YYYYMMDDHHMMSS_functions.sql
#
# Since every function uses CREATE OR REPLACE, the output is idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNCTIONS_DIR="$SCRIPT_DIR/functions"

echo "-- Auto-generated from sql/functions/*.sql"
echo "-- Run build-functions.sh to regenerate"
echo "-- $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

for f in "$FUNCTIONS_DIR"/*.sql; do
    echo "-- ============================================================"
    echo "-- Source: $(basename "$f")"
    echo "-- ============================================================"
    cat "$f"
    echo ""
done
