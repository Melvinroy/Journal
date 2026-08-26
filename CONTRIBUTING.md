# Contributing

Thank you for helping improve Trading Journal.

## Development

1. Fork the repository and create a focused branch.
2. Copy `.env.example` to `.env.local`.
3. Use your own development Supabase project.
4. Run `npm ci` and `npm run dev`.
5. Run `npm run build` before opening a pull request.

## Database changes

- Create a new timestamped file under `supabase/migrations/`.
- Never edit an already-released migration.
- Test against a fresh database and an upgrade from the previous release.
- Preserve user ownership and RLS.
- Do not include sample users, real trades or credentials.

## Pull requests

Keep each pull request focused. Explain the user-visible change, database impact, security impact and verification performed. Include screenshots for visual changes.

By contributing, you agree that your work is licensed under the repository's MIT License.

