import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

serve(withAuth(async (req, { user, supabase }) => {
    // 1. Parse request body — expects { videoUids: string[], detailed?: boolean }
    const { videoUids, detailed } = await req.json();
    if (!Array.isArray(videoUids) || videoUids.length === 0) {
        return errorResponse('Missing videoUids array', 400);
    }

    // 2. Verify these videos belong to the user (security gate)
    const { data: userVideos } = await supabase
        .from('projects')
        .select('cf_video_uid')
        .not('cf_video_uid', 'is', null)
        .is('deleted_at', null)
        .in('cf_video_uid', videoUids);

    const authorizedUids = new Set((userVideos || []).map((v) => v.cf_video_uid));
    const filteredUids = videoUids.filter((uid) => authorizedUids.has(uid));

    if (filteredUids.length === 0) {
        return jsonResponse({ analytics: {} });
    }

    // 3. Fetch analytics from CF GraphQL API
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    // Aggregate query (always)
    const aggregateQuery = {
        query: `query GetVideoAnalytics($accountTag: string!, $start: Date!, $end: Date!, $uids: [string!]) {
            viewer {
                accounts(filter: { accountTag: $accountTag }) {
                    streamMinutesViewedAdaptiveGroups(
                        filter: {
                            date_geq: $start
                            date_lt: $end
                            uid_in: $uids
                        }
                        orderBy: [sum_minutesViewed_DESC]
                        limit: 100
                    ) {
                        sum {
                            minutesViewed
                        }
                        count
                        dimensions {
                            uid
                        }
                    }
                }
            }
        }`,
        variables: {
            accountTag: CF_ACCOUNT_ID,
            start: startDate,
            end: endDate,
            uids: filteredUids,
        },
    };

    // Daily breakdown query (only when detailed=true)
    const dailyQuery = detailed ? {
        query: `query GetDailyAnalytics($accountTag: string!, $start: Date!, $end: Date!, $uids: [string!]) {
            viewer {
                accounts(filter: { accountTag: $accountTag }) {
                    streamMinutesViewedAdaptiveGroups(
                        filter: {
                            date_geq: $start
                            date_lt: $end
                            uid_in: $uids
                        }
                        orderBy: [dimensions_date_ASC]
                        limit: 1000
                    ) {
                        sum {
                            minutesViewed
                        }
                        count
                        dimensions {
                            uid
                            date
                        }
                    }
                }
            }
        }`,
        variables: {
            accountTag: CF_ACCOUNT_ID,
            start: startDate,
            end: endDate,
            uids: filteredUids,
        },
    } : null;

    // Run queries in parallel
    const [aggregateRes, dailyRes, ...durationResults] = await Promise.all([
        fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(aggregateQuery),
        }).then((r) => r.json()),
        dailyQuery
            ? fetch('https://api.cloudflare.com/client/v4/graphql', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(dailyQuery),
            }).then((r) => r.json())
            : Promise.resolve(null),
        // Fetch video durations
        ...filteredUids.map((uid) =>
            fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`, {
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
            }).then((r) => r.ok ? r.json() : { result: { duration: 0 } }).catch(() => ({ result: { duration: 0 } }))
        ),
    ]);

    // Parse aggregate data
    const analyticsMap = {};
    const groups = aggregateRes?.data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups || [];
    for (const group of groups) {
        const uid = group.dimensions?.uid;
        if (uid) {
            analyticsMap[uid] = {
                views: group.count || 0,
                minutesViewed: group.sum?.minutesViewed || 0,
            };
        }
    }

    // Parse daily breakdown
    const dailyMap = {};
    if (dailyRes) {
        const dailyGroups = dailyRes?.data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups || [];
        for (const group of dailyGroups) {
            const uid = group.dimensions?.uid;
            const date = group.dimensions?.date;
            if (uid && date) {
                if (!dailyMap[uid]) dailyMap[uid] = [];
                dailyMap[uid].push({
                    date,
                    views: group.count || 0,
                    minutesViewed: group.sum?.minutesViewed || 0,
                });
            }
        }
    }

    // Parse durations
    const durationMap = {};
    filteredUids.forEach((uid, i) => {
        durationMap[uid] = durationResults[i]?.result?.duration || 0;
    });

    // Combine results
    const analytics = {};
    for (const uid of filteredUids) {
        const stats = analyticsMap[uid] || { views: 0, minutesViewed: 0 };
        analytics[uid] = {
            uid,
            views: stats.views,
            minutesViewed: stats.minutesViewed,
            durationSeconds: durationMap[uid] || 0,
            ...(detailed && dailyMap[uid] ? { daily: dailyMap[uid] } : {}),
        };
    }

    return jsonResponse({ analytics });
}));
