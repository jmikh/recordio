-- ============================================================================
-- Seed data for local Supabase testing
-- ============================================================================
-- Run after `supabase db reset` applies migrations.
-- Password for all users: password123
--
-- Users
--   user1@gmail.com  — 4 workspaces (personal + 3 team with varied subscriptions)
--   user2@gmail.com  — 1 personal workspace, no subscription
--   user3@gmail.com  — member of user1's Teams workspace
--
-- Workspaces (user1)
--   Personal          eeeeeeee-0001-...  free (no subscription row)
--   Teams Workspace   eeeeeeee-0002-...  active subscription, seats = 5
--   Pro Team          eeeeeeee-0003-...  active subscription, seats = 1
--   Unpaid Team       eeeeeeee-0004-...  no subscription row

-- ============================================================================
-- 0. Vault secrets (needed for crons/triggers locally)
-- ============================================================================

SELECT vault.create_secret('http://host.docker.internal:54321', 'SUPABASE_URL', 'Local Supabase API URL');
SELECT vault.create_secret(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    'SUPABASE_SECRET_KEY', 'Local Supabase service role key'
);
-- The Fastify server (trial_start/workspace_invite email hooks post here;
-- host.docker.internal because pg_net runs inside the DB container)
SELECT vault.create_secret('http://host.docker.internal:8090', 'SERVER_URL', 'Local Fastify server URL');

