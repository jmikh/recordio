/**
 * Thin wrapper around the Resend HTTP API.
 * All email-sending edge functions import this helper.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
        console.error('[Resend] RESEND_API_KEY not configured');
        return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    const {
        to,
        subject,
        html,
        from = 'Recordio Team <john@recordio.cc>',
        replyTo = 'john@recordio.cc',
    } = options;

    try {
        const response = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from, to: [to], subject, html, reply_to: replyTo }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('[Resend] API error:', response.status, errorBody);
            return { success: false, error: `Resend API ${response.status}: ${errorBody}` };
        }

        const data = await response.json();
        console.log('[Resend] Email sent successfully:', data.id);
        return { success: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Resend] Send error:', message);
        return { success: false, error: message };
    }
}
