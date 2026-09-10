ALTER TABLE assignments ADD COLUMN IF NOT EXISTS ai_rationale TEXT;

NOTIFY pgrst, 'reload schema';
