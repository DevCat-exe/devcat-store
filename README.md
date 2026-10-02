# Devcat App Market

Devcat is a light, friendly app directory built with Astro. The public pages read live app records from Turso, an SQLite-compatible database; the private `/admin` page lets you add or edit listings without hand-editing a JSON catalog. App images can stay on the existing F-Droid repository.

## What runs where

- **This project** — Astro public website, admin form, API endpoints, and release-sync script.
- **Vercel** — hosts this same Astro project; no second website/repository is needed.
- **Turso** — hosts one small SQLite-compatible catalog database; there is no database server for you to keep running.
- **GitHub Actions** — builds on pushes and can sync release metadata on a schedule.

## Local development

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set a private ADMIN_PASSWORD (16+ characters)
npm run db:init
npm run dev
```

The development command loads `.env` automatically. Open `.env` locally to copy your `ADMIN_PASSWORD` for `/admin`; change it there whenever you want a new password. The ignored local `.env` contains credentials and should never be committed. When `TURSO_DATABASE_URL` is set to `file:./local.db`, the app uses a local SQLite file. The database init command creates the catalog/settings tables without inserting demo listings. Add your first real app through `/admin`; existing database records are never overwritten by initialization. Visit the URL printed by Astro and use `/apps` to browse the catalog.

To create a random session secret in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Create and connect a Turso database

1. Create a Turso account and a database using Turso’s dashboard or CLI. One small app catalog fits comfortably within the free-tier limits shown in the Turso plan for your account.
2. Copy the database URL and create an authentication token.
3. Initialize the database once from this project:

   ```powershell
   $env:TURSO_DATABASE_URL = "libsql://your-database-name-your-org.turso.io"
   $env:TURSO_AUTH_TOKEN = "your-database-auth-token"
   npm run db:init
   ```

4. In Vercel, import this project folder as the project root and add these environment variables for Production (and Preview if desired):

   - `TURSO_DATABASE_URL` — your Turso database URL
   - `TURSO_AUTH_TOKEN` — a token for the catalog database
   - `ADMIN_PASSWORD` — a unique password, at least 16 characters
   - `ADMIN_SESSION_SECRET` — a random secret, at least 32 characters

5. Deploy. Vercel uses the Astro adapter already configured here. The deployed site—including `/admin`—runs from this same project, and saved app changes appear on public pages without a redeploy.

The Vercel project is the only web deployment. Turso is the separate managed database; its generous free-plan quotas should be more than enough for this metadata-only catalog. Keep database tokens and admin secrets in environment variables, never in source control. Use Turso’s dashboard to back up or rotate database access tokens.

This repository is connected to `https://github.com/DevCat-exe/devcat-store`. Import that GitHub repository into Vercel with the project root set to this app folder. Vercel should use the existing Astro/Vercel adapter; no custom build command is needed (`npm run build` is the default). Add the four Production variables above before the first deployment. Vercel will deploy future pushes to the connected production branch automatically.

## Managing apps

Open `/admin` on your local site or deployed site and sign in with `ADMIN_PASSWORD`. Set up the shared F-Droid repository address and SHA-256 signing fingerprint once in the settings panel. The public `/fdroid` guide uses these settings to show a locally generated QR code, an F-Droid one-click add link, and manual setup details. Mark individual apps as available on the shared repository in their app form; there is no per-app F-Droid URL.

The app manager includes catalog settings for category choices and enabled platform chips. Select categories and platforms from the app editor instead of typing them manually. Categories can be added or removed centrally; removing a choice does not erase assignments on existing apps.

The app form supports:

- App name, short and full descriptions, URL slug, supported platforms, and license
- Icon and screenshot URLs (including images on the existing F-Droid repo)
- Searchable category tags; catalog category filters are generated from the apps you publish
- Synced Android APK and Windows installer links, with optional Android and Windows fallback URLs in the app editor
- Category tags and platform selections from the catalog settings
- Android minimum version, selectable common permissions (with an optional field for other identifiers), and privacy policy
- Featured home-page listing and optional GitHub release source. The first featured app alphabetically is the homepage highlight; edit this from the app checkbox and keep only one featured if you want a single predictable pick.

Screenshot fields accept one URL or path per line. App pages and privacy pages use the slug, for example `/apps/quick-insure` and `/privacy/quick-insure`. To publish a policy, enter its text in the app editor. The site-wide appearance switch remembers a visitor's dark/light preference. Interface motion is subtle and respects the system reduced-motion preference. Public visitors can only read catalog entries; create, edit, and delete operations require the admin session.

## Release metadata automation

For apps with a public GitHub repository, enter the `owner/repository` value in the “GitHub release source” field. Run a release sync locally by setting:

```powershell
$env:TURSO_DATABASE_URL = "libsql://your-database-name-your-org.turso.io"
$env:TURSO_AUTH_TOKEN = "your-database-auth-token"
# Optional: only set a token if you hit GitHub API rate limits.
npm run sync:releases
```

No personal GitHub token is needed for the scheduled workflow: it already uses GitHub Actions’ built-in token with read-only repository contents access. For occasional local syncs of public repos, no token is normally needed either. If you do need higher API limits, create a fine-grained token restricted to the specific release-source repositories and grant **Contents: Read-only** (Metadata is granted automatically). Do not use a classic token or any write permissions for release syncing.

For apps in the shared F-Droid repository, set the F-Droid package ID in the editor. Run `npm run sync:fdroid` to import repository categories, Android minimum version, permissions, screenshots, APK checksums, and available changelogs. Run `npm run sync:releases` to import GitHub tags, notes, dates, installable assets, file sizes, download counts, and SHA-256 digests. Release asset names also add detected platforms (for example, APK assets add Android and Windows installers add Windows). The sync uses GitHub’s digest or a published checksum file when available; otherwise it streams the primary download (up to 512 MiB) to calculate a checksum. It does not fabricate a checksum when a download is too large or unavailable. The app detail page sends its Download button to a platform-grouped list of available files for the latest version, with older versions expandable below; F-Droid APK checksums remain separate from GitHub file checksums.

To enable the scheduled GitHub Actions workflow, add repository Actions secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Then run **Actions → Sync app releases → Run workflow** once to test. The workflow syncs F-Droid metadata first and GitHub releases second, and repeats every six hours. GitHub’s read-only workflow token is used for public release metadata; an optional `GITHUB_TOKEN` override is not needed in Actions.

## Validation

```sh
npm run build
```

The build does not need a live database. At runtime, database connection errors are logged and public catalog pages return an explicit unavailable state rather than silently showing stale or empty data.
