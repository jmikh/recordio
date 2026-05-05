-- ============================================================================
-- Seed data for local Supabase testing
-- ============================================================================
-- Run after `supabase start` applies migrations.
-- Creates test users, subscriptions, and sample projects.

-- 0. Vault secrets (so crons and triggers can resolve URLs locally)
SELECT vault.create_secret('http://host.docker.internal:54321', 'SUPABASE_URL', 'Local Supabase API URL');
SELECT vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU', 'SUPABASE_SECRET_KEY', 'Local Supabase service role key');

-- 1. Test users (local Supabase allows direct inserts into auth.users)

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, phone_change,
    phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
) VALUES
-- Pro user (active subscription)
(
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'pro@test.local',
    '$2a$10$e7ea8qYnRKTYrIDNLTMKfuVdH4sy1D9ni.7nT2dFizeB35QOygDgm',
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Pro User"}'::jsonb,
    '', '', '', '', '', '', '', '',
    false, false
),
-- Free/trial user
(
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'trial@test.local',
    '$2a$10$e7ea8qYnRKTYrIDNLTMKfuVdH4sy1D9ni.7nT2dFizeB35QOygDgm',
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Trial User"}'::jsonb,
    '', '', '', '', '', '', '', '',
    false, false
)
ON CONFLICT (id) DO NOTHING;

-- auth.identities (required for email login to work)
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
(
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"pro@test.local"}'::jsonb,
    'email',
    NOW(), NOW(), NOW()
),
(
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"trial@test.local"}'::jsonb,
    'email',
    NOW(), NOW(), NOW()
)
ON CONFLICT DO NOTHING;

-- 2. User profiles (on_user_signup_create_user_profile trigger doesn't fire in seed context)

INSERT INTO public.user_profiles (user_id, name, trial_ends_at)
VALUES
('11111111-1111-1111-1111-111111111111', 'Pro User', NOW() - INTERVAL '30 days'),
('22222222-2222-2222-2222-222222222222', 'Trial User', NOW() + INTERVAL '5 days')
ON CONFLICT (user_id) DO NOTHING;

-- 3. Subscriptions

INSERT INTO public.subscriptions (user_id, status, stripe_customer_id, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end)
VALUES
('11111111-1111-1111-1111-111111111111', 'active', 'cus_test_pro', 'sub_test_pro', 'monthly', NOW() + INTERVAL '15 days', false),
('22222222-2222-2222-2222-222222222222', 'trialing', NULL, NULL, NULL, NOW() + INTERVAL '5 days', true)
ON CONFLICT (user_id) DO NOTHING;

-- 4. Sample projects

-- Minimal project (screen only, no effects)
INSERT INTO public.projects (id, user_id, name, project_data, upload_status, cloud_version, duration_ms)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'Minimal Test Project',
    '{
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/screen.webm",
            "durationMs": 5000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": true
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 30,
            "backgroundType": "gradient",
            "backgroundGradient": {"colorA": "#1a1a2e", "colorB": "#16213e", "angle": 135},
            "backgroundPaddingPx": 64,
            "borderRadiusPx": 12,
            "shadowIntensity": 0.5,
            "cameraEnabled": false,
            "captionsEnabled": false,
            "mouseClickEffectEnabled": true,
            "mouseClickEffectStyle": "ripple",
            "deviceFrameEnabled": false,
            "cursorEnabled": true,
            "cursorSizeMultiplier": 1.0,
            "backgroundMusicEnabled": false
        },
        "timeline": {
            "id": "t-minimal",
            "durationMs": 5000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 5000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCaptions": false, "showCameraMove": false}
        }
    }'::jsonb,
    'ready',
    1,
    5000
) ON CONFLICT (id) DO NOTHING;

