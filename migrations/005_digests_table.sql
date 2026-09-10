CREATE TABLE IF NOT EXISTS digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID REFERENCES profiles(id),
  summary TEXT NOT NULL,
  highlights JSONB NOT NULL,
  stats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS digests_created_at_idx ON digests (created_at DESC);

NOTIFY pgrst, 'reload schema';
