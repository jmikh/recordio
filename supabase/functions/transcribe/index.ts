import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, GetObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import OpenAI from 'https://esm.sh/openai@4';
import { withAuth, jsonResponse, errorResponse, hasProAccess } from '../_shared/auth.ts';
import { getProjectMicPath } from '../_shared/projectMedia.ts';

const BUCKET = 'project-media';

const s3 = new S3Client({
    forcePathStyle: true,
    region: Deno.env.get('S3_REGION') ?? '',
    endpoint: Deno.env.get('S3_ENDPOINT_DEV') ?? Deno.env.get('S3_ENDPOINT') ?? '',
    credentials: {
        accessKeyId: Deno.env.get('S3_ACCESS_KEY') ?? '',
        secretAccessKey: Deno.env.get('S3_SECRET_KEY') ?? '',
    },
});
const DEFAULT_MINUTES_LIMIT = 60;

/**
 * Transcribe Edge Function
 *
 * Client sends { projectId }. This function:
 * 1. Checks pro subscription via subscription_get()
 * 2. Loads project_data and extracts mic storage path
 * 3. Downloads mic audio from storage
 * 4. Calls OpenAI Whisper API
 * 5. Updates transcription_usage on success
 */
serve(withAuth(async (req, { user, supabase }) => {
    const { projectId } = await req.json();

    if (!projectId || typeof projectId !== 'string') {
        return errorResponse('Missing projectId', 400);
    }

    // --- Check pro access (Stripe subscription OR active trial) ---
    if (!await hasProAccess(user.id)) {
        return errorResponse('Pro subscription required', 403);
    }

    // Load subscription for billing cycle (may be null for trial-only users)
    const { data: subscription } = await supabase.rpc('subscription_get');

    // --- Get project data and extract mic path ---
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('project_data')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (projectError || !project) {
        return errorResponse('Project not found', 404);
    }

    const micPath = getProjectMicPath(project.project_data);
    if (!micPath) {
        return errorResponse('Project has no microphone audio', 400);
    }

    // --- Admin client for storage + usage table ---
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // --- Download audio from S3 ---
    let fileData: Blob;
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: micPath }));
        const bytes = await res.Body!.transformToByteArray();
        fileData = new Blob([bytes]);
    } catch (err) {
        console.error('[transcribe] S3 download failed:', err);
        return errorResponse('Failed to download audio from storage', 500);
    }

    // --- Compute billing cycle + check usage ---
    // Trial-only users (no Stripe sub) get a 30-day rolling cycle
    const cycleResetDate = subscription
        ? computeCycleResetDate(
            new Date(subscription.current_period_end),
            subscription.billing_interval,
            subscription.status,
        )
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Estimate duration from file size (precision isn't critical for rate limiting)
    const ext = micPath.split('.').pop() ?? 'wav';
    const bytesPerSecond = ext === 'wav' ? 176400 : 6000; // 44.1kHz 16-bit stereo WAV vs compressed
    const durationSeconds = fileData.size / bytesPerSecond;
    const requestedMinutes = Math.ceil(durationSeconds / 6) / 10; // round up to 0.1 min

    const { data: usage } = await adminSupabase
        .from('transcription_usage')
        .select('minutes_used, minutes_limit, reset_date')
        .eq('user_id', user.id)
        .maybeSingle();

    let currentMinutesUsed = 0;
    const minutesLimit = usage?.minutes_limit ?? DEFAULT_MINUTES_LIMIT;

    if (usage) {
        const resetDate = new Date(usage.reset_date);
        currentMinutesUsed = resetDate < cycleResetDate ? 0 : (usage.minutes_used ?? 0);
    }

    if (currentMinutesUsed + requestedMinutes > minutesLimit) {
        return jsonResponse({
            error: 'rate_limit_exceeded',
            message: 'Monthly transcription limit reached',
            cycleMinutesUsed: currentMinutesUsed,
            cycleMinutesLimit: minutesLimit,
            resetsAt: cycleResetDate.toISOString(),
        }, 429);
    }

    // --- Call OpenAI Whisper API ---
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') ?? '' });

    const mimeMap: Record<string, string> = {
        webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg',
        ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
    };
    const mimeType = mimeMap[ext] ?? 'audio/wav';
    const file = new File([fileData], `audio.${ext}`, { type: mimeType });

    let whisperResponse;
    try {
        whisperResponse = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file,
            timestamp_granularities: ['segment', 'word'],
            response_format: 'verbose_json',
            prompt: 'This is a clear, professional recording with proper punctuation and capitalization. The speaker communicates articulately without hesitation.',
        });
    } catch (err) {
        console.error('[transcribe] OpenAI transcription failed:', err);
        return errorResponse('Transcription service failed', 502);
    }

    // --- Build word-level segments ---
    const rawWords = (whisperResponse.words ?? []).map((w: any) => ({
        word: w.word,
        sourceStartTimeMs: Math.round(w.start * 1000),
        sourceEndTimeMs: Math.round(w.end * 1000),
    }));

    if (rawWords.length === 0) {
        return jsonResponse({
            segments: [],
            minutesUsed: requestedMinutes,
            cycleMinutesUsed: currentMinutesUsed,
            cycleMinutesLimit: minutesLimit,
            cycleResetsAt: cycleResetDate.toISOString(),
        });
    }

    const segmentTexts: string[] = (whisperResponse.segments ?? []).map((s: any) => s.text?.trim() ?? '');
    const punctuatedWords = addPunctuationFromSegments(rawWords, segmentTexts);

    const whisperSegments: Array<{ start: number; end: number }> =
        (whisperResponse.segments ?? []).map((s: any) => ({
            start: Math.round((s.start ?? 0) * 1000),
            end: Math.round((s.end ?? 0) * 1000),
        }));

    const segments = [];
    for (const ws of whisperSegments) {
        const segWords = punctuatedWords.filter(
            (w: any) => w.sourceStartTimeMs >= ws.start - 50 && w.sourceEndTimeMs <= ws.end + 50
        );
        if (segWords.length === 0) continue;
        segments.push({
            sourceStartTimeMs: segWords[0].sourceStartTimeMs,
            sourceEndTimeMs: segWords[segWords.length - 1].sourceEndTimeMs,
            words: segWords,
        });
    }

    // --- Update usage on success ---
    const newMinutesUsed = currentMinutesUsed + requestedMinutes;
    await adminSupabase
        .from('transcription_usage')
        .upsert({
            user_id: user.id,
            minutes_used: newMinutesUsed,
            minutes_limit: minutesLimit,
            reset_date: cycleResetDate.toISOString(),
        }, { onConflict: 'user_id' });

    return jsonResponse({
        segments,
        minutesUsed: requestedMinutes,
        cycleMinutesUsed: newMinutesUsed,
        cycleMinutesLimit: minutesLimit,
        cycleResetsAt: cycleResetDate.toISOString(),
    });
}));