-- Full project (screen + camera + mic, zoom segments, captions)
INSERT INTO public.projects (id, user_id, name, project_data, upload_status, cloud_version, duration_ms)
VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '11111111-1111-1111-1111-111111111111',
    'Full Test Project',
    '{
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/screen.webm",
            "durationMs": 10000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": true
        },
        "cameraSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/camera.webm",
            "durationMs": 10000,
            "size": {"width": 640, "height": 480}
        },
        "microphoneSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/mic.wav",
            "durationMs": 10000
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 30,
            "backgroundType": "gradient",
            "backgroundGradient": {"colorA": "#0f0f23", "colorB": "#1a1a3e", "angle": 180},
            "backgroundPaddingPx": 48,
            "borderRadiusPx": 16,
            "shadowIntensity": 0.6,
            "cameraEnabled": true,
            "cameraShape": "circle",
            "cameraSizePx": 200,
            "cameraPosition": "bottom-right",
            "captionsEnabled": true,
            "captionPosition": "bottom",
            "captionFontFamily": "Inter",
            "captionSize": 1.0,
            "mouseClickEffectEnabled": true,
            "mouseClickEffectStyle": "ripple",
            "deviceFrameEnabled": false,
            "cursorEnabled": true,
            "cursorSizeMultiplier": 1.0,
            "backgroundMusicEnabled": false
        },
        "timeline": {
            "id": "t-full",
            "durationMs": 10000,
            "outputWindows": [
                {"id": "ow1", "startMs": 0, "endMs": 4000, "speed": 1},
                {"id": "ow2", "startMs": 5000, "endMs": 10000, "speed": 1.5}
            ],
            "zoomSegments": [
                {
                    "id": "z1",
                    "sourceStartTimeMs": 1000, "sourceEndTimeMs": 3000,
                    "outputStartTimeMs": 1000, "outputEndTimeMs": 3000,
                    "visible": true,
                    "rectPx": {"x": 400, "y": 200, "width": 1120, "height": 630},
                    "reason": "test zoom",
                    "type": "manual",
                    "transitionDurationMs": 300,
                    "easing": "ease-out"
                }
            ],
            "spotlightSegments": [],
            "captionSegments": [
                {
                    "id": "cap1",
                    "sourceStartTimeMs": 500, "sourceEndTimeMs": 2500,
                    "outputStartTimeMs": 500, "outputEndTimeMs": 2500,
                    "visible": true,
                    "words": [
                        {"id": "w1", "word": "Hello", "sourceStartTimeMs": 500, "sourceEndTimeMs": 1200, "outputStartTimeMs": 500, "outputEndTimeMs": 1200, "visible": true},
                        {"id": "w2", "word": "world", "sourceStartTimeMs": 1200, "sourceEndTimeMs": 2500, "outputStartTimeMs": 1200, "outputEndTimeMs": 2500, "visible": true}
                    ]
                }
            ],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCaptions": true, "showCameraMove": true}
        }
    }'::jsonb,
    'ready',
    3,
    10000
) ON CONFLICT (id) DO NOTHING;

-- Trial user's project (with expiry)
INSERT INTO public.projects (id, user_id, name, project_data, upload_status, cloud_version, duration_ms, expires_at)
VALUES (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '22222222-2222-2222-2222-222222222222',
    'Trial User Project',
    '{
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "22222222-2222-2222-2222-222222222222/cccccccc-cccc-cccc-cccc-cccccccccccc/screen.webm",
            "durationMs": 3000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": false
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 30,
            "backgroundType": "solid",
            "backgroundPaddingPx": 32,
            "borderRadiusPx": 8,
            "cameraEnabled": false,
            "captionsEnabled": false,
            "mouseClickEffectEnabled": false,
            "deviceFrameEnabled": false,
            "cursorEnabled": true,
            "backgroundMusicEnabled": false
        },
        "timeline": {
            "id": "t-trial",
            "durationMs": 3000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 3000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCaptions": false, "showCameraMove": false}
        }
    }'::jsonb,
    'ready',
    1,
    3000,
    NOW() + INTERVAL '12 days'
) ON CONFLICT (id) DO NOTHING;

-- 5. Transcription usage
INSERT INTO public.transcription_usage (user_id, minutes_used, minutes_limit, reset_date)
VALUES
('11111111-1111-1111-1111-111111111111', 15.5, 60, NOW() + INTERVAL '15 days'),
('22222222-2222-2222-2222-222222222222', 0, 60, NOW() + INTERVAL '5 days')
ON CONFLICT (user_id) DO NOTHING;
