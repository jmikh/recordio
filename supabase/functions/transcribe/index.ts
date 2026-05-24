import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, GetObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import OpenAI from 'https://esm.sh/openai@4';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { getProjectMicPath } from '../_shared/projectMedia.ts';

const adminSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

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

/**
 * Transcribe Edge Function
 *
 * Client sends { projectId }. This function:
 * 1. Loads project_data + workspace_id from the project
 * 2. Checks active subscription via subscription_get(workspace_id)
 * 3. Downloads mic audio from storage
 * 4. Calls OpenAI Whisper API
 * 5. Returns word-level caption segments
 */
serve(withAuth(async (req, { supabase }) => {
    const { projectId } = await req.json();

    if (!projectId || typeof projectId !== 'string') {
        return errorResponse('Missing projectId', 400);
    }

    // --- Load project (includes workspace_id for subscription check) ---
    const { data: project, error: projectError } = await adminSupabase
        .from('projects')
        .select('project_data, workspace_id')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (projectError) throw new Error('project lookup failed', { cause: projectError });
    if (!project) return errorResponse('Project not found', 404);

    // --- Check active subscription for the project's workspace ---
    const { data: subscription } = await supabase.rpc('subscription_get', {
        p_workspace_id: project.workspace_id,
    });

    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
        return errorResponse('Active subscription required', 403);
    }

    const micPath = getProjectMicPath(project.project_data);
    if (!micPath) {
        return errorResponse('Project has no microphone audio', 400);
    }

    // --- Download audio from S3 ---
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: micPath }));
    const bytes = await res.Body!.transformToByteArray();
    const fileData = new Blob([bytes]);

    // --- Call OpenAI Whisper API ---
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') ?? '' });

    const ext = micPath.split('.').pop() ?? 'wav';
    const mimeMap: Record<string, string> = {
        webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg',
        ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
    };
    const mimeType = mimeMap[ext] ?? 'audio/wav';
    const file = new File([fileData], `audio.${ext}`, { type: mimeType });

    const whisperResponse = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        timestamp_granularities: ['segment', 'word'],
        response_format: 'verbose_json',
        prompt: 'This is a clear, professional recording with proper punctuation and capitalization. The speaker communicates articulately without hesitation.',
    });

    // --- Build word-level segments ---
    const rawWords = (whisperResponse.words ?? []).map((w: any) => ({
        word: w.word,
        sourceStartTimeMs: Math.round(w.start * 1000),
        sourceEndTimeMs: Math.round(w.end * 1000),
    }));

    if (rawWords.length === 0) {
        return jsonResponse({ segments: [] });
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

    return jsonResponse({ segments });
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