-- ============================================================================
-- 1. Auth users  (password: password123)
-- ============================================================================

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, phone_change,
    phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'user1@gmail.com',
    '$2a$10$bGG9wO7.m4EdPm58tOuSd.TUuBLj3U/6KGCzOQTNjcTzGb4MHkz0G',
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"User One"}'::jsonb,
    '', '', '', '', '', '', '', '', false, false
),
(
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'user2@gmail.com',
    '$2a$10$bGG9wO7.m4EdPm58tOuSd.TUuBLj3U/6KGCzOQTNjcTzGb4MHkz0G',
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"User Two"}'::jsonb,
    '', '', '', '', '', '', '', '', false, false
),
(
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'user3@gmail.com',
    '$2a$10$bGG9wO7.m4EdPm58tOuSd.TUuBLj3U/6KGCzOQTNjcTzGb4MHkz0G',
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"User Three"}'::jsonb,
    '', '', '', '', '', '', '', '', false, false
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Auth identities (required for email/password login)
-- ============================================================================

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
(
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"user1@gmail.com"}'::jsonb,
    'email', NOW(), NOW(), NOW()
),
(
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"user2@gmail.com"}'::jsonb,
    'email', NOW(), NOW(), NOW()
),
(
    gen_random_uuid(),
    '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333',
    '{"sub":"33333333-3333-3333-3333-333333333333","email":"user3@gmail.com"}'::jsonb,
    'email', NOW(), NOW(), NOW()
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Workspaces
-- ============================================================================

-- trial_ends_at is explicit (the column default is now() + 7d): user1's
-- workspaces carry an expired trial, user2's a live one, user3's the
-- "ends now" shape the Step 2 backfill gives the no-trial cohort.
INSERT INTO public.workspaces (id, name, owner_id, trial_ends_at) VALUES
-- user1
('eeeeeeee-0000-0000-0000-000000000001', 'My Workspace',    '11111111-1111-1111-1111-111111111111', NOW() - INTERVAL '30 days'),
('eeeeeeee-0000-0000-0000-000000000002', 'Teams Workspace', '11111111-1111-1111-1111-111111111111', NOW() - INTERVAL '30 days'),
('eeeeeeee-0000-0000-0000-000000000003', 'Pro Team',        '11111111-1111-1111-1111-111111111111', NOW() - INTERVAL '30 days'),
('eeeeeeee-0000-0000-0000-000000000004', 'Unpaid Team',     '11111111-1111-1111-1111-111111111111', NOW() - INTERVAL '30 days'),
-- user2
('eeeeeeee-0000-0000-0000-000000000005', 'My Workspace',    '22222222-2222-2222-2222-222222222222', NOW() + INTERVAL '7 days'),
-- user3
('eeeeeeee-0000-0000-0000-000000000006', 'My Workspace',    '33333333-3333-3333-3333-333333333333', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. Workspace members
-- ============================================================================

-- Owners have NO rows here (owner is its own state — workspaces.owner_id
-- implies admin, revamp Step 2); only invited members appear.
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
-- user3 is a creator in user1's Teams Workspace
('eeeeeeee-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'creator')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. User profiles
-- ============================================================================

INSERT INTO public.user_profiles (user_id, name, trial_ends_at, default_workspace_id) VALUES
('11111111-1111-1111-1111-111111111111', 'User One',   NOW() - INTERVAL '30 days', 'eeeeeeee-0000-0000-0000-000000000001'),
('22222222-2222-2222-2222-222222222222', 'User Two',   NOW() + INTERVAL '7 days',  'eeeeeeee-0000-0000-0000-000000000005'),
('33333333-3333-3333-3333-333333333333', 'User Three', NULL,                        'eeeeeeee-0000-0000-0000-000000000006')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- 6. Subscriptions (workspace-scoped, workspace_id is now PK)
--
--   Teams Workspace → active, seats = 5  (teams tier)
--   Pro Team       → active, seats = 1  (pro tier)
--   Personal user2 → trialing
--   (personal workspaces for user1/user3 and Unpaid Team have no subscription row)
-- ============================================================================

INSERT INTO public.subscriptions
    (workspace_id, user_id, plan, status, stripe_customer_id, stripe_subscription_id, billing_interval, current_period_end, cancel_at, seats)
VALUES
-- user1 · Teams Workspace: active teams subscription with 5 seats
(
    'eeeeeeee-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'teams',
    'active',
    'cus_UVJMoyMoMbn7Q5',
    'sub_1TWIlRLra3j0q9yKiFz9DIcQ',
    'yearly',
    NOW() + INTERVAL '300 days',
    NULL,
    5
),
-- user1 · Pro Team: active pro subscription, seats = 1
(
    'eeeeeeee-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    'pro',
    'active',
    'cus_UVJNoCIk5ZOOpW',
    'sub_1TWIlVLra3j0q9yKCU1U8T6l',
    'monthly',
    NOW() + INTERVAL '20 days',
    NULL,
    1
)
-- user2 has no subscription row; their trial is tracked via workspaces.trial_ends_at
ON CONFLICT (workspace_id) DO NOTHING;

-- ============================================================================
-- 7. Workspace invitations
-- ============================================================================

INSERT INTO public.workspace_invitations (id, workspace_id, email, role, invited_by, token, status, expires_at) VALUES
-- Teams Workspace: pending creator invite
(
    'ffffffff-0000-0000-0000-000000000001',
    'eeeeeeee-0000-0000-0000-000000000002',
    'newmember@example.com',
    'creator',
    '11111111-1111-1111-1111-111111111111',
    gen_random_uuid(),
    'pending',
    NOW() + INTERVAL '7 days'
),
-- Teams Workspace: pending viewer invite
(
    'ffffffff-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000002',
    'john@recordio.io',
    'viewer',
    '11111111-1111-1111-1111-111111111111',
    gen_random_uuid(),
    'pending',
    NOW() + INTERVAL '7 days'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 8. Sample projects
-- ============================================================================

-- user1 · personal workspace
INSERT INTO public.projects (id, workspace_id, created_by, owner_id, name, project_data, upload_status, cloud_version, duration_ms)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'eeeeeeee-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    'Personal Project',
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
            "frameRate": 60,
            "zoom": {"enabled": true, "maxZoom": 2, "transitionDurationMs": 750, "easing": "ease-in-out"},
            "spotlight": {"enabled": true, "dimOpacity": 0.5, "enlargeScale": 1.25, "transitionDurationMs": 750, "minHoldDurationMs": 200, "defaultHoldDurationMs": 1000, "easing": "ease-in-out"},
            "mouse": {"mouseClickEnabled": true, "mouseDragEnabled": true, "effectType": "ring", "color": "#8b5cf6", "size": 1.0, "soundEnabled": false, "soundVolume": 0.5},
            "keyboard": {"showHotkeys": true, "hotkeysSize": 1.0, "hotkeysPlacement": "top", "hotkeysMargin": 4},
            "screen": {
                "mode": "border",
                "toolbar": {"enabled": true, "theme": "light", "urlMode": "short"},
                "padding": 0.02,
                "borderRadiusPx": 12,
                "borderWidthPx": 1,
                "borderColor": "#667eea",
                "deviceFrameId": "macbook-air-dark",
                "hasShadow": true,
                "hasGlow": false,
                "hasFeather": false,
                "mute": false
            },
            "background": {
                "type": "preset",
                "color": "#6078c4ff",
                "gradientColors": ["#1a1a2eff", "#16213eff"],
                "gradientDirection": 135,
                "colorMode": "gradient",
                "backgroundBlurPx": 0,
                "imageUrl": "https://cdn.recordio.io/backgrounds/bg10.avif"
            },
            "captions": {"enabled": true, "captionSize": 1.0, "width": 75, "textColor": "#ffffff", "backgroundColor": "#000000cc", "wordHighlight": true},
            "audio": {
                "muteMicrophone": false,
                "muteScreenAudio": false,
                "screenVolume": 1,
                "microphoneVolume": 1,
                "music": {"enabled": false, "source": "preset", "volume": 0.3, "fadeOutDurationMs": 3000}
            },
            "cameraMove": {"enabled": true, "transitionDurationMs": 500, "easing": "ease-in-out"},
            "overlay": {
                "enabled": true,
                "defaultDurationMs": 3000,
                "blurDefaults": {"blurRadiusPx": 20},
                "textDefaults": {"color": "#454545", "backgroundColor": "#ffdb57", "fontSizePx": 0},
                "arrowDefaults": {"color": "#7B61FF", "strokeWidthPx": 4},
                "borderDefaults": {"color": "#7B61FF", "borderWidthPx": 4}
            },
            "autoCutApplied": false
        },
        "timeline": {
            "id": "t1",
            "durationMs": 5000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 5000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCameraMove": true, "showOverlay": true, "collapsed": false}
        }
    }'::jsonb,
    'ready', 1, 5000
) ON CONFLICT (id) DO NOTHING;

-- user1 · Teams Workspace
INSERT INTO public.projects (id, workspace_id, created_by, owner_id, name, project_data, upload_status, cloud_version, duration_ms)
VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'eeeeeeee-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    'Teams Workspace Project',
    '{
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/screen.webm",
            "durationMs": 8000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": true
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 60,
            "zoom": {"enabled": true, "maxZoom": 2, "transitionDurationMs": 750, "easing": "ease-in-out"},
            "spotlight": {"enabled": true, "dimOpacity": 0.5, "enlargeScale": 1.25, "transitionDurationMs": 750, "minHoldDurationMs": 200, "defaultHoldDurationMs": 1000, "easing": "ease-in-out"},
            "mouse": {"mouseClickEnabled": true, "mouseDragEnabled": true, "effectType": "ring", "color": "#8b5cf6", "size": 1.0, "soundEnabled": false, "soundVolume": 0.5},
            "keyboard": {"showHotkeys": true, "hotkeysSize": 1.0, "hotkeysPlacement": "top", "hotkeysMargin": 4},
            "screen": {
                "mode": "border",
                "toolbar": {"enabled": true, "theme": "dark", "urlMode": "short"},
                "padding": 0.02,
                "borderRadiusPx": 16,
                "borderWidthPx": 1,
                "borderColor": "#302b63",
                "deviceFrameId": "macbook-air-dark",
                "hasShadow": true,
                "hasGlow": false,
                "hasFeather": false,
                "mute": false
            },
            "background": {
                "type": "color",
                "color": "#0f0c29ff",
                "gradientColors": ["#0f0c29ff", "#302b63ff"],
                "gradientDirection": 135,
                "colorMode": "gradient",
                "backgroundBlurPx": 0
            },
            "captions": {"enabled": true, "captionSize": 1.0, "width": 75, "textColor": "#ffffff", "backgroundColor": "#000000cc", "wordHighlight": true},
            "audio": {
                "muteMicrophone": false,
                "muteScreenAudio": false,
                "screenVolume": 1,
                "microphoneVolume": 1,
                "music": {"enabled": false, "source": "preset", "volume": 0.3, "fadeOutDurationMs": 3000}
            },
            "cameraMove": {"enabled": true, "transitionDurationMs": 500, "easing": "ease-in-out"},
            "overlay": {
                "enabled": true,
                "defaultDurationMs": 3000,
                "blurDefaults": {"blurRadiusPx": 20},
                "textDefaults": {"color": "#454545", "backgroundColor": "#ffdb57", "fontSizePx": 0},
                "arrowDefaults": {"color": "#7B61FF", "strokeWidthPx": 4},
                "borderDefaults": {"color": "#7B61FF", "borderWidthPx": 4}
            },
            "autoCutApplied": false
        },
        "timeline": {
            "id": "t2",
            "durationMs": 8000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 8000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCameraMove": true, "showOverlay": true, "collapsed": false}
        }
    }'::jsonb,
    'ready', 1, 8000
) ON CONFLICT (id) DO NOTHING;

