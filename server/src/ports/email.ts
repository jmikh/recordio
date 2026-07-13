/**
 * Email port (Resend today). Templates are pure functions (ported from
 * _shared/emails/ in Step 2) — only the actual send goes through the port.
 * Result-shaped rather than throwing, mirroring the edge functions'
 * `{ success, error }` handling.
 */
export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    /** Defaults in the adapter: "Recordio Team <john@recordio.io>" */
    from?: string;
    replyTo?: string;
}

export interface EmailPort {
    send(message: EmailMessage): Promise<{ success: boolean; error?: string }>;
}
