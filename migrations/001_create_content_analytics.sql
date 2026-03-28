CREATE TABLE IF NOT EXISTS content_analytics (
  id          bigserial PRIMARY KEY,
  platform    text NOT NULL,
  post_id     text NOT NULL UNIQUE,
  title       text,
  thumbnail_url text,
  published_at  timestamptz,
  views       bigint,
  likes       bigint,
  comments    bigint,
  shares      bigint,
  saves       bigint,
  reach       bigint,
  engagement_rate double precision,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_analytics_platform     ON content_analytics (platform);
CREATE INDEX IF NOT EXISTS idx_content_analytics_published_at ON content_analytics (published_at DESC);
