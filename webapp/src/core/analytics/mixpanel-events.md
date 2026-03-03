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

> **Global properties** — Every client event automatically includes `is_authenticated` (boolean) and `plan_type` (`basic` | `pro_trial` | `pro`).

| Event | Trigger | Properties |
|---|---|---|
| `export_completed` | Download or publish finishes (or fails) | `quality`, `fps`, `export_type`, `is_authenticated`, `is_pro`, `export_duration_seconds`, `upload_duration_seconds` (publish only), `success`, `error` (on failure), `recording_type`, `input_duration`, `output_duration`, `first_url`, `events_clicks`, `events_keyboard`, `events_typing`, `events_drags`, `events_hovered_cards`, `events_url_changes`, `screen_mode`, `screen_border_radius`, `screen_padding`, `screen_device_frame_id`, `screen_toolbar_enabled`, `output_crop`, `has_camera`, `camera_shape`, `camera_feather`, `background_type`, `background_color_mode`, `background_image_choice`, `music_enabled`, `music_choice`, `mic_muted`, `screen_audio_muted`, `click_effect_enabled`, `click_sound_enabled`, `drag_effect_enabled`, `hotkeys_enabled`, `zoom_count`, `spotlight_count`, `camera_move_count`, `caption_count`, `captions_generated`, `captions_visible`, `auto_cut_used` |
| `captions_generated` | Transcription succeeds | `segment_count`, `is_authenticated`, `is_pro` |
| `project_created` | New project initialized (or import failed) | `duration_seconds`, `recording_type`, `microphone_on`, `webcam_on`, `has_system_audio`, `first_url`, `user_id`, `user_event_count`, `has_click_events`, `has_keyboard_events`, `has_typing_events`, `has_drag_events`, `has_hovered_cards`, `auto_zoom_count`, `auto_spotlight_count`, `screen_frame_rate`, `camera_frame_rate`, `total_projects_created`, `success`, `error` |
| `upgrade_modal_viewed` | Upgrade modal opened | — |
| `upgrade_modal_dismissed` | Upgrade modal closed without action | — |
| `get_pro_clicked` | "Get Pro" button clicked | `billing_interval` (`monthly`\|`yearly`) |
| `extension_installed` | Extension freshly installed (fired from welcome page) | — |
| `extension_uninstalled` | Extension removed (fired from farewell page) | — |
| `project_opened` | Project opened from dashboard | — |

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
