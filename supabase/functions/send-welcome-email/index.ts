import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/emails/resend.ts';
import { emailLayout } from '../_shared/emails/layout.ts';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import { captureException } from '../_shared/sentry.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const PHOTO_URL = 'https://app.recordio.io/assets/images/john.webp';

/**
 * Generate a signed unsubscribe token (JWT) for a user.
 * Valid for 1 year — long enough that old emails still work.
 */
async function generateUnsubscribeToken(userId: string): Promise<string> {
    const secret = supabaseServiceKey;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );

    return await create(
        { alg: 'HS256', typ: 'JWT' },
        { sub: userId, purpose: 'unsubscribe', exp: getNumericDate(365 * 24 * 60 * 60) },
        key,
    );
}

function buildWelcomeEmailHtml(unsubscribeUrl: string): string {
    const body = `
        <!-- Greeting -->
        <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: 700; color: #111111;">
            Welcome to Recordio 🎉
        </h1>

        <!-- Body -->
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #444444;">
            Hey! I'm John — I built Recordio, and I wanted to personally welcome you.
        </p>
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #444444;">
            You've got a <strong>7-day free Pro trial</strong> to explore everything Recordio can do. I hope you love it.
        </p>
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #444444;">
            This is still early days, and I care a lot about getting it right. If something feels off, or if there's a feature you wish existed — I want to hear about it.
        </p>

        <!-- Trial extension offer -->
        <div style="background-color: #f8f5ff; border-left: 3px solid #856FDC; border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 0 0 24px 0;">
            <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #444444;">
                <strong>Want to extend your trial to a full month?</strong><br>
                Reply to this email with 3 things that could be improved — bugs, UX ideas, missing features, anything. I'll extend your Pro trial by 3 more weeks, no questions asked.
            </p>
        </div>

        <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.7; color: #444444;">
            I read every single reply. Seriously.
        </p>

        <!-- Sign-off with photo -->
        <div style="border-top: 1px solid #f0f0f0; padding-top: 20px; display: flex; align-items: center;">
            <img
                src="${PHOTO_URL}"
                alt="John"
                width="44"
                height="44"
                style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; margin-right: 12px;"
            />
            <div>
                <p style="margin: 0; font-size: 15px; font-weight: 600; color: #111111;">John Mikhail</p>
                <p style="margin: 0; font-size: 13px; color: #888888;">Founder, Recordio</p>
            </div>
        </div>
    `;

    return emailLayout({ body, unsubscribeUrl });
}

// ============================================================================
// Handler — triggered by Database Webhook on auth.users INSERT
// ============================================================================

serve(async (req) => {
    try {
        const payload = await req.json();

        // Database webhook sends { type, table, record, ... }
        const record = payload.record;
        if (!record) {
            console.error('[WelcomeEmail] No record in payload');
            return new Response(JSON.stringify({ error: 'No record' }), { status: 400 });
        }

        const userId: string = record.id;
        const email: string | undefined = record.email;

        if (!email) {
            console.log('[WelcomeEmail] No email for user:', userId, '— skipping');
            return new Response(JSON.stringify({ skipped: true, reason: 'no email' }), { status: 200 });
        }

        // Check if user has unsubscribed (future-proofing for re-signups)
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('email_subscribed')
            .eq('user_id', userId)
            .maybeSingle();

        if (profile && !profile.email_subscribed) {
            console.log('[WelcomeEmail] User unsubscribed, skipping:', userId);
            return new Response(JSON.stringify({ skipped: true, reason: 'unsubscribed' }), { status: 200 });
        }

        // Generate unsubscribe token and build URL
        const token = await generateUnsubscribeToken(userId);
        const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe?token=${token}`;

        // Build and send
        const html = buildWelcomeEmailHtml(unsubscribeUrl);
        const result = await sendEmail({
            to: email,
            subject: "Welcome to Recordio — I'd love your feedback",
            html,
        });

        if (!result.success) {
            console.error('[WelcomeEmail] Failed to send:', result.error);
            return new Response(JSON.stringify({ error: result.error }), { status: 500 });
        }

        console.log('[WelcomeEmail] Sent welcome email to:', email);
        return new Response(JSON.stringify({ sent: true }), { status: 200 });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[WelcomeEmail] Error:', message);
        await captureException(err, { function: 'send-welcome-email' });
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
});