-- user1 · Pro Team
INSERT INTO public.projects (id, workspace_id, created_by, owner_id, name, project_data, upload_status, cloud_version, duration_ms)
VALUES (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'eeeeeeee-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    'Pro Team Project',
    '{
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "11111111-1111-1111-1111-111111111111/cccccccc-cccc-cccc-cccc-cccccccccccc/screen.webm",
            "durationMs": 6000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": true
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 60,
            "zoom": {"enabled": true, "maxZoom": 2, "transitionDurationMs": 750, "easing": "ease-in-out"},
            "spotlight": {"enabled": true, "dimOpacity": 0.5, "enlargeScale": 1.25, "transitionDurationMs": 750, "minHoldDurationMs": 200, "defaultHoldDurationMs": 1000, "easing": "ease-in-out"},
            "mouse": {"mouseClickEnabled": false, "mouseDragEnabled": false, "effectType": "ring", "color": "#8b5cf6", "size": 1.0, "soundEnabled": false, "soundVolume": 0.5},
            "keyboard": {"showHotkeys": true, "hotkeysSize": 1.0, "hotkeysPlacement": "top", "hotkeysMargin": 4},
            "screen": {
                "mode": "border",
                "toolbar": {"enabled": true, "theme": "light", "urlMode": "short"},
                "padding": 0.02,
                "borderRadiusPx": 10,
                "borderWidthPx": 0,
                "borderColor": "#667eea",
                "deviceFrameId": "macbook-air-dark",
                "hasShadow": true,
                "hasGlow": false,
                "hasFeather": false,
                "mute": false
            },
            "background": {
                "type": "color",
                "color": "#1a1a2eff",
                "gradientColors": ["#1a1a2eff", "#1a1a2eff"],
                "gradientDirection": 135,
                "colorMode": "solid",
                "backgroundBlurPx": 0
            },
            "captions": {"enabled": true, "captionSize": 1.0, "width": 75, "textColor": "#ffffff", "backgroundColor": "#000000cc", "wordHighlight": true},
            "audio": {
                "muteMicrophone": false,
                "muteScreenAudio": false,
                "screenVolume": 1,
                "microphoneVolume": 1,
                "music": {"enabled": false, "source": "preset", "volume": 0.3, "fadeOutDurationMs": 3000}
            },
            "cameraMove": {"enabled": true, "transitionDurationMs": 500, "easing": "ease-in-out"},
            "overlay": {
                "enabled": true,
                "defaultDurationMs": 3000,
                "blurDefaults": {"blurRadiusPx": 20},
                "textDefaults": {"color": "#454545", "backgroundColor": "#ffdb57", "fontSizePx": 0},
                "arrowDefaults": {"color": "#7B61FF", "strokeWidthPx": 4},
                "borderDefaults": {"color": "#7B61FF", "borderWidthPx": 4}
            },
            "autoCutApplied": false
        },
        "timeline": {
            "id": "t3",
            "durationMs": 6000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 6000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCameraMove": true, "showOverlay": true, "collapsed": false}
        }
    }'::jsonb,
    'ready', 1, 6000
) ON CONFLICT (id) DO NOTHING;

