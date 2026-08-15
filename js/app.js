"use strict";

const API_BASES = [
  "https://de1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://all.api.radio-browser.info",
];
const MAX_RESULTS = 120;
let DEFAULT_COUNTRY = "India";
const LS_FAVORITES = "radioverse.favorites";
const LS_VOLUME = "radioverse.volume";

const $ = (id) => document.getElementById(id);
const audio = $("audio");

const state = {
  apiBase: API_BASES[0],
  country: DEFAULT_COUNTRY,
  language: "",
  genre: "",
  sort: "clickcount",
  query: "",
  offset: 0,
  total: 0,
  stations: [],
  favorites: new Map(),
  favoritesMode: false,
  playing: null,
  metadataTimer: null,
  loading: false,
};

/* ---------------- Utilities ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickApiBase() {
  for (const base of API_BASES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${base}/json/countries?order=name&limit=1`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return base;
    } catch (e) {
      /* try next */
    }
  }
  return API_BASES[0];
}

async function api(path) {
  const res = await fetch(`${state.apiBase}/json${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "";
  const A = 127397;
  return String.fromCodePoint(...countryCode.toUpperCase().split("").map((c) => c.charCodeAt(0) + A));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function firstTag(station) {
  const tags = (station.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  return tags[0] || "";
}

function stationMeta(station) {
  const bits = [];
  if (station.codec) bits.push(station.codec.toUpperCase());
  if (station.bitrate) bits.push(`${station.bitrate} kbps`);
  return bits.join(" \u00b7 ");
}

function initFavorites() {
  try {
    const raw = localStorage.getItem(LS_FAVORITES);
    if (raw) {
      const arr = JSON.parse(raw);
      state.favorites = new Map(arr.map((s) => [s.stationuuid, s]));
    }
  } catch (e) {
    state.favorites = new Map();
  }
  updateFavUI();
}

function saveFavorites() {
  localStorage.setItem(LS_FAVORITES, JSON.stringify([...state.favorites.values()]));
  updateFavUI();
}

function updateFavUI() {
  const count = $("fav-count");
  const toggle = $("favorites-toggle");
  count.hidden = state.favorites.size === 0;
  count.textContent = state.favorites.size;
  toggle.classList.toggle("active", state.favoritesMode);
  toggle.setAttribute("aria-pressed", String(state.favoritesMode));
  if (state.playing) {
    $("player-fav").classList.toggle("active", state.favorites.has(state.playing.stationuuid));
  }
}

function isFavorite(id) {
  return state.favorites.has(id);
}

function toggleFavorite(station) {
  if (state.favorites.has(station.stationuuid)) {
    state.favorites.delete(station.stationuuid);
  } else {
    state.favorites.set(station.stationuuid, station);
  }
  saveFavorites();
}

/* ---------------- Dropdown data ---------------- */

async function loadFilters() {
  try {
    const [countries, languages, genres] = await Promise.all([
      api("/countries?order=name"),
      api("/languages?order=name"),
      api("/tags?order=name"),
    ]);
    const countrySel = $("country-select");
    countrySel.innerHTML = "";
    const sorted = [...countries].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sorted) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      countrySel.appendChild(opt);
    }
    countrySel.value = DEFAULT_COUNTRY;

    const langSel = $("language-select");
    langSel.innerHTML = `<option value="">All languages</option>`;
    const langs = [...languages]
      .filter((l) => l.name && l.name.trim())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const l of langs) {
      const opt = document.createElement("option");
      opt.value = l.name;
      opt.textContent = `${l.name} (${l.stationcount})`;
      langSel.appendChild(opt);
    }

    const genreSel = $("genre-select");
    genreSel.innerHTML = `<option value="">All genres</option>`;
    const tags = [...genres]
      .filter((t) => t.name && t.name.trim() && t.name !== "music")
      .sort((a, b) => b.stationcount - a.stationcount)
      .slice(0, 300);
    tags.sort((a, b) => a.name.localeCompare(b.name));
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = `${t.name} (${t.stationcount})`;
      genreSel.appendChild(opt);
    }
  } catch (e) {
    console.warn("Could not load filter options:", e);
  }
}

/* ---------------- Station fetching ---------------- */

function buildParams(offset) {
  const params = new URLSearchParams();
  params.set("order", state.sort);
  params.set("reverse", "true");
  params.set("hidebroken", "true");
  params.set("limit", String(MAX_RESULTS));
  params.set("offset", String(offset));

  if (state.favoritesMode) {
    return params;
  }
  if (state.country) params.set("country", state.country);
  if (state.language) params.set("language", state.language);
  if (state.genre) params.set("tag", state.genre);
  if (state.query) params.set("name", state.query);
  return params;
}

function applyStationFilters(stations) {
  if (!state.favoritesMode) return stations;
  const list = [...state.favorites.values()];
  const q = state.query.toLowerCase();
  return list.filter((s) => {
    if (state.country && s.country !== state.country) return false;
    if (state.language && s.language !== state.language) return false;
    if (state.genre && !(s.tags || "").toLowerCase().includes(state.genre.toLowerCase())) return false;
    if (q && !(s.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

function sortLocal(list) {
  const copy = [...list];
  switch (state.sort) {
    case "name":
      return copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "bitrate":
      return copy.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    case "votes":
      return copy.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    default:
      return copy.sort((a, b) => (b.clickcount || 0) - (a.clickcount || 0));
  }
}

async function loadStations({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const grid = $("station-grid");
  const loader = $("loading");
  const errorState = $("error-state");
  const emptyState = $("empty-state");

  if (reset) {
    state.offset = 0;
    grid.innerHTML = "";
  }
  loader.hidden = false;
  errorState.hidden = true;
  emptyState.hidden = true;

  try {
    let stations = [];
    if (state.favoritesMode) {
      stations = sortLocal(applyStationFilters());
      state.total = stations.length;
      stations = stations.slice(state.offset, state.offset + MAX_RESULTS);
    } else {
      const params = buildParams(state.offset);
      const url = `${state.apiBase}/json/stations/search?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      stations = await res.json();
      state.total = stations.length >= MAX_RESULTS ? state.offset + MAX_RESULTS + 1 : state.offset + stations.length;
    }

    renderStations(stations);
    state.offset += stations.length;

    const remaining = state.total - state.offset;
    $("load-more").hidden = state.favoritesMode || remaining <= 0;

    loader.hidden = true;
    if (stations.length === 0) emptyState.hidden = false;
  } catch (e) {
    console.error(e);
    loader.hidden = true;
    errorState.hidden = false;
  } finally {
    state.loading = false;
  }
}

