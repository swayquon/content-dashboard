import express from 'express';
import pg from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,                       // keep connection count low in serverless
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

// Serve static files from public/
app.use(express.static(join(__dirname, 'public')));

// Helper: handle missing table gracefully
function isTableMissingError(err) {
  return err.code === '42P01';
}

// Fetch Instagram followers
async function fetchInstagramFollowers() {
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_ACCOUNT_ID}`,
      {
        params: {
          fields: 'followers_count',
          access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
        },
        timeout: 5000,
      }
    );
    return data.followers_count ?? null;
  } catch (e) {
    console.warn('Instagram followers fetch failed:', e.message);
    return null;
  }
}

// Fetch YouTube subscribers
async function fetchYouTubeFollowers() {
  try {
    const { data } = await axios.get(
      'https://www.googleapis.com/youtube/v3/channels',
      {
        params: {
          part: 'statistics',
          id: process.env.YOUTUBE_CHANNEL_ID,
          key: process.env.YOUTUBE_API_KEY,
        },
        timeout: 5000,
      }
    );
    const count = data.items?.[0]?.statistics?.subscriberCount;
    return count != null ? parseInt(count) : null;
  } catch (e) {
    console.warn('YouTube followers fetch failed:', e.message);
    return null;
  }
}

const PLATFORM_WHITELIST = ['all', 'instagram', 'youtube'];

// GET /api/kpis?days=30&platform=all
app.get('/api/kpis', async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const platform = PLATFORM_WHITELIST.includes(req.query.platform) ? req.query.platform : 'all';

  try {
    // Current period aggregates
    const currentRes = await pool.query(
      `SELECT
         COALESCE(SUM(views), 0)           AS views,
         COALESCE(SUM(reach), 0)           AS reach,
         COALESCE(AVG(engagement_rate), 0) AS engagement_rate,
         COALESCE(SUM(shares), 0)          AS shares,
         COALESCE(SUM(saves), 0)           AS saves
       FROM content_analytics
       WHERE published_at >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2 = 'all' OR platform = $2)`,
      [days, platform]
    );

    // Previous period aggregates
    const prevRes = await pool.query(
      `SELECT
         COALESCE(SUM(views), 0)           AS views,
         COALESCE(SUM(reach), 0)           AS reach,
         COALESCE(AVG(engagement_rate), 0) AS engagement_rate,
         COALESCE(SUM(shares), 0)          AS shares,
         COALESCE(SUM(saves), 0)           AS saves
       FROM content_analytics
       WHERE published_at >= NOW() - ($1 * INTERVAL '1 day')
         AND published_at <  NOW() - ($2 * INTERVAL '1 day')
         AND ($3 = 'all' OR platform = $3)`,
      [days * 2, days, platform]
    );

    // Sparklines: daily breakdown for current period
    const sparkRes = await pool.query(
      `SELECT
         DATE(published_at)                AS date,
         COALESCE(SUM(views), 0)           AS views,
         COALESCE(SUM(reach), 0)           AS reach,
         COALESCE(SUM(shares), 0)          AS shares,
         COALESCE(SUM(saves), 0)           AS saves,
         COALESCE(AVG(engagement_rate), 0) AS engagement_rate
       FROM content_analytics
       WHERE published_at >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2 = 'all' OR platform = $2)
       GROUP BY DATE(published_at)
       ORDER BY date ASC`,
      [days, platform]
    );

    const cur = currentRes.rows[0];
    const prev = prevRes.rows[0];

    function pctChange(current, previous) {
      const c = parseFloat(current);
      const p = parseFloat(previous);
      if (p === 0) return null;
      return ((c - p) / p) * 100;
    }

    // Fetch followers live
    const [igFollowers, ytFollowers] = await Promise.all([
      fetchInstagramFollowers(),
      fetchYouTubeFollowers(),
    ]);

    const totalFollowers =
      igFollowers != null && ytFollowers != null
        ? igFollowers + ytFollowers
        : igFollowers ?? ytFollowers ?? null;

    const current = {
      views: parseInt(cur.views),
      reach: parseInt(cur.reach),
      engagement_rate: parseFloat(cur.engagement_rate) * 100,
      shares: parseInt(cur.shares),
      saves: parseInt(cur.saves),
      followers: totalFollowers,
      followers_instagram: igFollowers,
      followers_youtube: ytFollowers,
    };

    const changes = {
      views: pctChange(cur.views, prev.views),
      reach: pctChange(cur.reach, prev.reach),
      engagement_rate: pctChange(cur.engagement_rate, prev.engagement_rate),
      shares: pctChange(cur.shares, prev.shares),
      saves: pctChange(cur.saves, prev.saves),
      followers: null,
    };

    const sparklines = sparkRes.rows.map(row => ({
      date: row.date,
      views: parseInt(row.views),
      reach: parseInt(row.reach),
      shares: parseInt(row.shares),
      saves: parseInt(row.saves),
      engagement_rate: parseFloat(row.engagement_rate) * 100,
    }));

    res.json({ current, changes, sparklines });
  } catch (err) {
    if (isTableMissingError(err)) {
      return res.json({
        current: { views: 0, reach: 0, engagement_rate: 0, shares: 0, saves: 0, followers: null, followers_instagram: null, followers_youtube: null },
        changes: { views: null, reach: null, engagement_rate: null, shares: null, saves: null, followers: null },
        sparklines: [],
      });
    }
    console.error('/api/kpis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chart/views-reach?days=90&platform=all
app.get('/api/chart/views-reach', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const platform = PLATFORM_WHITELIST.includes(req.query.platform) ? req.query.platform : 'all';

  try {
    const result = await pool.query(
      `SELECT
         DATE(published_at)      AS date,
         COALESCE(SUM(views), 0) AS views,
         COALESCE(SUM(reach), 0) AS reach
       FROM content_analytics
       WHERE published_at >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2 = 'all' OR platform = $2)
       GROUP BY DATE(published_at)
       ORDER BY date ASC`,
      [days, platform]
    );

    res.json(result.rows.map(r => ({
      date: r.date,
      views: parseInt(r.views),
      reach: parseInt(r.reach),
    })));
  } catch (err) {
    if (isTableMissingError(err)) return res.json([]);
    console.error('/api/chart/views-reach error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chart/engagement?days=90&platform=all
app.get('/api/chart/engagement', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const platform = PLATFORM_WHITELIST.includes(req.query.platform) ? req.query.platform : 'all';

  try {
    const result = await pool.query(
      `SELECT
         DATE(published_at)         AS date,
         COALESCE(SUM(likes), 0)    AS likes,
         COALESCE(SUM(comments), 0) AS comments,
         COALESCE(SUM(shares), 0)   AS shares,
         COALESCE(SUM(saves), 0)    AS saves
       FROM content_analytics
       WHERE published_at >= NOW() - ($1 * INTERVAL '1 day')
         AND ($2 = 'all' OR platform = $2)
       GROUP BY DATE(published_at)
       ORDER BY date ASC`,
      [days, platform]
    );

    res.json(result.rows.map(r => ({
      date: r.date,
      likes: parseInt(r.likes),
      comments: parseInt(r.comments),
      shares: parseInt(r.shares),
      saves: parseInt(r.saves),
    })));
  } catch (err) {
    if (isTableMissingError(err)) return res.json([]);
    console.error('/api/chart/engagement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/posts?sort=views&limit=12&platform=all
const SORT_WHITELIST = ['views', 'likes', 'shares', 'engagement_rate'];

app.get('/api/posts', async (req, res) => {
  const sort = SORT_WHITELIST.includes(req.query.sort) ? req.query.sort : 'views';
  const limit = Math.min(parseInt(req.query.limit) || 12, 100);
  const platform = PLATFORM_WHITELIST.includes(req.query.platform) ? req.query.platform : 'all';

  try {
    const result = await pool.query(
      `SELECT
         id, platform, post_id, title, thumbnail_url, published_at,
         views, likes, comments, shares, saves, reach, engagement_rate,
         created_at, updated_at
       FROM content_analytics
       WHERE ($1 = 'all' OR platform = $1)
       ORDER BY ${sort} DESC NULLS LAST
       LIMIT $2`,
      [platform, limit]
    );

    res.json(result.rows);
  } catch (err) {
    if (isTableMissingError(err)) return res.json([]);
    console.error('/api/posts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export for Vercel serverless
export default app;

// Local dev only
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}
