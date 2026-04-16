-- Trips (manual entry or Google Takeout Timeline import)
CREATE TABLE IF NOT EXISTS trip_ref (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  external_source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  origin_name TEXT,
  origin_place_id TEXT,
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  destination_name TEXT,
  destination_place_id TEXT,
  destination_lat DOUBLE PRECISION,
  destination_lng DOUBLE PRECISION,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  mode TEXT,
  distance_meters INTEGER,
  notes TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_ref_time ON trip_ref (start_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_ref_destination ON trip_ref (destination_name);
CREATE INDEX IF NOT EXISTS idx_trip_ref_origin ON trip_ref (origin_name);
