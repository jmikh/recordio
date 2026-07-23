/**
 * Shared email HTML layout — ports `_shared/emails/layout.ts` (Wave E).
 * Inline styles for maximum email-client compatibility.
 *
 * The edge fn's optional `unsubscribeUrl` footer link is gone: the
 * unsubscribe feature was removed entirely (user decision 2026-07-23 —
 * migration dropped user_profiles.email_subscribed, edge fn deleted).
 */

export function emailLayout(body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recordio</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width: 520px; width: 100%;">

                    <!-- Logo -->
                    <tr>
                        <td align="center" style="padding-bottom: 32px;">
                            <a href="https://recordio.io" style="text-decoration: none;"><img src="https://app.recordio.io/assets/images/fulllogo-light.png" alt="Recordio" height="36" style="height: 36px; width: auto;" /></a>
                        </td>
                    </tr>

                    <!-- Card -->
                    <tr>
                        <td style="background-color: #ffffff; border-radius: 12px; padding: 40px 36px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                            ${body}
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td align="center" style="padding-top: 28px;">
                            <p style="margin: 0; font-size: 12px; color: #999999; line-height: 1.6;">
                                <a href="https://recordio.io" style="color: #999999; text-decoration: none;">Recordio</a> · Smart Screen Recorder
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}
