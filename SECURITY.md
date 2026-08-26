# Security

## Data ownership

Each row in `public.trades` contains a `user_id` linked to `auth.users.id`. Row-Level Security policies require `auth.uid() = user_id` for reads, inserts, updates and deletes.

The update policy contains both `USING` and `WITH CHECK`, preventing ownership reassignment.

## Browser credentials

The frontend may contain only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These values identify the public Supabase API and are designed for browser use. Security comes from authentication, grants and RLS—not from hiding the publishable key.

Never expose the database password, a Supabase secret key, a `service_role` key, a Supabase personal access token or a GitHub personal access token.

## Reporting a vulnerability

Do not publish exploitable authentication, authorization or data-access problems in a public issue. Open a private GitHub security advisory and include reproduction steps without real trading data.

## Maintainer checklist

Schema and authentication changes must be reviewed for:

- RLS enabled on every exposed table
- ownership predicates on every policy
- both `USING` and `WITH CHECK` for updates
- no `SECURITY DEFINER` functions in exposed schemas
- no privileged keys in frontend code, examples or logs
- explicit authenticated-role grants
- anonymous access revoked unless intentionally required

