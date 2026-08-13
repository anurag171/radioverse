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
