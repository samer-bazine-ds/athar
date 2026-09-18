# Supabase policies

All table RLS policies and Storage policies are defined in `../migrations/0001_shared_schema.sql` from the authoritative `SHARED_SPEC.md`.

Apply the migration once to a new Supabase project. Do not disable RLS. No user-facing table has an `anon` policy.

Useful verification checks after applying the migration:

```sql
select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public';
select * from pg_policies where schemaname in ('public','storage') order by schemaname, tablename, policyname;
```
