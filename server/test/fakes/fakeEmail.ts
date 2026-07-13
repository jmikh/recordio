import type { EmailMessage, EmailPort } from '../../src/ports/email.js';

export interface FakeEmail extends EmailPort {
    sent: EmailMessage[];
    /** Set to make subsequent sends fail */
    nextResult: { success: boolean; error?: string };
}

export function createFakeEmail(): FakeEmail {
    const fake: FakeEmail = {
        sent: [],
        nextResult: { success: true },

        async send(message) {
            fake.sent.push(message);
            return fake.nextResult;
        },
    };
    return fake;
}
