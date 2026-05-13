#!/bin/bash
# reset-local.sh
# Full local dev reset: DB + SQL functions + fresh Stripe test data.
#
# Usage:
#   supabase/reset-local.sh
#
# What it does:
#   1. supabase db reset  (runs migrations + seed.sql)
#   2. sql/deploy.sh      (deploys functions/crons/triggers)
#   3. Deletes old Stripe seed customers from sandbox
#   4. Creates fresh Stripe customers + subscriptions (pm_card_visa test card)
#   5. Updates local DB subscriptions with new Stripe IDs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"
ENV_FILE="$SCRIPT_DIR/.env.local"

# ── Load .env.local ──────────────────────────────────────────────────────────
load_env() {
    while IFS= read -r line; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line//[[:space:]]/}" ]] && continue
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
        fi
    done < "$ENV_FILE"
}
load_env

STRIPE_KEY="$STRIPE_SECRET_KEY"

# Calls the Stripe API and exits with a clear error if Stripe returns an error object.
stripe_api() {
    local method="$1" path="$2"
    shift 2
    local response
    response=$(curl -s -X "$method" "https://api.stripe.com/v1/$path" \
        -u "$STRIPE_KEY:" "$@")
    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        echo "ERROR: Stripe API failure (${method} ${path}):" >&2
        echo "$response" | jq -r '.error.message' >&2
        exit 1
    fi
    echo "$response"
}

# ── 1. DB reset ───────────────────────────────────────────────────────────────
echo "▶ Resetting local DB..."
cd "$PROJECT_ROOT"
supabase db reset
cd - > /dev/null

# ── 2. Deploy SQL functions/crons/triggers ────────────────────────────────────
echo ""
echo "▶ Deploying SQL..."
"$SCRIPT_DIR/sql/deploy.sh"

# ── 3. Delete old Stripe seed customers ───────────────────────────────────────
# Search Stripe by metadata workspaceId — avoids relying on the DB which gets
# wiped and re-seeded with stale placeholder IDs before this step runs.
echo ""
echo "▶ Cleaning up old Stripe seed customers..."

delete_customer() {
    local cus_id="$1" label="$2"
    [[ "$cus_id" =~ ^cus_ ]] || return 0
    echo "  Deleting $label: $cus_id"
    local response
    response=$(curl -s -X DELETE "https://api.stripe.com/v1/customers/$cus_id" \
        -u "$STRIPE_KEY:")
    local err_code
    err_code=$(echo "$response" | jq -r '.error.code // empty')
    if [[ "$err_code" == "resource_missing" ]]; then
        echo "  (already gone)"
    elif echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        echo "ERROR: Failed to delete customer $cus_id:" >&2
        echo "$response" | jq -r '.error.message' >&2
        exit 1
    fi
}

list_response=$(curl -s "https://api.stripe.com/v1/customers?limit=100" -u "$STRIPE_KEY:")
if echo "$list_response" | jq -e '.error' > /dev/null 2>&1; then
    echo "ERROR: Failed to list Stripe customers:" >&2
    echo "$list_response" | jq -r '.error.message' >&2
    exit 1
fi

seed_ids=$(echo "$list_response" \
    | jq -r '.data[] | select((.name // "") | test("\\(seed\\)")) | .id')

if [[ -z "$seed_ids" ]]; then
    echo "  No existing seed customers found"
else
    while IFS= read -r cus_id; do
        delete_customer "$cus_id" "seed"
    done <<< "$seed_ids"
fi

# ── 4. Create fresh Stripe customers + subscriptions ──────────────────────────
# pm_card_visa is a Stripe test token — attaching it creates a real PM with its
# own ID. We capture that ID and use it as default_payment_method on the sub.

echo ""
echo "▶ Creating Stripe customers + subscriptions..."

BIZ_CUSTOMER=$(stripe_api POST "customers" \
    -d "email=user1@gmail.com" \
    -d "name=User One - Business Team (seed)" \
    -d "metadata[userId]=11111111-1111-1111-1111-111111111111" \
    -d "metadata[workspaceId]=eeeeeeee-0000-0000-0000-000000000002" \
    | jq -r '.id')
echo "  Business customer: $BIZ_CUSTOMER"

BIZ_PM=$(stripe_api POST "payment_methods/pm_card_visa/attach" \
    -d "customer=$BIZ_CUSTOMER" | jq -r '.id')
echo "  Business payment method: $BIZ_PM"

stripe_api POST "customers/$BIZ_CUSTOMER" \
    -d "invoice_settings[default_payment_method]=$BIZ_PM" | jq -r '.id' > /dev/null

BIZ_SUB=$(stripe_api POST "subscriptions" \
    -d "customer=$BIZ_CUSTOMER" \
    -d "items[0][price]=$STRIPE_TEAMS_PRICE_ID_YEARLY" \
    -d "items[0][quantity]=5" \
    -d "default_payment_method=$BIZ_PM" \
    | jq -r '.id')
echo "  Business subscription: $BIZ_SUB"

PRO_CUSTOMER=$(stripe_api POST "customers" \
    -d "email=user1@gmail.com" \
    -d "name=User One - Pro Team (seed)" \
    -d "metadata[userId]=11111111-1111-1111-1111-111111111111" \
    -d "metadata[workspaceId]=eeeeeeee-0000-0000-0000-000000000003" \
    | jq -r '.id')
echo "  Pro customer: $PRO_CUSTOMER"

PRO_PM=$(stripe_api POST "payment_methods/pm_card_visa/attach" \
    -d "customer=$PRO_CUSTOMER" | jq -r '.id')
echo "  Pro payment method: $PRO_PM"

stripe_api POST "customers/$PRO_CUSTOMER" \
    -d "invoice_settings[default_payment_method]=$PRO_PM" | jq -r '.id' > /dev/null

PRO_SUB=$(stripe_api POST "subscriptions" \
    -d "customer=$PRO_CUSTOMER" \
    -d "items[0][price]=$STRIPE_PRICE_ID_MONTHLY" \
    -d "default_payment_method=$PRO_PM" \
    | jq -r '.id')
echo "  Pro subscription: $PRO_SUB"

# Validate all IDs before touching the DB
for var_name in BIZ_CUSTOMER BIZ_PM BIZ_SUB PRO_CUSTOMER PRO_PM PRO_SUB; do
    val="${!var_name}"
    if [[ -z "$val" || "$val" == "null" ]]; then
        echo "ERROR: $var_name is empty — aborting DB update" >&2
        exit 1
    fi
done

# ── 5. Update local DB with new Stripe IDs ────────────────────────────────────
echo ""
echo "▶ Updating local DB..."

psql "$DB_URL" <<SQL
UPDATE public.subscriptions
SET
    stripe_customer_id     = '$BIZ_CUSTOMER',
    stripe_subscription_id = '$BIZ_SUB',
    status                 = 'active'
WHERE workspace_id = 'eeeeeeee-0000-0000-0000-000000000002';

UPDATE public.subscriptions
SET
    stripe_customer_id     = '$PRO_CUSTOMER',
    stripe_subscription_id = '$PRO_SUB',
    status                 = 'active'
WHERE workspace_id = 'eeeeeeee-0000-0000-0000-000000000003';
SQL

echo ""
echo "✓ Done."
echo ""
echo "  Business Team: $BIZ_CUSTOMER / $BIZ_SUB"
echo "  Pro Team:      $PRO_CUSTOMER / $PRO_SUB"
