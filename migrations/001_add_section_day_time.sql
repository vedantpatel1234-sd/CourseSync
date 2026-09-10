-- Step 1: add day_of_week / time_slot to sections
-- Run this in the Supabase SQL Editor.
--
-- Vocabulary matches instructor_availability.day / instructor_availability.time_slot
-- exactly (same strings), so Step 2's conflict detection can compare them directly
-- without any translation layer.

ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS day_of_week TEXT,
  ADD COLUMN IF NOT EXISTS time_slot TEXT;

ALTER TABLE sections
  ADD CONSTRAINT sections_day_of_week_check
  CHECK (day_of_week IS NULL OR day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'));

ALTER TABLE sections
  ADD CONSTRAINT sections_time_slot_check
  CHECK (time_slot IS NULL OR time_slot IN (
    '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
    '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'
  ));

-- Both columns are nullable on purpose: existing sections created before this
-- migration will show as "Not scheduled" in the UI until an admin sets a day/time
-- on them (editable in place on the Sections page, no need to recreate them).
