CREATE TABLE IF NOT EXISTS morning_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_date DATE NOT NULL UNIQUE,
  content TEXT NOT NULL,
  content_html TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
