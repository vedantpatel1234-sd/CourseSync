-- Prevent duplicate live assignments for the same section
-- Run this in the Supabase SQL Editor.
--
-- The app already blocks this in the UI (Assignments.tsx "already assigned" check,
-- the Matching Engine's usedInstructors tracking, DraftDetail's publish conflict
-- review), but nothing at the database level stopped two concurrent writes — or a
-- direct Supabase call bypassing the UI — from creating two live assignments for
-- the same section. This adds that guarantee at the database level.
--
-- Partial index: only applies to LIVE assignments (draft_id IS NULL) that are not
-- rejected, since a section can legitimately have any number of superseded/
-- rejected/draft assignment rows alongside its one live one.

CREATE UNIQUE INDEX IF NOT EXISTS one_live_assignment_per_section
  ON assignments (section_id)
  WHERE draft_id IS NULL AND status <> 'rejected';
