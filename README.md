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
6. **Keep email confirmation ON**: **Authentication > Providers > Email > "Enable automatic confirmations" OFF**. Users must click the confirmation link (or enter the 6-digit code) from the signup email before they can attempt to sign in.
7. **Add the admin-approval gate**: open **SQL Editor** and run the script in `sql/approval_gate.sql`. This creates a `profiles` table (with `status`, `is_admin`, `is_premium`, `default_country` and `active_session`), automatically registers every new signup as `pending`, and marks all *existing* accounts as `approved` — plus the owner account (`anurag171@gmail.com`) as admin with read/update access to every profile. It also creates the `admin_delete_user` function (used by Delete) and `claim_session` (used by the one-active-connection lock).

### Registration & approval flow

- A visitor clicks **"New here? Request access"** on the sign-in screen and fills in their name, email and password.
- They receive a **confirmation email**. Confirming it proves the address is real — but it does **not** activate the account.
- The account stays locked in *"Account pending approval"* until an administrator flips its status to `approved` (below). Confirming the email alone is never enough to sign in.
- Only after admin approval can the user sign in with the email and password they chose.

### Approving a user

An account is activated only when an administrator sets its status to `approved` in the `profiles` table. The easiest way is the **Admin page** (below). Alternatively, from the dashboard:

- **Table Editor**: open the **profiles** table, find the user's row, change `status` from `pending` to `approved`, save. (The user's UUID is the row id; you can look up the UUID in **Authentication > Users**.)
- **SQL Editor**: run

  ```sql
  update public.profiles set status = 'approved' where email = 'user@example.com';
  ```

  (Run it without the `where email` clause to approve everyone.)

### Admin page

Sign in with `anurag171@gmail.com` and click **Admin** in the top bar. You can:

- **Approve / reject** a user (change their `status`).
- **Edit** a user's display name and **default country** (the country that user sees pre-selected when browsing stations).
- **Reset password** — sends the user a password-reset email.
- **Delete** a user — runs the `admin_delete_user` SQL function (created by `approval_gate.sql`).

The Admin button only appears for the owner account. Everything runs client-side through RLS policies plus the `admin_delete_user` `security definer` function — no Edge Function or `service_role` key is needed in the browser.

### Default country

Each user's `profiles.default_country` decides which country is pre-selected when the app loads (falling back to India). The admin can set it in the Admin page; users can also just pick another country from the dropdown at any time.

### One active connection per account

To stop passwords being shared, each non-premium account allows **one active sign-in at a time** ("last login wins"). Signing in on a new device records a session marker in `profiles.active_session`; the older device notices within ~30 seconds and is signed out with a *"Signed out"* screen. Premium members are exempt and may be signed in on multiple devices at once.

### Premium & support

- **Premium**: the admin can toggle a user's `is_premium` flag in the Admin page (Edit user > "Premium member"). Premium members see a gold star in the top bar and skip the one-connection limit.
- **Support button**: a **Support** button appears in the top bar for signed-in users. Point it at any donation/payment URL (Buy Me a Coffee, Ko-fi, UPI, etc.) by setting `supportUrl` in `js/config.js`. Leave it empty to hide the button.

### Managing users (adding/resetting people)

- **Add a user**: Supabase Dashboard > **Authentication > Users > "Add user"**, set their email and a temporary password, and give it to them privately. They can't change their password through this app yet, so use a shared, strong password per user or update it from the dashboard.
- **Reset a forgotten password**: Dashboard > **Authentication > Users > select the user > "Reset password"** (sends an email if email is confirmed) or set a new temporary password.
- **Block someone**: Dashboard > **Authentication > Users > select the user > "Block user"** (revokes access immediately).
- You never see a user's real password — only Supabase stores it (bcrypt-hashed).

### Security notes

- Only the **anon** (public) key is used in the browser; it is safe to embed.
- Never paste the **service_role** key into `js/config.js` — it grants full admin powers and must stay server-side. It is never used in this app: user deletion goes through the `admin_delete_user` `security definer` function, which only the owner email may call.
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
js/auth.js         Supabase login/registration, approval gate, admin button
js/admin.js        Admin page: approve/reject/edit/reset/delete users
sql/               Database setup scripts (approval gate, RLS, admin_delete_user)
supabase/functions/admin-api/   (unused) older Edge Function variant
```

## Privacy

- All data is fetched client-side from the public Radio Browser directory.
- Favorites and volume are stored only in your browser's localStorage.
- Streams are served by their respective broadcasters.