/* ---------------- Rendering ---------------- */

function stationCard(station) {
  const card = document.createElement("article");
  card.className = "station-card";
  card.dataset.uuid = station.stationuuid;
  if (state.playing && state.playing.stationuuid === station.stationuuid) {
    card.classList.add("playing");
  }

  const favicon = station.favicon && station.favicon !== "null"
    ? `<img class="card-favicon" src="${escapeHtml(station.favicon)}" alt="" loading="lazy" onerror="this.outerHTML=''" />`
    : "";
  const letter = ((station.name || "?")[0] || "?").toUpperCase();

  const countryName = station.country || "Unknown";
  const flag = flagEmoji(station.countrycode);
  const metaBits = [];
  if (flag) metaBits.push(`<span title="${escapeHtml(countryName)}">${flag} ${escapeHtml(countryName)}</span>`);
  else metaBits.push(`<span>${escapeHtml(countryName)}</span>`);

  const genre = firstTag(station);
  const genreTag = genre ? `<span class="tag">${escapeHtml(genre)}</span>` : "";
  const langTag = station.language
    ? `<span class="tag lang">${escapeHtml(String(station.language).toUpperCase())}</span>`
    : "";

  const isFav = isFavorite(station.stationuuid);

  card.innerHTML = `
    <div class="card-top">
      ${favicon || `<div class="card-avatar">${escapeHtml(letter)}</div>`}
      <span class="card-live"><span class="pulse-dot"></span>ON AIR</span>
    </div>
    <h3 class="card-name" title="${escapeHtml(station.name)}">${escapeHtml(station.name)}</h3>
    <div class="card-meta">${metaBits.join("")}</div>
    <div class="card-tags">${genreTag}${langTag}</div>
    <div class="card-meta">
      <span class="eq-bars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>
      <span class="card-badge">${escapeHtml(stationMeta(station))}</span>
    </div>
    <button class="card-fav ${isFav ? "active" : ""}" title="Favorite" aria-label="Toggle favorite" data-fav="1">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 21s-7.5-4.6-9.7-8.7C.5 9.3 2 5.5 5.6 5.1 7.5 5 9 5.9 12 8.6 15 5.9 16.5 5 18.4 5.1c3.6.4 5.1 4.2 3.3 7.2C19.5 16.4 12 21 12 21z"/></svg>
    </button>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-fav]")) return;
    playStation(station);
  });
  card.querySelector("[data-fav]").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(station);
    card.querySelector("[data-fav]").classList.toggle("active", isFavorite(station.stationuuid));
    if (state.playing && state.playing.stationuuid === station.stationuuid) {
      updatePlayerFav();
    }
  });

  return card;
}

function renderStations(stations) {
  const grid = $("station-grid");
  const frag = document.createDocumentFragment();
  for (const s of stations) frag.appendChild(stationCard(s));
  grid.appendChild(frag);
  updateResultsCount();
}

function updateResultsCount() {
  const el = $("results-count");
  if (state.favoritesMode) {
    el.textContent = `${state.total} favorite station${state.total === 1 ? "" : "s"}`;
  } else {
    const shown = state.offset;
    el.textContent = shown > 0 ? `${shown} stations shown` : "";
  }
}

/* ---------------- Player ---------------- */

function playStation(station) {
  state.playing = station;
  const bar = $("player-bar");
  bar.hidden = false;
  $("player-title").textContent = station.name;

  const faviconEl = $("player-favicon");
  if (station.favicon && station.favicon !== "null") {
    faviconEl.src = station.favicon;
    faviconEl.hidden = false;
  } else {
    faviconEl.hidden = true;
  }

  $("player-now").textContent = "Connecting\u2026";
  $("player-live").hidden = true;
  updatePlayerFav();
  bar.classList.remove("playing");

  document.querySelectorAll(".station-card").forEach((c) => {
    c.classList.toggle("playing", c.dataset.uuid === station.stationuuid);
  });

  const url = station.url_resolved || station.url;
  audio.src = url;
  audio.play().then(() => {
    bar.classList.add("playing");
    $("player-live").hidden = false;
    $("player-now").textContent = "Live stream";
  }).catch((err) => {
    console.warn("Playback error:", err);
    $("player-now").textContent = "Stream unavailable";
    bar.classList.remove("playing");
    $("player-live").hidden = true;
  });

  startMetadataWatch(station);
  if (window.innerWidth < 768) {
    bar.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}

function stopPlayer() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  stopMetadataWatch();
  state.playing = null;
  $("player-bar").hidden = true;
  $("player-bar").classList.remove("playing");
  document.querySelectorAll(".station-card").forEach((c) => c.classList.remove("playing"));
}

function updatePlayerFav() {
  if (!state.playing) return;
  $("player-fav").classList.toggle("active", isFavorite(state.playing.stationuuid));
}

function onPlayerClick(e) {
  const station = state.playing;
  if (!station) return;
  const isPlaying = !audio.paused;
  if (isPlaying) {
    audio.pause();
    $("player-bar").classList.remove("playing");
    $("player-live").hidden = true;
    $("icon-play").hidden = false;
    $("icon-pause").hidden = true;
  } else {
    audio.play().catch(() => {});
    $("player-bar").classList.add("playing");
    $("player-live").hidden = false;
    $("icon-play").hidden = true;
    $("icon-pause").hidden = false;
  }
}

function setPlayerPlayIcon() {
  const playing = state.playing !== null && !audio.paused;
  $("icon-play").hidden = playing;
  $("icon-pause").hidden = !playing;
}

/* ---------------- Now-playing (ICY metadata) ---------------- */

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function startMetadataWatch(station) {
  stopMetadataWatch();
  const url = station.url_resolved || station.url;
  if (!url) return;

  state.metadataTimer = setTimeout(() => {
    if (!state.playing || state.playing.stationuuid !== station.stationuuid) return;
    const now = $("player-now");
    if (now.textContent === "Connecting\u2026" || now.textContent === "Live stream") {
      now.textContent = "Live stream";
    }
  }, 12000);

  let attempt = 0;
  for (const proxy of PROXIES) {
    attempt++;
    try {
      const ok = await readIcyTitle(proxy(url), station);
      if (ok) return;
    } catch (e) {
      /* next proxy */
    }
  }
}

function readIcyTitle(proxyUrl, station) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      resolve(false);
    }, 7000);

    fetch(proxyUrl, {
      signal: ctrl.signal,
      headers: { "Icy-MetaData": "1" },
    })
      .then(async (res) => {
        if (!res.body) throw new Error("no body");
        const reader = res.body.getReader();
        let buffer = new Uint8Array(0);
        let metaInterval = 0;
        let byteCounter = 0;
        let done = false;

        const parse = () => {
          if (metaInterval === 0) return false;
          let title = null;
          while (buffer.length >= metaInterval) {
            const header = buffer[metaInterval];
            const blockLen = header * 16;
            if (buffer.length < metaInterval + 1 + blockLen) break;
            const block = new TextDecoder().decode(
              buffer.subarray(metaInterval + 1, metaInterval + 1 + blockLen)
            );
            const m = block.match(/StreamTitle='([^']*)'/);
            if (m && m[1].trim()) title = m[1].trim();
            buffer = buffer.subarray(metaInterval + 1 + blockLen);
          }
          if (title) {
            done = true;
            resolve(title);
          }
        };

        const handle = ({ value, done: isDone }) => {
          if (isDone || done) {
            clearTimeout(timer);
            if (!done) resolve(false);
            return;
          }
          const next = new Uint8Array(buffer.length + value.length);
          next.set(buffer);
          next.set(value, buffer.length);
          buffer = next;

          if (metaInterval === 0) {
            const idx = buffer.indexOf(0);
            if (idx >= 0) {
              metaInterval = buffer[idx] * 16;
              buffer = buffer.subarray(idx + 1);
              byteCounter = buffer.length;
            }
          }
          parse();
          if (done) {
            clearTimeout(timer);
            return;
          }
          reader.read().then(handle);
        };

        reader.read().then(handle);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  }).then((title) => {
    if (title && state.playing && state.playing.stationuuid === station.stationuuid) {
      $("player-now").textContent = title;
      clearTimeout(state.metadataTimer);
    }
    return !!title;
  });
}

function stopMetadataWatch() {
  clearTimeout(state.metadataTimer);
  state.metadataTimer = null;
}

/* ---------------- Events ---------------- */

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function bindEvents() {
  $("search-input").addEventListener("input", debounce((e) => {
    state.query = e.target.value.trim();
    loadStations({ reset: true });
  }, 350));

  $("country-select").addEventListener("change", (e) => {
    state.country = e.target.value;
    loadStations({ reset: true });
  });

  $("language-select").addEventListener("change", (e) => {
    state.language = e.target.value;
    loadStations({ reset: true });
  });

  $("genre-select").addEventListener("change", (e) => {
    state.genre = e.target.value;
    loadStations({ reset: true });
  });

  $("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    loadStations({ reset: true });
  });

  $("reset-filters").addEventListener("click", () => {
    state.query = "";
    state.language = "";
    state.genre = "";
    state.sort = "clickcount";
    $("search-input").value = "";
    $("language-select").value = "";
    $("genre-select").value = "";
    $("sort-select").value = "clickcount";
    setFavoritesMode(false);
    loadStations({ reset: true });
  });

  $("favorites-toggle").addEventListener("click", () => {
    setFavoritesMode(!state.favoritesMode);
  });

  $("load-more").addEventListener("click", () => loadStations());

  $("retry-btn").addEventListener("click", () => loadStations({ reset: true }));

  $("player-play").addEventListener("click", onPlayerClick);
  $("player-fav").addEventListener("click", () => {
    if (!state.playing) return;
    toggleFavorite(state.playing);
    updatePlayerFav();
    document.querySelectorAll(".station-card").forEach((c) => {
      if (c.dataset.uuid === state.playing.stationuuid) {
        c.querySelector("[data-fav]").classList.toggle("active", isFavorite(state.playing.stationuuid));
      }
    });
  });
  $("player-close").addEventListener("click", stopPlayer);

  const volume = $("player-volume");
  volume.value = localStorage.getItem(LS_VOLUME) ?? "80";
  audio.volume = volume.value / 100;
  volume.addEventListener("input", () => {
    audio.volume = volume.value / 100;
    localStorage.setItem(LS_VOLUME, volume.value);
  });

  audio.addEventListener("play", () => {
    setPlayerPlayIcon();
    $("player-live").hidden = false;
    if (state.playing) {
      document.querySelectorAll(".station-card").forEach((c) => {
        c.classList.toggle("playing", c.dataset.uuid === state.playing.stationuuid);
      });
    }
  });
  audio.addEventListener("pause", () => {
    setPlayerPlayIcon();
    $("player-live").hidden = true;
  });
  audio.addEventListener("error", () => {
    if (!state.playing) return;
    $("player-now").textContent = "Stream unavailable";
    $("player-bar").classList.remove("playing");
    $("player-live").hidden = true;
    setPlayerPlayIcon();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body && state.playing) {
      e.preventDefault();
      onPlayerClick(e);
    }
  });
}

function setFavoritesMode(on) {
  state.favoritesMode = on;
  updateFavUI();
  loadStations({ reset: true });
}

/* ---------------- Init ---------------- */

function init() {
  initFavorites();
  bindEvents();
  $("hero-count").textContent = "Thousands of live stations";
  pickApiBase().then((base) => {
    state.apiBase = base;
    loadFilters();
    loadStations({ reset: true });
  });
}

function setDefaultCountry(name) {
  if (!name || typeof name !== "string") return;
  DEFAULT_COUNTRY = name.trim();
  state.country = DEFAULT_COUNTRY;
  const sel = $("country-select");
  if (sel && sel.options.length) sel.value = DEFAULT_COUNTRY;
}

window.RADIOVERSE_APP = { init, stopPlayer, setDefaultCountry };
