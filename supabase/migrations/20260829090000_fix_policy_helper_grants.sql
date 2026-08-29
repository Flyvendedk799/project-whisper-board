-- Restore EXECUTE on the functions the RLS policies call.
--
-- Migration 20260514001020 revoked EXECUTE on has_role(), is_admin() and
-- is_project_member() from `authenticated`. Those three functions are called
-- from inside almost every policy in the schema, and a policy expression is
-- evaluated with the privileges of the querying role — so with the grant gone,
-- any signed-in user reading almost any table gets:
--
--   ERROR: permission denied for function is_admin
--
-- which is to say the application does not work for anybody who is not using
-- the service role. Reproduced by supabase/tests/schema_assertions.sql.
--
-- These are SECURITY DEFINER with a pinned search_path and answer a single
-- boolean question about a user id, so granting EXECUTE to authenticated is
-- both necessary and the pattern Supabase documents. `anon` and `public` stay
-- revoked: nobody signed out has a reason to ask.

grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_project_member(uuid, uuid) to authenticated;
