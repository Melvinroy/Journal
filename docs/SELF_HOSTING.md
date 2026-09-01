# Self-hosting Brontide

This guide creates a completely independent installation:

- your own GitHub repository
- your own GitHub Pages address
- your own Supabase authentication and database
- your own users and trading data

No database password or privileged Supabase key is required by the journal.

## Before you start

You need free GitHub and Supabase accounts. Keep the Supabase database password in your password manager; you do not paste it into GitHub or the journal.

## 1. Fork the repository

Open [Melvinroy/Brontide](https://github.com/Melvinroy/Brontide) and select **Fork**.

Keep the repository public if you want to use GitHub Pages on the GitHub Free plan. Your source code is public, but your trading records remain protected in Supabase.

Your future website address will normally be:

```text
https://YOUR_USERNAME.github.io/Brontide/
```

If you rename the repository, replace `Brontide` with the new repository name.

## 2. Create Supabase

1. Open [Supabase New Project](https://supabase.com/dashboard/new).
2. Choose an organization.
3. Give the project a recognizable name such as `brontide`.
4. Generate and securely save the database password.
5. Choose the region closest to you.
6. Create the project and wait for it to become ready.

## 3. Install the database once

### Beginner path

1. Open `public/supabase-setup.sql` in your fork and select **Copy raw file**.
2. Open your Supabase project → **SQL Editor** → **New query**.
3. Paste the installer.
4. Select **Run**.

The script is safe to run again. It creates the trades table, index, automatic timestamps, authenticated-user permissions and four ownership-based RLS policies. Anonymous table access remains disabled.

### Migration path

The canonical schema is stored in `supabase/migrations/`.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase db push --dry-run
supabase db push
```

After choosing the migration workflow, make future database changes only through new migration files. Avoid editing the production schema manually because that bypasses migration history.

## 4. Copy the two public connection values

In Supabase, open **Settings → API Keys** or **Connect** and copy:

- Project URL
- Publishable key beginning with `sb_publishable_`

Never use a secret key or `service_role` key in GitHub Pages.

## 5. Add GitHub repository variables

In your fork, open **Settings → Secrets and variables → Actions → Variables**.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_...` key |

These are public browser configuration values. Do not place a database password, personal access token or secret key here.

## 6. Configure authentication URLs

In Supabase, open **Authentication → URL Configuration**.

Set **Site URL** to:

```text
https://YOUR_USERNAME.github.io/Brontide/
```

Add this address under **Redirect URLs**:

```text
https://YOUR_USERNAME.github.io/Brontide/**
```

## 7. Enable GitHub Pages

1. In your fork, open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Open **Actions → Deploy Brontide to GitHub Pages**.
4. Select **Run workflow** if a deployment is not already running.
5. Wait for both build and deploy to show green checks.

The Owner Setup screen disappears when the repository variables are included in the deployment.

## 8. Verify the installation

1. Create an account with an email address you can access.
2. Open the confirmation email and sign in.
3. Add one test trade.
4. Sign out and sign in from another browser or device.
5. Confirm the same trade appears.

## Updating your fork

Pull upstream changes, review new files in `supabase/migrations/`, and deploy them through the Supabase GitHub integration or `supabase db push`. Migration history prevents previously applied migrations from running again.

## Troubleshooting

### The setup screen still appears

Confirm both GitHub variables are spelled exactly, then rerun the Pages workflow. Variables are added during the build, so changing them does not update an already-deployed artifact.

### Account created but no email arrived

Check spam and Supabase **Authentication → Logs**. The app intentionally uses a neutral signup response so it does not reveal whether an email address already exists.

### The confirmation link opens the wrong page

Recheck the Site URL and Redirect URL, including the repository name and trailing slash.

### “Cloud setup required” after sign-in

Run `public/supabase-setup.sql`, confirm that `public.trades` exists, and confirm Data API access is enabled for the `public` schema.

### GitHub Pages shows an old version

Open the latest Actions run, confirm both jobs succeeded, then hard-refresh the browser.