// --- Helpers ---

interface WordEntry {
    word: string;
    sourceStartTimeMs: number;
    sourceEndTimeMs: number;
}

function addPunctuationFromSegments(words: WordEntry[], segmentTexts: string[]): WordEntry[] {
    const tokens: string[] = [];
    for (const text of segmentTexts) {
        for (const token of text.split(/\s+/)) {
            if (token) tokens.push(token);
        }
    }

    const result = words.map(w => ({ ...w }));
    let tokenIdx = 0;

    for (const w of result) {
        if (tokenIdx >= tokens.length) break;
        const token = tokens[tokenIdx];
        const wordLower = w.word.toLowerCase();
        const tokenLower = token.toLowerCase();
        if (tokenLower.startsWith(wordLower) || tokenLower.replace(/[^\w']/g, '') === wordLower.replace(/[^\w']/g, '')) {
            w.word = token;
            tokenIdx++;
        } else {
            tokenIdx++;
        }
    }

    return result;
}

function computeCycleResetDate(
    currentPeriodEnd: Date,
    billingInterval: string | null,
    subscriptionStatus: string,
): Date {
    if (subscriptionStatus === 'trialing') return currentPeriodEnd;
    if (billingInterval !== 'yearly') return currentPeriodEnd;

    const now = new Date();
    const anniversaryDay = currentPeriodEnd.getUTCDate();

    let resetDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        anniversaryDay,
    ));

    if (resetDate <= now) {
        resetDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            anniversaryDay,
        ));
    }

    if (resetDate > currentPeriodEnd) {
        resetDate = currentPeriodEnd;
    }

    return resetDate;
}
