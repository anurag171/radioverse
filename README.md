# RadioVerse

A beautiful, responsive live-radio aggregator. Browse and stream thousands of internet radio stations from India and around the world — filtered by **country**, **language** and **genre**.

Built with vanilla HTML / CSS / JavaScript. No build step, no dependencies — it works straight out of the box.

![Stack](https://img.shields.io/badge/stack-vanilla%20HTML%20CSS%20JS-00e5ff) ![No deps](https://img.shields.io/badge/dependencies-none-3cf59a) ![API](https://img.shields.io/badge/data-Radio%20Browser%20API-7c4dff)

## Features

- **Live streaming** — play real radio streams instantly in the browser
- **India-first catalog** — defaults to India, expandable to any country worldwide
- **Filters** — by country, language, genre, plus free-text search
- **Sorting** — most played, most voted, name, bitrate
- **Favorites** — save stations to your browser (localStorage)
- **Now-playing metadata** — shows the current track where the stream provides ICY metadata
- **Mini player bar** — persistent playback controls while you browse
- **Volume control** — persisted across sessions
- **Fully responsive** — mobile and laptop friendly, dark neon UI

## Data Source

Stations are pulled live from the [Radio Browser](https://www.radio-browser.info) community directory (no API key required). Thousands of working stations are catalogued with country, language, genre, bitrate and stream URL.

## Authentication (invite-only, via Supabase)

The site supports optional invite-only login powered by [Supabase Auth](https://supabase.com/auth) (free tier). Passwords are hashed and managed by Supabase — they are never stored in this codebase. This project ships with a `LICENSE`-free "all rights reserved" policy and a copyright notice in the footer.

### How it works

- Without credentials configured, the site runs in **public mode** (everyone can browse and stream).
- With credentials configured, the whole app is gated behind a **sign-in screen**. There is no public signup — accounts are created by an administrator only.

### Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In **Project Settings > API**, copy the **Project URL** and the **anon public key**.
3. Paste them into `js/config.js`:

   ```js
   window.RADIOVERSE_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",
   };
   ```

4. In **Authentication > Providers**, make sure **Email** is enabled.
5. **Allow public signups** so users can request access: **Authentication > Sign In / Up > "Allow new users to sign up" ON**.
6. **Require admin approval before anyone can sign in**: in **Authentication > Providers > Email**, turn **"Enable automatic confirmations" OFF**. This puts every new signup in a *pending* state — the user cannot log in until an administrator approves their account in the Dashboard (below).

### Registration & approval flow

- A visitor clicks **"New here? Request access"** on the sign-in screen and fills in their name, email and password.
- Their account is created but **unconfirmed** — they see a *"Account pending approval"* message and cannot sign in yet.
- An administrator approves them in the Dashboard: **Authentication > Users > select the user > "Confirm"** (this is the only place that activates the account).
- Only after approval can the user sign in with the email and password they chose.

### Managing users (adding/resetting people)

- **Add a user**: Supabase Dashboard > **Authentication > Users > "Add user"**, set their email and a temporary password, and give it to them privately. They can't change their password through this app yet, so use a shared, strong password per user or update it from the dashboard.
- **Reset a forgotten password**: Dashboard > **Authentication > Users > select the user > "Reset password"** (sends an email if email is confirmed) or set a new temporary password.
- **Block someone**: Dashboard > **Authentication > Users > select the user > "Block user"** (revokes access immediately).
- You never see a user's real password — only Supabase stores it (bcrypt-hashed).

### Security notes

- Only the **anon** (public) key is used in the browser; it is safe to embed.
- Never paste the **service_role** key into `js/config.js` — it grants full admin powers and must stay server-side.
- Treat every user's credentials as private; share them only with the intended person.

## Running Locally

Serve the folder with any static file server:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. In the repo, go to **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Your site will be live at `https://<username>.github.io/<repo-name>/`.

## Project Structure

```
index.html         Layout: header, hero, filters, grid, mini player
css/style.css      Dark neon responsive theme
js/app.js          API integration, filters, favorites, player, metadata
```

## Privacy

- All data is fetched client-side from the public Radio Browser directory.
- Favorites and volume are stored only in your browser's localStorage.
- Streams are served by their respective broadcasters.
