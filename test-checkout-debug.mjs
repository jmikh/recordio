import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rzbyqcdtjuclioingiaf.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseAnonKey) {
    console.error('Please set SUPABASE_ANON_KEY environment variable');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// You'll need to authenticate first
console.log('Testing checkout session creation...');
console.log('Note: You need to be logged in for this to work\n');

const { data: { session } } = await supabase.auth.getSession();

if (!session) {
    console.error('Not authenticated. Please log in first.');
    process.exit(1);
}

console.log('Authenticated as:', session.user.email);
console.log('User ID:', session.user.id);
console.log('\nCalling create-checkout-session...');

try {
    const response = await supabase.functions.invoke('create-checkout-session', {
        body: {
            userId: session.user.id,
            userEmail: session.user.email,
            successUrl: 'https://recordio.site/subscription-success',
            cancelUrl: 'https://recordio.site/subscription-success',
        },
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: supabaseAnonKey
        }
    });

    console.log('\nResponse:', JSON.stringify(response, null, 2));

    if (response.error) {
        console.error('\n❌ Error:', response.error);

        // Try to get more details
        if (response.error.context) {
            console.error('Context:', response.error.context);
        }
    } else {
        console.log('\n✅ Success! Checkout URL:', response.data?.url);
    }
} catch (err) {
    console.error('\n❌ Caught error:', err);
}
