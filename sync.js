import pg from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FB_BASE = 'https://graph.facebook.com/v21.0';

// ─── Instagram ────────────────────────────────────────────────────────────────

async function getIgAccountId() {
  if (process.env.INSTAGRAM_ACCOUNT_ID) return process.env.INSTAGRAM_ACCOUNT_ID;
  throw new Error('INSTAGRAM_ACCOUNT_ID not set in .env');
}

async function getIgInsights(mediaId, mediaProductType) {
  // 'views' works universally across FEED, REELS, and VIDEO product types.
  // REELS expose likes/comments via insights; FEED posts expose them on the media object.
  const base = 'views,reach,saved,shares,total_interactions';
  const metrics = mediaProductType === 'REELS' ? `${base},likes,comments` : base;

  try {
    const { data } = await axios.get(`${FB_BASE}/${mediaId}/insights`, {
      params: { metric: metrics, access_token: process.env.INSTAGRAM_ACCESS_TOKEN },
    });
    return Object.fromEntries(
      data.data.map(m => [m.name, m.values?.[0]?.value ?? m.value ?? 0])
    );
  } catch (e) {
    console.warn(`  insights unavailable for ${mediaId}: ${e.response?.data?.error?.message ?? e.message}`);
    return {};
  }
}

async function syncInstagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igAccountId = await getIgAccountId();

  const { data } = await axios.get(`${FB_BASE}/${igAccountId}/media`, {
    params: {
      fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: 25,
      access_token: token,
    },
  });

  const posts = data.data ?? [];

  for (const post of posts) {
    const ins = await getIgInsights(post.id, post.media_product_type);
    const isReel = post.media_product_type === 'REELS';

    const views    = ins.views   ?? null;
    const reach    = ins.reach   ?? null;
    const shares   = ins.shares  ?? null;
    const saves    = ins.saved   ?? null;
    const likes    = isReel ? (ins.likes    ?? null) : (post.like_count     ?? null);
    const comments = isReel ? (ins.comments ?? null) : (post.comments_count ?? null);

    const engagementRate =
      reach && reach > 0
        ? ((likes ?? 0) + (comments ?? 0) + (shares ?? 0) + (saves ?? 0)) / reach
        : null;

    await upsert({
      platform: 'instagram',
      post_id: post.id,
      title: post.caption?.slice(0, 500) ?? null,
      thumbnail_url: post.thumbnail_url ?? post.media_url ?? null,
      published_at: post.timestamp,
      views, likes, comments, shares, saves, reach,
      engagement_rate: engagementRate,
    });
  }

  console.log(`  ✓ Instagram: synced ${posts.length} posts`);
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function syncYouTube() {
  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId) throw new Error('YOUTUBE_CHANNEL_ID not set in .env');

  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', id: channelId, key: apiKey },
  });
  const uploadsPlaylistId =
    channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error(`No uploads playlist found for channel ${channelId}`);

  const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: { part: 'snippet', playlistId: uploadsPlaylistId, maxResults: 25, key: apiKey },
  });
  const videoIds = playlistRes.data.items.map(i => i.snippet.resourceId.videoId);
  if (!videoIds.length) { console.log('  ✓ YouTube: no videos found'); return; }

  const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: { part: 'snippet,statistics', id: videoIds.join(','), key: apiKey },
  });

  const videos = videosRes.data.items ?? [];

  for (const video of videos) {
    const stats    = video.statistics ?? {};
    const views    = parseInt(stats.viewCount)    || null;
    const likes    = parseInt(stats.likeCount)    || null;
    const comments = parseInt(stats.commentCount) || null;

    const engagementRate =
      views && views > 0 ? ((likes ?? 0) + (comments ?? 0)) / views : null;

    await upsert({
      platform: 'youtube',
      post_id: video.id,
      title: video.snippet.title,
      thumbnail_url: video.snippet.thumbnails?.high?.url ?? null,
      published_at: video.snippet.publishedAt,
      views, likes, comments,
      shares: null, saves: null, reach: null,
      engagement_rate: engagementRate,
    });
  }

  console.log(`  ✓ YouTube: synced ${videos.length} videos`);
}

// ─── DB ───────────────────────────────────────────────────────────────────────

async function upsert(record) {
  await pool.query(
    `INSERT INTO content_analytics (
       platform, post_id, title, thumbnail_url, published_at,
       views, likes, comments, shares, saves, reach, engagement_rate, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (post_id) DO UPDATE SET
       title           = EXCLUDED.title,
       thumbnail_url   = EXCLUDED.thumbnail_url,
       views           = EXCLUDED.views,
       likes           = EXCLUDED.likes,
       comments        = EXCLUDED.comments,
       shares          = EXCLUDED.shares,
       saves           = EXCLUDED.saves,
       reach           = EXCLUDED.reach,
       engagement_rate = EXCLUDED.engagement_rate,
       updated_at      = NOW()`,
    [
      record.platform, record.post_id, record.title, record.thumbnail_url,
      record.published_at, record.views, record.likes, record.comments,
      record.shares, record.saves, record.reach, record.engagement_rate,
    ]
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runSync() {
  console.log(`[${new Date().toISOString()}] Starting sync...`);
  await Promise.allSettled([
    syncInstagram().catch(e => console.error('  ✗ Instagram:', e.message)),
    syncYouTube().catch(e => console.error('  ✗ YouTube:', e.message)),
  ]);
  console.log(`[${new Date().toISOString()}] Sync complete`);
}

// Run directly: node sync.js
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runSync().finally(() => pool.end());
}