-- user2 · personal workspace
INSERT INTO public.projects (id, workspace_id, created_by, owner_id, name, project_data, upload_status, cloud_version, duration_ms, expires_at)
VALUES (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'eeeeeeee-0000-0000-0000-000000000005',
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    'User Two Project',
    '{
        "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
        "schemaVersion": 5,
        "screenSource": {
            "storagePath": "22222222-2222-2222-2222-222222222222/dddddddd-dddd-dddd-dddd-dddddddddddd/screen.webm",
            "durationMs": 3000,
            "size": {"width": 1920, "height": 1080},
            "hasAudio": false
        },
        "userEvents": {"mouseClicks":[],"mousePositions":[],"keyboardEvents":[],"drags":[],"scrolls":[],"typingEvents":[],"urlChanges":[],"hoveredCards":[]},
        "settings": {
            "outputSize": {"width": 1920, "height": 1080},
            "frameRate": 60,
            "zoom": {"enabled": true, "maxZoom": 2, "transitionDurationMs": 750, "easing": "ease-in-out"},
            "spotlight": {"enabled": true, "dimOpacity": 0.5, "enlargeScale": 1.25, "transitionDurationMs": 750, "minHoldDurationMs": 200, "defaultHoldDurationMs": 1000, "easing": "ease-in-out"},
            "mouse": {"mouseClickEnabled": false, "mouseDragEnabled": false, "effectType": "ring", "color": "#8b5cf6", "size": 1.0, "soundEnabled": false, "soundVolume": 0.5},
            "keyboard": {"showHotkeys": true, "hotkeysSize": 1.0, "hotkeysPlacement": "top", "hotkeysMargin": 4},
            "screen": {
                "mode": "border",
                "toolbar": {"enabled": true, "theme": "light", "urlMode": "short"},
                "padding": 0.02,
                "borderRadiusPx": 8,
                "borderWidthPx": 0,
                "borderColor": "#667eea",
                "deviceFrameId": "macbook-air-dark",
                "hasShadow": false,
                "hasGlow": false,
                "hasFeather": false,
                "mute": false
            },
            "background": {
                "type": "color",
                "color": "#2d2d2dff",
                "gradientColors": ["#2d2d2dff", "#2d2d2dff"],
                "gradientDirection": 135,
                "colorMode": "solid",
                "backgroundBlurPx": 0
            },
            "captions": {"enabled": true, "captionSize": 1.0, "width": 75, "textColor": "#ffffff", "backgroundColor": "#000000cc", "wordHighlight": true},
            "audio": {
                "muteMicrophone": false,
                "muteScreenAudio": false,
                "screenVolume": 1,
                "microphoneVolume": 1,
                "music": {"enabled": false, "source": "preset", "volume": 0.3, "fadeOutDurationMs": 3000}
            },
            "cameraMove": {"enabled": true, "transitionDurationMs": 500, "easing": "ease-in-out"},
            "overlay": {
                "enabled": true,
                "defaultDurationMs": 3000,
                "blurDefaults": {"blurRadiusPx": 20},
                "textDefaults": {"color": "#454545", "backgroundColor": "#ffdb57", "fontSizePx": 0},
                "arrowDefaults": {"color": "#7B61FF", "strokeWidthPx": 4},
                "borderDefaults": {"color": "#7B61FF", "borderWidthPx": 4}
            },
            "autoCutApplied": false
        },
        "timeline": {
            "id": "t4",
            "durationMs": 3000,
            "outputWindows": [{"id": "ow1", "startMs": 0, "endMs": 3000, "speed": 1}],
            "zoomSegments": [],
            "spotlightSegments": [],
            "captionSegments": [],
            "cameraMoveSegments": [],
            "overlaySegments": [],
            "focusAreas": [],
            "displaySettings": {"showZoom": true, "showSpotlight": true, "showCameraMove": true, "showOverlay": true, "collapsed": false}
        }
    }'::jsonb,
    'ready', 1, 3000,
    NOW() + INTERVAL '7 days'
) ON CONFLICT (id) DO NOTHING;

