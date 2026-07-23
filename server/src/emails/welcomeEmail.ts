/**
 * Welcome email — ports the template from the `send-welcome-email` edge
 * fn verbatim, minus the unsubscribe link (feature removed 2026-07-23).
 * PHOTO_URL stays hardcoded as in the edge fn.
 */
import { emailLayout } from './layout.js';

const PHOTO_URL = 'https://app.recordio.io/assets/images/john.webp';

export const WELCOME_EMAIL_SUBJECT = "Welcome to Recordio — I'd love your feedback";

export function buildWelcomeEmailHtml(): string {
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

    return emailLayout(body);
}
