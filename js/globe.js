"use strict";

(function () {
  const GLOBE_R = 100;
  const MIN_CAM_R = 145;
  const MAX_CAM_R = 430;
  const DEFAULT_CAM_R = 248;
  const CELL = 0.72;
  const TEX_URL = "https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg = Math.PI / 180;

  const els = {
    stage: $("globe-stage"),
    status: $("globe-status"),
    hint: $("globe-hint"),
    placeName: $("globe-place-name"),
    placeSub: $("globe-place-sub"),
    play: $("globe-play"),
    searchPanel: $("globe-search-panel"),
    searchResults: $("globe-search-results"),
    searchClose: $("globe-search-close"),
    placePanel: $("globe-place-panel"),
    placeTitle: $("globe-panel-title"),
    placeSubEl: $("globe-panel-sub"),
    placeList: $("globe-place-list"),
    placeClose: $("globe-place-close"),
    zoomIn: $("globe-zoom-in"),
    zoomOut: $("globe-zoom-out"),
    spin: $("globe-spin"),
    locate: $("globe-locate"),
    shuffle: $("globe-shuffle"),
  };

  let THREE_NS = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let earth = null;
  let pointsMesh = null;
  let marker = null;
  let raycaster = null;
  let raf = 0;
  let visible = true;
  let ready = false;
  let autoRotate = true;
  let dragging = false;
  let moved = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastDragAt = 0;
  let lastPickAt = 0;
  let apiBase = "";
  let clusters = [];
  let hoverCluster = null;
  let openCluster = null;
  let playingUuid = null;
  let reducedMotion = false;

  const cam = { lat: 21.5, lng: 78.9, r: DEFAULT_CAM_R };
  const target = { lat: 21.5, lng: 78.9, r: DEFAULT_CAM_R };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    const A = 127397;
    return String.fromCodePoint(...code.toUpperCase().split("").map((c) => c.charCodeAt(0) + A));
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || "";
  }

  function latLngToVec3(lat, lng, r) {
    const phi = (90 - lat) * deg;
    const theta = (lng + 180) * deg;
    return new THREE_NS.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  function vec3ToLatLng(v) {
    const r = v.length() || 1;
    const phi = Math.acos(clamp(v.y / r, -1, 1));
    const theta = Math.atan2(v.z, -v.x);
    return {
      lat: 90 - phi / deg,
      lng: theta / deg - 180,
    };
  }

  function wrapLng(lng) {
    let x = lng;
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
  }

  function shortestLng(from, to) {
    let d = wrapLng(to) - wrapLng(from);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return from + d;
  }

  function dist2(a, b) {
    const dlat = a.lat - b.lat;
    const dlng = (wrapLng(a.lng) - wrapLng(b.lng)) * Math.cos(((a.lat + b.lat) * 0.5) * deg);
    return dlat * dlat + dlng * dlng;
  }

  function glowTexture() {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    const mid = size * 0.5;
    const grd = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.08, "rgba(235,255,250,1)");
    grd.addColorStop(0.16, "rgba(120,255,220,0.95)");
    grd.addColorStop(0.28, "rgba(0,229,255,0.45)");
    grd.addColorStop(0.42, "rgba(0,180,255,0.12)");
    grd.addColorStop(0.62, "rgba(0,120,255,0.03)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const tex = new THREE_NS.CanvasTexture(c);
    tex.colorSpace = THREE_NS.SRGBColorSpace;
    tex.minFilter = THREE_NS.LinearFilter;
    tex.magFilter = THREE_NS.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function applyCamera() {
    const pos = latLngToVec3(cam.lat, cam.lng, cam.r);
    camera.position.copy(pos);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);
  }

  function createStars() {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 800 + Math.random() * 700;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE_NS.BufferGeometry();
    geo.setAttribute("position", new THREE_NS.BufferAttribute(pos, 3));
    const mat = new THREE_NS.PointsMaterial({
      color: 0xb8c8ff,
      size: 1.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    scene.add(new THREE_NS.Points(geo, mat));
  }

  function createAtmosphere() {
    const geo = new THREE_NS.SphereGeometry(GLOBE_R * 1.045, 64, 48);
    const mat = new THREE_NS.ShaderMaterial({
      vertexShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "  vNormal = normalize(normalMatrix * normal);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "  float i = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.4);",
        "  gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * i * 0.55;",
        "}",
      ].join("\n"),
      blending: THREE_NS.AdditiveBlending,
      side: THREE_NS.BackSide,
      transparent: true,
      depthWrite: false,
    });
    scene.add(new THREE_NS.Mesh(geo, mat));
  }

  function createEarth() {
    const geo = new THREE_NS.SphereGeometry(GLOBE_R, 96, 72);
    const mat = new THREE_NS.MeshLambertMaterial({
      color: 0x3a5a88,
    });
    earth = new THREE_NS.Mesh(geo, mat);
    scene.add(earth);

    const loader = new THREE_NS.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(TEX_URL, (tex) => {
      tex.colorSpace = THREE_NS.SRGBColorSpace;
      tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
      tex.minFilter = THREE_NS.LinearMipmapLinearFilter;
      tex.magFilter = THREE_NS.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      earth.material = new THREE_NS.MeshLambertMaterial({
        map: tex,
        color: 0xffffff,
        emissive: 0x1a2a44,
        emissiveMap: tex,
        emissiveIntensity: 0.55,
      });
    });
  }

  function createMarker() {
    const ring = new THREE_NS.Mesh(
      new THREE_NS.RingGeometry(1.6, 2.05, 48),
      new THREE_NS.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE_NS.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    );
    const inner = new THREE_NS.Mesh(
      new THREE_NS.CircleGeometry(0.55, 24),
      new THREE_NS.MeshBasicMaterial({
        color: 0x3cf59a,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    marker = new THREE_NS.Group();
    marker.add(ring);
    marker.add(inner);
    marker.visible = false;
    scene.add(marker);
  }

  function placeMarker(cluster) {
    if (!marker || !cluster) {
      if (marker) marker.visible = false;
      return;
    }
    const p = latLngToVec3(cluster.lat, cluster.lng, GLOBE_R + 1.2);
    marker.position.copy(p);
    marker.lookAt(p.clone().multiplyScalar(2));
    const s = 1.1 + Math.min(2.4, Math.log2(cluster.count + 1) * 0.45);
    marker.scale.setScalar(s);
    marker.visible = true;
  }

  function clusterStations(stations) {
    const map = new Map();
    for (const s of stations) {
      const lat = Number(s.geo_lat);
      const lng = Number(s.geo_long);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) < 0.02 && Math.abs(lng) < 0.02) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const key = `${Math.round(lat / CELL) * CELL}_${Math.round(lng / CELL) * CELL}`;
      let c = map.get(key);
      if (!c) {
        c = {
          key,
          lat,
          lng,
          sumLat: 0,
          sumLng: 0,
          count: 0,
          country: s.country || "",
          countrycode: s.countrycode || "",
          city: (s.state || "").trim(),
          stations: [],
        };
        map.set(key, c);
      }
      c.sumLat += lat;
      c.sumLng += lng;
      c.count += 1;
      if (!c.city && s.state) c.city = String(s.state).trim();
      if (!c.country && s.country) c.country = s.country;
      c.stations.push(s);
    }
    const list = [];
    for (const c of map.values()) {
      c.lat = c.sumLat / c.count;
      c.lng = c.sumLng / c.count;
      c.stations.sort((a, b) => (b.clickcount || 0) - (a.clickcount || 0));
      if (c.stations.length > 40) c.stations.length = 40;
      c.label = c.city || c.country || "Unknown place";
      c.sub = [c.city && c.city !== c.country ? c.country : "", `${c.count} station${c.count === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · ");
      list.push(c);
    }
    return list;
  }

  function buildPoints() {
    if (pointsMesh) {
      scene.remove(pointsMesh);
      pointsMesh.geometry.dispose();
      pointsMesh.material.dispose();
      pointsMesh = null;
    }
    if (!clusters.length) return;

    const n = clusters.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const cyan = new THREE_NS.Color(0x00e5ff);
    const green = new THREE_NS.Color(0x3cf59a);
    const mag = new THREE_NS.Color(0xff2bd6);

    for (let i = 0; i < n; i++) {
      const c = clusters[i];
      const v = latLngToVec3(c.lat, c.lng, GLOBE_R + 0.35);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      const t = clamp(Math.log2(c.count + 1) / 7, 0, 1);
      const color = cyan.clone().lerp(green, t);
      if (playingUuid && c.stations.some((s) => s.stationuuid === playingUuid)) {
        color.copy(mag);
      }
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
      size[i] = 2.1 + Math.min(5.8, Math.log2(c.count + 1) * 1.15);
    }

    const geo = new THREE_NS.BufferGeometry();
    geo.setAttribute("position", new THREE_NS.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE_NS.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE_NS.BufferAttribute(size, 1));

    const mat = new THREE_NS.ShaderMaterial({
      uniforms: {
        uMap: { value: glowTexture() },
        uScale: { value: 1.15 },
      },
      vertexShader: [
        "attribute float aSize;",
        "attribute vec3 aColor;",
        "varying vec3 vColor;",
        "uniform float uScale;",
        "void main() {",
        "  vColor = aColor;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_PointSize = min(18.0, aSize * uScale * (175.0 / -mv.z));",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "varying vec3 vColor;",
        "void main() {",
        "  vec4 t = texture2D(uMap, gl_PointCoord);",
        "  float a = pow(t.a, 1.35);",
        "  if (a < 0.05) discard;",
        "  vec3 rgb = vColor * (0.55 + 0.45 * a);",
        "  gl_FragColor = vec4(rgb, a);",
        "}",
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      blending: THREE_NS.AdditiveBlending,
    });

    pointsMesh = new THREE_NS.Points(geo, mat);
    scene.add(pointsMesh);
  }

  function nearestCluster(latlng, maxD) {
    let best = null;
    let bestD = maxD * maxD;
    for (const c of clusters) {
      const d = dist2(latlng, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function clusterAtClient(clientX, clientY) {
    if (!renderer || !clusters.length) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const camDir = camera.position.clone().normalize();
    let best = null;
    let bestD = 18 * 18;
    for (const c of clusters) {
      const p = latLngToVec3(c.lat, c.lng, GLOBE_R);
      if (p.clone().normalize().dot(camDir) < 0.12) continue;
      p.project(camera);
      const sx = (p.x * 0.5 + 0.5) * rect.width;
      const sy = (-p.y * 0.5 + 0.5) * rect.height;
      const dx = sx - x;
      const dy = sy - y;
      const d = dx * dx + dy * dy;
      const pad = 10 + Math.min(22, Math.sqrt(c.count) * 2);
      if (d < pad * pad && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function pickCenterPlace() {
    if (!raycaster || !earth || !clusters.length) return;
    raycaster.setFromCamera({ x: 0, y: 0.02 }, camera);
    const hits = raycaster.intersectObject(earth, false);
    if (!hits.length) return;
    const ll = vec3ToLatLng(hits[0].point);
    const maxD = 0.35 + (cam.r - MIN_CAM_R) / 180;
    const c = nearestCluster(ll, maxD);
    if (c !== hoverCluster) {
      hoverCluster = c;
      updateTuneHud();
    }
  }

  function updateTuneHud() {
    const c = openCluster || hoverCluster;
    if (!c) {
      els.placeName.textContent = "Spin the globe";
      els.placeSub.textContent = "Explore live radio worldwide";
      els.play.classList.remove("ready");
      return;
    }
    const flag = flagEmoji(c.countrycode);
    els.placeName.textContent = `${flag ? flag + " " : ""}${c.label}`;
    els.placeSub.textContent = c.sub;
    els.play.classList.add("ready");
  }

  function flyTo(lat, lng, r) {
    target.lat = clamp(lat, -85, 85);
    target.lng = shortestLng(cam.lng, lng);
    if (r) target.r = clamp(r, MIN_CAM_R, MAX_CAM_R);
    autoRotate = false;
    if (els.spin) els.spin.setAttribute("aria-pressed", "false");
  }

  function openPlace(cluster, shouldPlay) {
    if (!cluster) return;
    openCluster = cluster;
    hoverCluster = cluster;
    placeMarker(cluster);
    flyTo(cluster.lat, cluster.lng, Math.max(MIN_CAM_R + 8, cam.r * 0.82));
    updateTuneHud();
    els.placePanel.hidden = false;
    els.placeTitle.textContent = cluster.label;
    els.placeSubEl.textContent = `${flagEmoji(cluster.countrycode)} ${cluster.sub}`.trim();
    renderPlaceList(cluster);
    if (shouldPlay && cluster.stations[0] && window.RADIOVERSE_APP && window.RADIOVERSE_APP.playStation) {
      window.RADIOVERSE_APP.playStation(cluster.stations[0]);
    }
  }

  function closePlace() {
    openCluster = null;
    els.placePanel.hidden = true;
    if (!hoverCluster) placeMarker(null);
    updateTuneHud();
  }

  function renderPlaceList(cluster) {
    const frag = document.createDocumentFragment();
    cluster.stations.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "globe-row";
      if (playingUuid && s.stationuuid === playingUuid) btn.classList.add("playing");
      const bits = [];
      if (s.codec) bits.push(String(s.codec).toUpperCase());
      if (s.bitrate) bits.push(`${s.bitrate} kbps`);
      if (s.language) bits.push(String(s.language));
      btn.innerHTML = `
        <span class="globe-row-index">${i + 1}</span>
        <span class="globe-row-body">
          <span class="globe-row-name">${escapeHtml(s.name || "Station")}</span>
          <span class="globe-row-meta">${escapeHtml(bits.join(" · "))}</span>
        </span>
      `;
      btn.addEventListener("click", () => {
        if (window.RADIOVERSE_APP && window.RADIOVERSE_APP.playStation) {
          window.RADIOVERSE_APP.playStation(s);
        }
      });
      frag.appendChild(btn);
    });
    els.placeList.innerHTML = "";
    els.placeList.appendChild(frag);
  }

  function hideSearch() {
    els.searchPanel.hidden = true;
  }

  function search(query) {
    const q = (query || "").trim();
    if (!q) {
      els.searchResults.innerHTML = `<p class="globe-search-empty">Type a city, country or station name.</p>`;
      els.searchPanel.hidden = false;
      return;
    }
    els.searchPanel.hidden = false;
    const needle = q.toLowerCase();
    const placeHits = clusters
      .filter((c) =>
        c.label.toLowerCase().includes(needle) ||
        (c.country || "").toLowerCase().includes(needle) ||
        (c.city || "").toLowerCase().includes(needle)
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const stationHits = [];
    for (const c of clusters) {
      for (const s of c.stations) {
        if ((s.name || "").toLowerCase().includes(needle)) {
          stationHits.push({ station: s, cluster: c });
          if (stationHits.length >= 12) break;
        }
      }
      if (stationHits.length >= 12) break;
    }

    if (!placeHits.length && !stationHits.length) {
      els.searchResults.innerHTML = `<p class="globe-search-empty">No places or stations match “${escapeHtml(q)}”.</p>`;
      return;
    }

    const parts = [];
    if (placeHits.length) {
      parts.push(`<h3 class="globe-search-label">Places</h3>`);
      placeHits.forEach((c) => {
        parts.push(`
          <button type="button" class="globe-row" data-place="${escapeHtml(c.key)}">
            <span class="globe-row-badge">Place</span>
            <span class="globe-row-body">
              <span class="globe-row-name">${escapeHtml((flagEmoji(c.countrycode) + " " + c.label).trim())}</span>
              <span class="globe-row-meta">${escapeHtml(c.sub)}</span>
            </span>
          </button>
        `);
      });
    }
    if (stationHits.length) {
      parts.push(`<h3 class="globe-search-label">Stations</h3>`);
      stationHits.forEach((hit, i) => {
        parts.push(`
          <button type="button" class="globe-row" data-station="${i}">
            <span class="globe-row-badge station">On air</span>
            <span class="globe-row-body">
              <span class="globe-row-name">${escapeHtml(hit.station.name || "Station")}</span>
              <span class="globe-row-meta">${escapeHtml((hit.cluster.label + " · " + (hit.cluster.country || "")).trim())}</span>
            </span>
          </button>
        `);
      });
    }
    els.searchResults.innerHTML = parts.join("");
    els.searchResults.querySelectorAll("[data-place]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = clusters.find((x) => x.key === btn.getAttribute("data-place"));
        hideSearch();
        openPlace(c, true);
      });
    });
    els.searchResults.querySelectorAll("[data-station]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hit = stationHits[Number(btn.getAttribute("data-station"))];
        if (!hit) return;
        hideSearch();
        openPlace(hit.cluster, false);
        if (window.RADIOVERSE_APP && window.RADIOVERSE_APP.playStation) {
          window.RADIOVERSE_APP.playStation(hit.station);
        }
      });
    });
  }

  function playHover() {
    const c = openCluster || hoverCluster;
    if (!c) return;
    openPlace(c, true);
  }

  function resize() {
    if (!renderer || !camera || !els.stage) return;
    const w = els.stage.clientWidth || window.innerWidth;
    const h = els.stage.clientHeight || window.innerHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function tick() {
    if (!visible) return;
    const now = performance.now();
    if (autoRotate && !dragging && now - lastDragAt > 1400) {
      target.lng = wrapLng(target.lng + 0.045);
    }
    const k = reducedMotion ? 1 : 0.085;
    cam.lat = lerp(cam.lat, target.lat, k);
    cam.lng = lerp(cam.lng, shortestLng(cam.lng, target.lng), k);
    cam.r = lerp(cam.r, target.r, k);
    cam.lat = clamp(cam.lat, -85, 85);
    applyCamera();
    if (marker && marker.visible) {
      const pulse = 1 + Math.sin(now * 0.004) * 0.08;
      marker.children[0].scale.setScalar(pulse);
    }
    if (!dragging && now - lastPickAt > 180) {
      lastPickAt = now;
      pickCenterPlace();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    moved = false;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    els.stage.setPointerCapture(e.pointerId);
    autoRotate = false;
    if (els.spin) els.spin.setAttribute("aria-pressed", "false");
    if (els.hint) els.hint.classList.add("gone");
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    const sens = 0.12 * (cam.r / DEFAULT_CAM_R);
    target.lng = wrapLng(target.lng - dx * sens);
    target.lat = clamp(target.lat + dy * sens, -85, 85);
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    lastDragAt = performance.now();
    try {
      els.stage.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (!moved) {
      const c = clusterAtClient(e.clientX, e.clientY);
      if (c) openPlace(c, true);
    } else {
      pickCenterPlace();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const next = target.r + e.deltaY * 0.18;
    target.r = clamp(next, MIN_CAM_R, MAX_CAM_R);
    autoRotate = false;
    if (els.spin) els.spin.setAttribute("aria-pressed", "false");
  }

  function bindHud() {
    els.zoomIn.addEventListener("click", () => {
      target.r = clamp(target.r - 36, MIN_CAM_R, MAX_CAM_R);
    });
    els.zoomOut.addEventListener("click", () => {
      target.r = clamp(target.r + 36, MIN_CAM_R, MAX_CAM_R);
    });
    els.spin.addEventListener("click", () => {
      autoRotate = !autoRotate;
      els.spin.setAttribute("aria-pressed", String(autoRotate));
    });
    els.locate.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setStatus("Location is not available");
        return;
      }
      setStatus("Finding you…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          flyTo(lat, lng, 175);
          const c = nearestCluster({ lat, lng }, 8);
          setStatus("");
          if (c) openPlace(c, false);
        },
        () => setStatus("Could not read location"),
        { enableHighAccuracy: false, timeout: 8000 }
      );
    });
    els.shuffle.addEventListener("click", () => {
      if (!clusters.length) return;
      const pool = clusters.filter((c) => c.count >= 2);
      const c = (pool.length ? pool : clusters)[Math.floor(Math.random() * (pool.length || clusters.length))];
      openPlace(c, true);
    });
    els.play.addEventListener("click", (e) => {
      e.stopPropagation();
      playHover();
    });
    els.placeClose.addEventListener("click", closePlace);
    els.searchClose.addEventListener("click", hideSearch);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideSearch();
        closePlace();
      }
    });
  }

  function bindStage() {
    els.stage.addEventListener("pointerdown", onPointerDown);
    els.stage.addEventListener("pointermove", onPointerMove);
    els.stage.addEventListener("pointerup", onPointerUp);
    els.stage.addEventListener("pointercancel", onPointerUp);
    els.stage.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resize);
  }

  async function loadGeoStations() {
    setStatus("Mapping live stations…");
    const urls = [
      `${apiBase}/json/stations/search?hidebroken=true&has_geo_info=true&order=clickcount&reverse=true&limit=5000`,
      `${apiBase}/json/stations/search?hidebroken=true&has_geo_info=true&order=votes&reverse=true&limit=4000`,
    ];
    let stations = [];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        stations = await res.json();
        if (Array.isArray(stations) && stations.length) break;
      } catch (err) {
        /* try next */
      }
    }
    if (!stations.length) {
      setStatus("Could not map stations");
      return;
    }
    clusters = clusterStations(stations);
    buildPoints();
    ready = true;
    setStatus(`${clusters.length.toLocaleString()} places on air`);
    pickCenterPlace();
    const india = nearestCluster({ lat: 19.07, lng: 72.87 }, 12);
    if (india) {
      hoverCluster = india;
      updateTuneHud();
    }
  }

  function initScene() {
    THREE_NS = window.THREE;
    scene = new THREE_NS.Scene();
    scene.fog = new THREE_NS.FogExp2(0x071018, 0.00055);
    camera = new THREE_NS.PerspectiveCamera(45, 1, 0.1, 3000);
    renderer = new THREE_NS.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.setClearColor(0x071018, 1);
    renderer.outputColorSpace = THREE_NS.SRGBColorSpace;
    els.stage.innerHTML = "";
    els.stage.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";

    scene.add(new THREE_NS.AmbientLight(0xc8d6ee, 1.35));
    const sun = new THREE_NS.DirectionalLight(0xffffff, 1.55);
    sun.position.set(2.2, 1.6, 3.4);
    scene.add(sun);
    const fill = new THREE_NS.DirectionalLight(0x88aacc, 0.55);
    fill.position.set(-3, -1, -2);
    scene.add(fill);

    createStars();
    createEarth();
    createAtmosphere();
    createMarker();
    raycaster = new THREE_NS.Raycaster();
    applyCamera();
    resize();
  }

  function init(base) {
    if (!els.stage) return;
    apiBase = base || apiBase;
    reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) autoRotate = false;
    if (!window.THREE) {
      setStatus("Globe needs WebGL");
      return;
    }
    if (!renderer) {
      initScene();
      bindStage();
      bindHud();
    }
    visible = true;
    resize();
    startLoop();
    if (!clusters.length) loadGeoStations();
  }

  function setVisible(on) {
    visible = !!on;
    if (visible) {
      resize();
      startLoop();
    } else {
      stopLoop();
    }
  }

  function setPlaying(station) {
    playingUuid = station ? station.stationuuid : null;
    if (pointsMesh && clusters.length) buildPoints();
    if (openCluster) renderPlaceList(openCluster);
    if (station && Number.isFinite(Number(station.geo_lat))) {
      const c = nearestCluster({ lat: Number(station.geo_lat), lng: Number(station.geo_long) }, 2.5);
      if (c) {
        hoverCluster = c;
        placeMarker(c);
        updateTuneHud();
      }
    }
  }

  window.RADIOVERSE_GLOBE = {
    init,
    search,
    hideSearch,
    setPlaying,
    setVisible,
    resize,
  };
})();
