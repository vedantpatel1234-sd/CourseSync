-- Exports the structure of the `public` schema as one JSON document: RLS status,
-- columns, constraints, indexes, triggers, functions and policies. No row data.
--
-- Run in the Supabase SQL editor, then copy the single result cell and save it as
-- docs/schema-dump.json. Needed because the base tables were created in the dashboard
-- and are not in migrations/, so unique constraints and triggers are otherwise unknown.

select jsonb_pretty(jsonb_build_object(
  'rls', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'rls', rowsecurity) order by tablename)
    from pg_tables where schemaname = 'public'
  ),
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default
    ) order by table_name, ordinal_position)
    from information_schema.columns where table_schema = 'public'
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid)
    ) order by conrelid::regclass::text, conname)
    from pg_constraint where connamespace = 'public'::regnamespace
  ),
  'indexes', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'def', indexdef) order by tablename, indexname)
    from pg_indexes where schemaname = 'public'
  ),
  'triggers', (
    select jsonb_agg(jsonb_build_object(
      'table', event_object_table, 'name', trigger_name, 'event', event_manipulation,
      'timing', action_timing, 'action', action_statement
    ) order by event_object_table, trigger_name)
    from information_schema.triggers where trigger_schema = 'public'
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object('name', proname, 'def', pg_get_functiondef(oid)) order by proname)
    from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f'
  ),
  'policies', (
    select jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'permissive', permissive, 'cmd', cmd,
      'roles', roles, 'using', qual, 'check', with_check
    ) order by tablename, policyname)
    from pg_policies where schemaname = 'public'
  )
)) as schema_dump;
