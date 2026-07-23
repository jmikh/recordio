/**
 * Real email adapter (Resend) — landed with Wave E (welcome + invite
 * emails), the last port to lose its `unimplementedPort` stub. Raw
 * fetch, no SDK: the surface is one POST.
 *
 * Result-shaped per the port contract — NEVER throws: routes decide
 * what a failed send means (both current callers 500 so pg_net's
 * fire-and-forget caller leaves a log trail, nothing more).
 */
import type { EmailMessage, EmailPort } from '../ports/email.js';

export interface EmailAdapterConfig {
    apiKey: string;
    /** Test override (ephemeral local server) */
    baseUrl?: string;
}

const DEFAULT_FROM = 'Recordio Team <john@recordio.io>';
const DEFAULT_REPLY_TO = 'john@recordio.io';

export function createEmailAdapter(config: EmailAdapterConfig): EmailPort {
    const url = `${config.baseUrl ?? 'https://api.resend.com'}/emails`;

    return {
        async send(message: EmailMessage) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${config.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: message.from ?? DEFAULT_FROM,
                        to: [message.to],
                        subject: message.subject,
                        html: message.html,
                        reply_to: message.replyTo ?? DEFAULT_REPLY_TO,
                    }),
                });
                if (!res.ok) {
                    const snippet = (await res.text().catch(() => '')).slice(0, 300);
                    return { success: false, error: `Resend API ${res.status}: ${snippet}` };
                }
                return { success: true };
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : 'Unknown error',
                };
            }
        },
    };
}
