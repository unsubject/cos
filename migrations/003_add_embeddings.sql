CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_journal_entry_embedding
  ON journal_entry USING hnsw (embedding vector_cosine_ops);
