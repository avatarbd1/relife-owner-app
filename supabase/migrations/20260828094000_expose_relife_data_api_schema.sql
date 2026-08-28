-- The server-side data layer intentionally targets the canonical relife
-- schema through PostgREST. Keep the existing Supabase schemas and expose
-- relife; table grants and RLS remain the authorization boundary.

alter role authenticator
  set pgrst.db_schemas = 'public, storage, graphql_public, relife';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
