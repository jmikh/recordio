# Mixpanel Events Reference

> Living document. Keep in sync with code in `analytics/index.ts` (client) and `stripe-webhooks/index.ts` (server).

## Server-Side Events (Stripe Webhook)

| Event | Trigger | Properties |
|---|---|---|
| `subscription_created` | Checkout completed | `billing_interval` (`monthly`\|`yearly`), `price` (cents), `currency` |
| `plan_type_changed` | Any plan transition | `previous_plan_type`, `new_plan_type` (`basic`\|`pro_trial`\|`pro`), `billing_interval` |
| `subscription_cancel_scheduled` | `cancel_at_period_end` → true | `billing_interval`, `remaining_days`, `cancel_at` (ISO date) |
| `subscription_reactivated` | `cancel_at_period_end` → false | `billing_interval` |

## Client-Side Events (Browser SDK)

| Event | Trigger | Properties |
|---|---|---|
| `export_completed` | Download or publish finishes | `quality`, `fps`, `duration_seconds`, `export_type` (`download`\|`publish`), `is_authenticated`, `is_pro` |
| `captions_generated` | Transcription succeeds | `segment_count`, `is_authenticated`, `is_pro` |
| `project_created` | New project initialized | `duration_seconds`, `recording_type`, `microphone_on`, `webcam_on`, `has_system_audio`, `first_url`, `user_id`, `user_event_count`, `has_click_events`, `has_keyboard_events`, `has_typing_events`, `has_drag_events`, `has_hovered_cards`, `auto_zoom_count`, `auto_spotlight_count`, `screen_frame_rate`, `camera_frame_rate`, `total_projects_created` |

## Profile Properties (`people.set`)

| Property | Set by | Type | Description |
|---|---|---|---|
| `$email` | Client + Server | string | User email |
| `current_plan_type` | Server | `basic` \| `pro_trial` \| `pro` | Current plan tier |
| `last_active_plan_type` | Server | `pro_trial` \| `pro` \| null | Plan before downgrade |
| `last_active_plan_end_date` | Server | ISO date \| null | When last active plan ended |
| `first_pro_date` | Server (set_once) | ISO date \| null | First time user became pro |
| `signup_date` | Client (set_once) | ISO date | Account creation date |
| `billing_interval` | Server | `monthly` \| `yearly` \| null | Billing cycle |
| `subscription_status` | Server | string \| null | Raw Stripe status |
| `cancel_at_period_end` | Server | boolean | Auto-renews? (false = auto-renews) |
| `current_period_end` | Server | ISO date \| null | When plan expires/renews |
| `total_projects_created` | Client (increment) | number | Lifetime projects created |
| `total_exports` | Client (increment) | number | Lifetime exports completed |
| `last_active_date` | Client | ISO date | Last event timestamp |

## Revenue Tracking

| Method | Trigger | Amount |
|---|---|---|
| `track_charge` (+) | `subscription_created` + renewal | `price / 100` (dollars) |
| `track_charge` (−) | Refund (future) | `−amount / 100` |

## Plan Type Derivation

```
active         → 'pro'
trialing       → 'pro_trial'
everything else → 'basic'
```
