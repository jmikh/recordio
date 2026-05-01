#!/bin/bash
# Builds migration files from ONLY the sql/ source files that have changed
# (according to git). This avoids re-deploying all functions/crons on every run,
# limiting blast radius if a bug is introduced.
#
# Only files with git changes (modified, added, untracked) in sql/functions/
# and sql/crons/ are included in the generated migration.
#
# Usage:
#   sql/build-functions.sh          — build from git-changed files only
#   sql/build-functions.sh --all    — build from ALL files (original behavior)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNCTIONS_DIR="$SCRIPT_DIR/functions"
CRONS_DIR="$SCRIPT_DIR/crons"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"
COUNTER=0

# Resolve the repo root for git commands
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

get_changed_files() {
    local src_dir="$1"
    local rel_dir="${src_dir#$REPO_ROOT/}"

    # Get files that are modified, added, or untracked relative to HEAD
    git -C "$REPO_ROOT" diff --name-only HEAD -- "$rel_dir"/*.sql 2>/dev/null
    git -C "$REPO_ROOT" diff --name-only --cached -- "$rel_dir"/*.sql 2>/dev/null
    git -C "$REPO_ROOT" ls-files --others --exclude-standard -- "$rel_dir"/*.sql 2>/dev/null
}

build_migration() {
    local src_dir="$1"
    local label="$2"
    local mode="$3"

    local files=()

    if [[ "$mode" == "--all" ]]; then
        # Include everything
        for f in "$src_dir"/*.sql; do
            [[ -f "$f" ]] && files+=("$f")
        done
    else
        # Only include git-changed files
        local changed
        changed="$(get_changed_files "$src_dir" | sort -u)"
        if [[ -z "$changed" ]]; then
            echo "No changed .sql files in $src_dir — skipping $label"
            return
        fi
        while IFS= read -r rel_path; do
            local full_path="$REPO_ROOT/$rel_path"
            [[ -f "$full_path" ]] && files+=("$full_path")
        done <<< "$changed"
    fi

    if [[ ${#files[@]} -eq 0 ]]; then
        echo "No .sql files to process in $src_dir — skipping $label"
        return
    fi

    local ts="$(date -u '+%Y%m%d%H%M%S')"
    # Offset each migration by 1 second to avoid duplicate timestamps
    ts=$((ts + COUNTER))
    COUNTER=$((COUNTER + 1))
    local out="$MIGRATIONS_DIR/${ts}_${label}.sql"

    {
        echo "-- Auto-generated from sql/${label}/*.sql"
        echo "-- Run sql/build-functions.sh to regenerate"
        echo "-- $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        echo ""

        for f in "${files[@]}"; do
            echo "-- ============================================================"
            echo "-- Source: $(basename "$f")"
            echo "-- ============================================================"
            cat "$f"
            echo ""
        done
    } > "$out"

    echo "Wrote $out ($(basename "${files[@]}" | wc -l | tr -d ' ') file(s))"
}

MODE="${1:-}"

build_migration "$FUNCTIONS_DIR" "functions" "$MODE"
build_migration "$CRONS_DIR" "crons" "$MODE"
