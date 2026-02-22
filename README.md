# GiroTrash

Report illegal dump sites in Girona. Citizens submit geolocated photo reports, an admin reviews and forwards them to the municipal cleaning service via email.

## Architecture

```
[Mobile PWA]  -->  [Cloudflare Pages]  -->  [Supabase Edge Functions]  -->  [Resend API]
                         |                        |                             |
                         |                   [Supabase DB]              [Girona Municipality]
                         |                   [Supabase Storage]          residusinetejagirona@ajgirona.cat
                    (static files)
```

- **Frontend**: Vite + React + TypeScript, deployed on Cloudflare Pages
- **Backend**: Supabase (Postgres + Storage + Edge Functions)
- **Email**: Resend (called from Edge Function, never from frontend)
- **Map**: Leaflet.js + OpenStreetMap tiles
- **Geocoding**: Nominatim (proxied through Edge Function with cache)

## Setup

### Prerequisites

- Node.js >= 20
- Supabase project (create at [supabase.com](https://supabase.com))
- Resend account (create at [resend.com](https://resend.com))
- Cloudflare Pages project (create at [dash.cloudflare.com](https://dash.cloudflare.com))

### 1. Supabase Setup

#### Database

Run the migration in your Supabase SQL Editor:

```bash
# Or use Supabase CLI:
supabase db push
```

The migration file is at `supabase/migrations/00001_initial_schema.sql`. It creates:

- `reports` table with geofence fields, status enum, Resend tracking
- `report_media` table linked to reports
- `geocode_cache` table for Nominatim response caching
- `admin_users` allowlist table
- All RLS policies (anon has zero direct access; all writes via Edge Functions)
- Private `report-media` storage bucket
- Helper functions: `distance_to_girona()`, `is_admin()`

#### Add Admin User

In Supabase SQL Editor:

```sql
-- 1. Create the user in Auth (via Dashboard > Authentication > Users > Add User)
-- 2. Add their email to the allowlist:
INSERT INTO admin_users (email) VALUES ('your-admin@example.com');
```

#### Deploy Edge Functions

```bash
supabase functions deploy create-report
supabase functions deploy reverse-geocode
supabase functions deploy send-report-email
```

#### Set Edge Function Secrets

In Supabase Dashboard > Edge Functions > Secrets:

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Your Resend API key (starts with `re_`) |
| `RESEND_FROM_EMAIL` | Verified sender address in Resend (e.g. `girotrash@yourdomain.com`) |
| `NOMINATIM_USER_AGENT` | Identifies the app to Nominatim (e.g. `GiroTrash/1.0 (you@email.com)`) |
| `ADMIN_EMAIL_ALLOWLIST` | Comma-separated admin emails (fallback to `admin_users` table) |

### 2. Cloudflare Pages Setup

#### Build Settings

| Setting | Value |
|---|---|
| **Build command** | `npm ci && npm run build` |
| **Build output directory** | `dist` |
| **Node.js version** | `20` (set in Environment variables: `NODE_VERSION=20`) |

#### Environment Variables

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://abc.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

**No secrets go into Cloudflare.** Only `VITE_*` public env vars.

#### SPA Routing

The `public/_redirects` file handles client-side routing:

```
/* /index.html 200
```

This is automatically included in the build output (`dist/_redirects`).

### 3. Resend Setup

1. Create account at [resend.com](https://resend.com)
2. Add and verify your sending domain
3. Create an API key
4. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Supabase Edge Function secrets

## Development

```bash
# Install dependencies
npm install

# Create .env file from example
cp .env.example .env
# Edit .env with your Supabase URL and anon key

# Start dev server
npm run dev
```

## Project Structure

```
Girotrash/
  index.html                          # Entry point
  vite.config.ts                      # Vite + PWA config
  src/
    main.tsx                          # React entry
    App.tsx                           # Router
    index.css                         # Global styles
    i18n/
      index.ts                       # i18next setup
      ca.json                        # Catalan (default)
      es.json                        # Spanish
      en.json                        # English
    lib/
      supabase.ts                    # Supabase client
      api.ts                         # API calls (Edge Functions + admin)
      constants.ts                   # Girona coords, haversine, config
      compress.ts                    # Client-side image compression
      local-reports.ts               # localStorage "my reports"
    types/
      index.ts                       # TypeScript types
    components/
      LanguageBar.tsx                # CAT/ES/EN switcher
      MapView.tsx                    # Leaflet map with geolocation
      PhotoCapture.tsx               # Photo upload + compression
    pages/
      ReportFlow.tsx                 # Main user flow (map > photos > details > confirm)
      AdminLogin.tsx                 # Admin login
      AdminDashboard.tsx             # Report list with status tabs
      AdminReportDetail.tsx          # Report detail + approve/reject/edit/delete
  public/
    _redirects                       # Cloudflare Pages SPA routing
    favicon.svg                      # App icon
  supabase/
    migrations/
      00001_initial_schema.sql       # Full DB schema, RLS, indexes, functions
    functions/
      create-report/index.ts         # Validates, rate-limits, inserts, returns upload URLs
      reverse-geocode/index.ts       # Nominatim proxy with cache + throttle
      send-report-email/index.ts     # Admin-only: sends report via Resend with attachments
```

## Security Model

**Zero direct database access from the frontend.**

All anonymous submissions go through the `create-report` Edge Function which:
1. Validates lat/lon and enforces 5km geofence
2. Checks honeypot field (anti-bot)
3. Rate-limits: 10 submissions/hour/IP (by SHA-256 hashed IP)
4. Inserts report via service role
5. Returns signed upload URLs for photos (private bucket)

RLS policies:
- Anonymous (`anon` role): **no access** to any table
- Admin (authenticated + in `admin_users` table): full CRUD
- Service role (Edge Functions): bypasses RLS

## Email System

- Emails are always composed in **Catalan**
- Photos are attached as true email attachments (base64-encoded JPEGs)
- Sent via Resend API from the `send-report-email` Edge Function
- Admin triggers send; on failure, status reverts and `last_error` is stored
- `resend_message_id` is stored for tracking

## i18n

- Default: Catalan (`ca`)
- Available: Spanish (`es`), English (`en`)
- All UI text (including admin panel) is translated
- Language persists in `localStorage`
- Outgoing emails are always in Catalan regardless of UI language

## TODO

- [ ] PWA icons (192x192, 512x512 PNGs) — currently using placeholder
- [ ] Turnstile CAPTCHA integration (hooks ready)
- [ ] Admin: edit location on map in detail view
- [ ] Webhook for Resend delivery status updates
- [ ] Nominatim → paid geocoding service for production traffic
- [ ] E2E tests
