import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import { captureException } from '../_shared/sentry.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Returns a minimal, branded HTML confirmation page.
 */
function confirmationPage(success: boolean, message: string): string {
    const icon = success ? '✓' : '✕';
    const iconColor = success ? '#22c55e' : '#ef4444';
    const heading = success ? 'Unsubscribed' : 'Something went wrong';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${heading} — Recordio</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f5f5f5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #333;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            padding: 48px 40px;
            max-width: 420px;
            width: 90%;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .icon {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: bold;
            color: white;
            margin-bottom: 20px;
            background: ${iconColor};
        }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #111; }
        p { font-size: 15px; line-height: 1.6; color: #666; }
        .brand { margin-top: 32px; font-size: 13px; color: #bbb; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">${icon}</div>
        <h1>${heading}</h1>
        <p>${message}</p>
        <p class="brand">Recordio</p>
    </div>
</body>
</html>`;
}

// ============================================================================
// Handler — GET /unsubscribe?token=...
// ============================================================================

serve(async (req) => {
    try {
        const url = new URL(req.url);
        const token = url.searchParams.get('token');

        if (!token) {
            return new Response(
                confirmationPage(false, 'Missing unsubscribe token. The link may be invalid.'),
                { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
        }

        // Verify JWT
        const secret = supabaseServiceKey;
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify'],
        );

        let payload;
        try {
            payload = await verify(token, key);
        } catch {
            return new Response(
                confirmationPage(false, 'This unsubscribe link has expired or is invalid.'),
                { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
        }

        if (payload.purpose !== 'unsubscribe' || !payload.sub) {
            return new Response(
                confirmationPage(false, 'Invalid unsubscribe token.'),
                { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
        }

        const userId = payload.sub as string;

        // Mark as unsubscribed (idempotent — clicking twice is fine)
        const { error } = await supabase
            .from('user_profiles')
            .update({ email_subscribed: false, updated_at: new Date().toISOString() })
            .eq('user_id', userId);

        if (error) throw new Error('user_profiles update failed', { cause: error });

        console.log('[Unsubscribe] User unsubscribed:', userId);

        return new Response(
            confirmationPage(true, 'You\'ve been unsubscribed from Recordio emails. You won\'t hear from us again.'),
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Unsubscribe] Error:', message);
        await captureException(err, 'unsubscribe');
        return new Response(
            confirmationPage(false, 'Something unexpected happened. Please try again.'),
            { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
    }
});
