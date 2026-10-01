-- Courses didn't carry a department before now, so there was no way to scope
-- anything (like the Calendar view) to a single department. Nullable so
-- existing courses aren't broken — they just show as "Uncategorized" until
-- an admin tags them via the Courses page.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS department TEXT;

NOTIFY pgrst, 'reload schema';
