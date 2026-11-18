import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_CITIES } from './cities.js';
import { COUNTRY_PEAKS } from './peaks.js';
import { createSpaceEnvironment } from './space.js';
import { WorldGlobe, GLOBE_RADIUS, getFeatureCenter, latLonToVector3 } from './globe.js';

const STORAGE_KEY = 'world_map_3d_state_v2';

// State
const state = {
  visitedCountries: new Set(),
  visitedCities: new Set(['de-berlin']),
  customCities: [],
  homeBaseId: 'de-berlin',
  focusedCountryName: 'Germany',
  mode: 'country', // 'country' | 'pin'
  settings: {
    arcs: true,
    labels: true,
    clouds: true,
    space: true,
    autoRotate: false
  }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.visitedCountries)) state.visitedCountries = new Set(data.visitedCountries);
    if (Array.isArray(data.visitedCities)) state.visitedCities = new Set(data.visitedCities);
    if (Array.isArray(data.customCities)) state.customCities = data.customCities;
    if (data.homeBaseId) state.homeBaseId = data.homeBaseId;
    if (data.settings) Object.assign(state.settings, data.settings);
  } catch (err) {
    console.warn('Could not load saved state:', err);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      visitedCountries: [...state.visitedCountries],
      visitedCities: [...state.visitedCities],
      customCities: state.customCities,
      homeBaseId: state.homeBaseId,
      settings: state.settings
    })
  );
}

function getAllCities() {
  return [...WORLD_CITIES, ...state.customCities];
}

// Scene setup
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#03060d');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.02, 800);
camera.position.set(0, 8, 28);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.rotateSpeed = 0.26;
controls.zoomSpeed = 0.45;
controls.minDistance = 10.06;
controls.maxDistance = 68;

// Realistic Day/Night lighting (clearly shows where the Sun shines)
const hemiLight = new THREE.HemisphereLight('#7aa8de', '#080e1c', 0.25);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight('#fff5db', 5.2);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight('#3aa8ff', 0.28);
rimLight.position.set(-45, -18, -35);
scene.add(rimLight);

// Real-time subsolar point from current UTC time
let currentSunPoint = { lat: 0, lon: 0 };
function getSubsolarPoint(date = new Date()) {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const dayOfYear = (date - startOfYear) / 86400000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));

  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (12 - utcHours) * 15;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;

  return { lat, lon };
}

function updateRealTimeSun() {
  const now = new Date();
  currentSunPoint = getSubsolarPoint(now);
  const sunDir = latLonToVector3(currentSunPoint.lat, currentSunPoint.lon, 1).normalize();

  sunLight.position.copy(sunDir).multiplyScalar(75);
  rimLight.position.copy(sunDir).multiplyScalar(-55);
  spaceEnv.setSunDirection(sunDir);
  globe.setSubsolarPoint(currentSunPoint.lat, currentSunPoint.lon);

  const labelEl = document.getElementById('sun-time-label');
  if (labelEl) {
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    labelEl.textContent = `${hh}:${mm}`;
  }
}

// Space & Globe
const spaceEnv = createSpaceEnvironment(scene);
const globe = new WorldGlobe(scene, renderer.capabilities.getMaxAnisotropy());

// Smooth Camera Fly-To
let flyAnim = null;
function flyTo(lat, lon, targetDist = 15.0) {
  const targetPos = latLonToVector3(lat, lon, targetDist);
  flyAnim = {
    startPos: camera.position.clone(),
    endPos: targetPos,
    progress: 0
  };
}

// Raycasting (zero texture redraw on hover -> locked 60+ FPS)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('globe-tooltip');
let pointerDownPos = { x: 0, y: 0 };
let pendingPinCoords = null;
let lastHoverCheck = 0;

function getHitLatLon(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(globe.sphereMesh, false);
  if (!hits.length || !hits[0].uv) return null;
  const uv = hits[0].uv;
  return {
    lon: uv.x * 360 - 180,
    lat: uv.y * 180 - 90
  };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (now - lastHoverCheck < 35) return; // throttle hover check to ~28Hz
  lastHoverCheck = now;

  const coords = getHitLatLon(e.clientX, e.clientY);
  if (!coords) {
    tooltip.classList.add('hidden');
    return;
  }

  const country = globe.findCountryAt(coords.lat, coords.lon);
  if (country) {
    const visited = state.visitedCountries.has(country._id);
    const cityCount = getAllCities().filter((c) => c.country === country._name).length;
    tooltip.innerHTML = `<strong>${country._name}</strong> ${visited ? '✓ Besucht' : '• Klicken'}${cityCount ? ` • ${cityCount} Städte` : ''}`;
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.classList.remove('hidden');
  } else if (state.mode === 'pin') {
    tooltip.textContent = `📍 Pin setzen (${coords.lat.toFixed(1)}°, ${coords.lon.toFixed(1)}°)`;
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.classList.remove('hidden');
  } else {
    tooltip.classList.add('hidden');
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  if (dist > 6 || e.button !== 0) return;

  const coords = getHitLatLon(e.clientX, e.clientY);
  if (!coords) return;

  if (state.mode === 'pin') {
    const country = globe.findCountryAt(coords.lat, coords.lon);
    pendingPinCoords = {
      lat: coords.lat,
      lon: coords.lon,
      countryName: country ? country._name : 'Unbekannt'
    };
    openPinModal(pendingPinCoords);
    return;
  }

  const country = globe.findCountryAt(coords.lat, coords.lon);
  if (country) {
    state.focusedCountryName = country._name;
    toggleCountryVisited(country._id);
  }
});

// UI Elements
const statCountries = document.getElementById('stat-countries');
const statCities = document.getElementById('stat-cities');
const statPercent = document.getElementById('stat-percent');

const sidebar = document.getElementById('sidebar');
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Mode buttons
const modeCountryBtn = document.getElementById('mode-country');
const modePinBtn = document.getElementById('mode-pin');
const modeHint = document.getElementById('mode-hint');

function setMode(mode) {
  state.mode = mode;
  modeCountryBtn.classList.toggle('active', mode === 'country');
  modePinBtn.classList.toggle('active', mode === 'pin');
  modeHint.textContent = mode === 'country'
    ? 'Klicke auf ein Land auf dem Globus, um es als „Besucht“ zu markieren. Beim Reinzoomen erscheinen die Städte des jeweiligen Landes.'
    : 'Klicke auf eine beliebige Stelle auf dem Globus, um dort einen eigenen Ort zu speichern.';
}

modeCountryBtn.addEventListener('click', () => setMode('country'));
modePinBtn.addEventListener('click', () => setMode('pin'));

// Pin Modal
const pinModal = document.getElementById('pin-modal');
const pinModalCoords = document.getElementById('pin-modal-coords');
const pinNameInput = document.getElementById('pin-name-input');
const pinNoteInput = document.getElementById('pin-note-input');

function openPinModal(coords) {
  pinModalCoords.textContent = `${coords.countryName} • ${coords.lat.toFixed(2)}°, ${coords.lon.toFixed(2)}°`;
  pinNameInput.value = '';
  pinNoteInput.value = '';
  pinModal.classList.remove('hidden');
  setTimeout(() => pinNameInput.focus(), 50);
}

document.getElementById('pin-cancel').addEventListener('click', () => {
  pinModal.classList.add('hidden');
  pendingPinCoords = null;
});

document.getElementById('pin-save').addEventListener('click', () => {
  const name = pinNameInput.value.trim();
  if (!name || !pendingPinCoords) return;

  const id = `custom_${Date.now()}`;
  const newCity = {
    id,
    name,
    country: pendingPinCoords.countryName,
    note: pinNoteInput.value.trim(),
    lat: pendingPinCoords.lat,
    lon: pendingPinCoords.lon,
    isCustom: true
  };

  state.customCities.push(newCity);
  state.visitedCities.add(id);
  state.focusedCountryName = newCity.country;

  const country = globe.findCountryAt(pendingPinCoords.lat, pendingPinCoords.lon);
  if (country) state.visitedCountries.add(country._id);

  pinModal.classList.add('hidden');
  saveState();
  refreshAll();
  flyTo(newCity.lat, newCity.lon, 14.2);
  pendingPinCoords = null;
});

// Toggle functions
function toggleCountryVisited(countryId) {
  if (state.visitedCountries.has(countryId)) {
    state.visitedCountries.delete(countryId);
  } else {
    state.visitedCountries.add(countryId);
  }
  saveState();
  refreshAll();
}

function toggleCityVisited(cityId) {
  if (state.visitedCities.has(cityId)) {
    state.visitedCities.delete(cityId);
  } else {
    state.visitedCities.add(cityId);
    const city = getAllCities().find((c) => c.id === cityId);
    if (city) {
      state.focusedCountryName = city.country;
      const country = globe.countries.find((f) => f._name === city.country);
      if (country) state.visitedCountries.add(country._id);
    }
  }
  saveState();
  refreshAll();
}

// Search
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const searchResults = document.getElementById('search-results');

function renderSearchResults() {
  const q = searchInput.value.trim().toLowerCase();
  clearSearchBtn.classList.toggle('hidden', !q);
  searchResults.innerHTML = '';
  if (!q) return;

  const cityMatches = getAllCities()
    .filter((c) => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    .slice(0, 8);

  const countryMatches = globe.countries
    .filter((f) => f._name.toLowerCase().includes(q))
    .slice(0, 6);

  for (const city of cityMatches) {
    const visited = state.visitedCities.has(city.id);
    const el = document.createElement('div');
    el.className = 'search-item';
    el.innerHTML = `
      <span>🏙 ${city.name} <small style="color:#9aa3b2">(${city.country})</small></span>
      <span class="badge ${visited ? 'visited' : ''}">${visited ? '✓ Besucht' : '+ Markieren'}</span>
    `;
    el.addEventListener('click', () => {
      if (!visited) toggleCityVisited(city.id);
      flyTo(city.lat, city.lon, 14.0);
    });
    searchResults.appendChild(el);
  }

  for (const country of countryMatches) {
    const visited = state.visitedCountries.has(country._id);
    const el = document.createElement('div');
    el.className = 'search-item';
    el.innerHTML = `
      <span>🌍 ${country._name}</span>
      <span class="badge ${visited ? 'visited' : ''}">${visited ? '✓ Besucht' : '+ Markieren'}</span>
    `;
    el.addEventListener('click', () => {
      state.focusedCountryName = country._name;
      toggleCountryVisited(country._id);
      const center = getFeatureCenter(country);
      flyTo(center.lat, center.lon, 16.5);
    });
    searchResults.appendChild(el);
  }
}

searchInput.addEventListener('input', renderSearchResults);
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  renderSearchResults();
});

// Cities & highest peak in focused country
function renderFocusedCountryCities() {
  const titleEl = document.getElementById('country-cities-title');
  const listEl = document.getElementById('country-cities-list');
  const countryName = state.focusedCountryName || 'Germany';
  const cities = getAllCities().filter((c) => c.country === countryName);
  const peak = COUNTRY_PEAKS.find((p) => p.country === countryName);

  titleEl.textContent = `Städte & Gipfel in ${countryName} (${cities.length})`;
  listEl.innerHTML = '';

  if (peak) {
    const peakCard = document.createElement('div');
    peakCard.className = 'peak-card';
    peakCard.style.width = '100%';
    peakCard.innerHTML = `
      <span>⛰ ${peak.name}</span>
      <span class="peak-elev">${peak.elevation.toLocaleString('de-CH')} m ü. M.</span>
    `;
    peakCard.title = `Zum höchsten Punkt (${peak.name}) fliegen`;
    peakCard.addEventListener('click', () => flyTo(peak.lat, peak.lon, 13.5));
    listEl.appendChild(peakCard);
  }

  if (!cities.length) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Keine vordefinierten Städte – nutze „📍 Ort / Pin setzen“, um eigene hinzuzufügen.';
    listEl.appendChild(p);
    return;
  }

  for (const city of cities) {
    const visited = state.visitedCities.has(city.id);
    const btn = document.createElement('button');
    btn.className = `chip-btn ${visited ? 'visited' : ''}`;
    if (city.isCapital) {
      btn.style.borderColor = '#ff3b4e';
    }
    btn.textContent = `${visited ? '✓ ' : ''}${city.isCapital ? '★ ' : ''}${city.name}`;
    btn.title = `${city.isCapital ? 'Hauptstadt • ' : ''}${city.name} markieren & anfliegen`;
    btn.addEventListener('click', () => {
      toggleCityVisited(city.id);
      flyTo(city.lat, city.lon, 13.8);
    });
    listEl.appendChild(btn);
  }
}

// Visited tab lists & home base
const homeBaseSelect = document.getElementById('home-base-select');
homeBaseSelect.addEventListener('change', () => {
  state.homeBaseId = homeBaseSelect.value;
  state.visitedCities.add(state.homeBaseId);
  saveState();
  refreshAll();
});

function renderVisitedLists() {
  const allCities = getAllCities();

  homeBaseSelect.innerHTML = '';
  for (const city of allCities) {
    const opt = document.createElement('option');
    opt.value = city.id;
    opt.textContent = `${city.name} (${city.country})`;
    if (city.id === state.homeBaseId) opt.selected = true;
    homeBaseSelect.appendChild(opt);
  }

  const citiesListEl = document.getElementById('visited-cities-list');
  citiesListEl.innerHTML = '';
  const visitedCityObjs = allCities.filter((c) => state.visitedCities.has(c.id));

  if (!visitedCityObjs.length) {
    citiesListEl.innerHTML = '<p class="hint-text">Noch keine Städte markiert.</p>';
  } else {
    for (const city of visitedCityObjs) {
      const row = document.createElement('div');
      row.className = 'visited-row';
      row.innerHTML = `
        <div class="visited-row-info">
          <span>${city.id === state.homeBaseId ? '🏠 ' : '🏙 '}${city.name}</span>
          <small>${city.country}${city.note ? ' • ' + city.note : ''}</small>
        </div>
        <div class="visited-row-actions">
          <button class="mini-btn" title="Hinfliegen">🔍</button>
          <button class="mini-btn remove" title="Entfernen">✕</button>
        </div>
      `;
      row.querySelector('.visited-row-info').addEventListener('click', () => flyTo(city.lat, city.lon, 14.0));
      row.querySelector('.mini-btn').addEventListener('click', () => flyTo(city.lat, city.lon, 14.0));
      row.querySelector('.remove').addEventListener('click', () => {
        state.visitedCities.delete(city.id);
        if (city.isCustom) {
          state.customCities = state.customCities.filter((c) => c.id !== city.id);
        }
        saveState();
        refreshAll();
      });
      citiesListEl.appendChild(row);
    }
  }

  const countriesListEl = document.getElementById('visited-countries-list');
  countriesListEl.innerHTML = '';
  const visitedCountryObjs = globe.countries.filter((f) => state.visitedCountries.has(f._id));

  if (!visitedCountryObjs.length) {
    countriesListEl.innerHTML = '<p class="hint-text">Noch keine Länder markiert. Klicke einfach auf den Globus!</p>';
  } else {
    for (const country of visitedCountryObjs) {
      const row = document.createElement('div');
      row.className = 'visited-row';
      row.innerHTML = `
        <div class="visited-row-info">
          <span>🌍 ${country._name}</span>
        </div>
        <div class="visited-row-actions">
          <button class="mini-btn" title="Zum Land fliegen">🔍</button>
          <button class="mini-btn remove" title="Entfernen">✕</button>
        </div>
      `;
      const flyCountry = () => {
        state.focusedCountryName = country._name;
        renderFocusedCountryCities();
        const c = getFeatureCenter(country);
        flyTo(c.lat, c.lon, 16.5);
      };
      row.querySelector('.visited-row-info').addEventListener('click', flyCountry);
      row.querySelector('.mini-btn').addEventListener('click', flyCountry);
      row.querySelector('.remove').addEventListener('click', () => toggleCountryVisited(country._id));
      countriesListEl.appendChild(row);
    }
  }
}

// Settings bindings
const tileStyleSelect = document.getElementById('tile-style-select');
const toggleArcs = document.getElementById('toggle-arcs');
const toggleLabels = document.getElementById('toggle-labels');
const toggleClouds = document.getElementById('toggle-clouds');
const toggleSpace = document.getElementById('toggle-space');
const toggleAutoRotate = document.getElementById('toggle-autorotate');

function applySettings() {
  globe.showArcs = state.settings.arcs;
  globe.showClouds = state.settings.clouds;
  spaceEnv.setVisible(state.settings.space);
  controls.autoRotate = state.settings.autoRotate;
  controls.autoRotateSpeed = 0.55;

  toggleArcs.checked = state.settings.arcs;
  toggleLabels.checked = state.settings.labels;
  toggleClouds.checked = state.settings.clouds;
  toggleSpace.checked = state.settings.space;
  toggleAutoRotate.checked = state.settings.autoRotate;

  if (!state.settings.labels) {
    labelsLayer.innerHTML = '';
    labelPool.clear();
  }
}

tileStyleSelect.addEventListener('change', () => {
  globe.tileLayer.setStyle(tileStyleSelect.value);
});

toggleArcs.addEventListener('change', () => {
  state.settings.arcs = toggleArcs.checked;
  saveState();
  applySettings();
});
toggleLabels.addEventListener('change', () => {
  state.settings.labels = toggleLabels.checked;
  saveState();
  applySettings();
});
toggleClouds.addEventListener('change', () => {
  state.settings.clouds = toggleClouds.checked;
  saveState();
  applySettings();
});
toggleSpace.addEventListener('change', () => {
  state.settings.space = toggleSpace.checked;
  saveState();
  applySettings();
});
toggleAutoRotate.addEventListener('change', () => {
  state.settings.autoRotate = toggleAutoRotate.checked;
  saveState();
  applySettings();
});

document.getElementById('btn-fly-sun').addEventListener('click', () => {
  flyTo(currentSunPoint.lat, currentSunPoint.lon, 20.0);
});

document.getElementById('btn-reset-camera').addEventListener('click', () => {
  flyAnim = {
    startPos: camera.position.clone(),
    endPos: new THREE.Vector3(0, 8, 28),
    progress: 0
  };
});

// Export / Import / Clear
document.getElementById('btn-export').addEventListener('click', () => {
  const dataStr = JSON.stringify({
    visitedCountries: [...state.visitedCountries],
    visitedCities: [...state.visitedCities],
    customCities: state.customCities,
    homeBaseId: state.homeBaseId
  }, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'world-map-reiseziele.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (Array.isArray(data.visitedCountries)) state.visitedCountries = new Set(data.visitedCountries);
    if (Array.isArray(data.visitedCities)) state.visitedCities = new Set(data.visitedCities);
    if (Array.isArray(data.customCities)) state.customCities = data.customCities;
    if (data.homeBaseId) state.homeBaseId = data.homeBaseId;
    saveState();
    refreshAll();
  } catch (err) {
    alert('Ungültige JSON-Datei.');
  }
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('Wirklich alle besuchten Länder und Städte löschen?')) return;
  state.visitedCountries.clear();
  state.visitedCities.clear();
  state.customCities = [];
  saveState();
  refreshAll();
});

function updateStats() {
  const totalCountries = globe.countries.length || 177;
  const visitedCount = state.visitedCountries.size;
  statCountries.textContent = visitedCount;
  statCities.textContent = state.visitedCities.size;
  statPercent.textContent = `${Math.round((visitedCount / totalCountries) * 100)}%`;
}

function refreshAll() {
  globe.setVisitedCountries(state.visitedCountries);
  globe.syncCities(getAllCities(), state.visitedCities, state.homeBaseId);
  updateStats();
  renderFocusedCountryCities();
  renderVisitedLists();
  renderSearchResults();
}

// Lightweight pooled city labels overlay
const labelsLayer = document.getElementById('city-labels-layer');
const labelPool = new Map();
const _tmpVec = new THREE.Vector3();
const _camNorm = new THREE.Vector3();
const _cityNorm = new THREE.Vector3();

function updateCityLabels() {
  if (!state.settings.labels) return;

  const camDist = camera.position.length();
  const isZoomedIn = camDist < 19.5;
  _camNorm.copy(camera.position).normalize();

  const w = window.innerWidth;
  const h = window.innerHeight;
  const cities = getAllCities();

  let shownCount = 0;
  const maxLabels = isZoomedIn ? 14 : 6;
  const placedBoxes = [];
  const sidebarOpen = !sidebar.classList.contains('collapsed');

  // Sort so visited, home & capital cities get priority
  const sortedCities = [...cities].sort((a, b) => {
    const aPrio = (a.id === state.homeBaseId ? 4 : 0) + (state.visitedCities.has(a.id) ? 2 : 0) + (a.isCapital ? 1 : 0);
    const bPrio = (b.id === state.homeBaseId ? 4 : 0) + (state.visitedCities.has(b.id) ? 2 : 0) + (b.isCapital ? 1 : 0);
    return bPrio - aPrio;
  });

  for (const city of sortedCities) {
    const isVisited = state.visitedCities.has(city.id);
    const isHome = city.id === state.homeBaseId;
    const shouldConsider = isVisited || isHome || isZoomedIn;

    let el = labelPool.get(city.id);

    if (!shouldConsider || shownCount >= maxLabels) {
      if (el) el.style.display = 'none';
      continue;
    }

    _tmpVec.copy(latLonToVector3(city.lat, city.lon, GLOBE_RADIUS + 0.05));
    _cityNorm.copy(_tmpVec).normalize();

    if (_cityNorm.dot(_camNorm) < 0.28) {
      if (el) el.style.display = 'none';
      continue;
    }

    if (!isVisited && _tmpVec.distanceTo(camera.position) > camDist * 0.95) {
      if (el) el.style.display = 'none';
      continue;
    }

    _tmpVec.project(camera);
    if (_tmpVec.z > 1) {
      if (el) el.style.display = 'none';
      continue;
    }

    const x = (_tmpVec.x * 0.5 + 0.5) * w;
    const y = (-_tmpVec.y * 0.5 + 0.5) * h;

    if (x < (sidebarOpen && w > 768 ? 360 : 20) || x > w - 20 || y < 80 || y > h - 45) {
      if (el) el.style.display = 'none';
      continue;
    }

    // Generous 2D collision avoidance so labels stay sparse & never cover the map
    const estW = city.name.length * 7.2 + 34;
    const estH = 34;
    const overlaps = placedBoxes.some(
      (b) => Math.abs(b.x - x) < (b.w + estW) * 0.5 && Math.abs(b.y - y) < (b.h + estH) * 0.5
    );
    if (overlaps) {
      if (el) el.style.display = 'none';
      continue;
    }
    placedBoxes.push({ x, y, w: estW, h: estH });

    if (!el) {
      el = document.createElement('div');
      el.className = 'city-label';
      el.textContent = city.name;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCityVisited(city.id);
      });
      labelsLayer.appendChild(el);
      labelPool.set(city.id, el);
    }

    el.className = `city-label${city.isCapital ? ' capital' : ''}${isVisited ? ' visited' : ''}${isHome ? ' home' : ''}`;
    el.style.display = 'block';
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
    shownCount++;
  }

  // Also show up to 3 nearby peak labels (highest elevation + m ü. M.) when zoomed in
  let peakShown = 0;
  for (const peak of COUNTRY_PEAKS) {
    let el = labelPool.get(peak.id);
    if (!isZoomedIn || peakShown >= 3) {
      if (el) el.style.display = 'none';
      continue;
    }

    _tmpVec.copy(latLonToVector3(peak.lat, peak.lon, GLOBE_RADIUS + 0.08));
    _cityNorm.copy(_tmpVec).normalize();
    if (_cityNorm.dot(_camNorm) < 0.35 || _tmpVec.distanceTo(camera.position) > camDist * 0.9) {
      if (el) el.style.display = 'none';
      continue;
    }

    _tmpVec.project(camera);
    if (_tmpVec.z > 1) {
      if (el) el.style.display = 'none';
      continue;
    }

    const x = (_tmpVec.x * 0.5 + 0.5) * w;
    const y = (-_tmpVec.y * 0.5 + 0.5) * h;
    if (x < (sidebarOpen && w > 768 ? 360 : 20) || x > w - 20 || y < 80 || y > h - 45) {
      if (el) el.style.display = 'none';
      continue;
    }

    const labelText = `⛰ ${peak.name} (${peak.elevation.toLocaleString('de-CH')} m ü. M.)`;
    const estW = labelText.length * 6.8 + 16;
    const estH = 22;
    const overlaps = placedBoxes.some(
      (b) => Math.abs(b.x - x) < (b.w + estW) * 0.5 && Math.abs(b.y - y) < (b.h + estH) * 0.5
    );
    if (overlaps) {
      if (el) el.style.display = 'none';
      continue;
    }
    placedBoxes.push({ x, y, w: estW, h: estH });

    if (!el) {
      el = document.createElement('div');
      el.className = 'city-label peak';
      el.textContent = labelText;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        flyTo(peak.lat, peak.lon, 13.5);
      });
      labelsLayer.appendChild(el);
      labelPool.set(peak.id, el);
    }

    el.style.display = 'block';
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
    shownCount++;
    peakShown++;
  }

  // Live Sun Marker Label
  let sunEl = labelPool.get('__sun__');
  _tmpVec.copy(latLonToVector3(currentSunPoint.lat, currentSunPoint.lon, GLOBE_RADIUS + 0.08));
  _cityNorm.copy(_tmpVec).normalize();
  if (_cityNorm.dot(_camNorm) > 0.15) {
    _tmpVec.project(camera);
    const sx = (_tmpVec.x * 0.5 + 0.5) * w;
    const sy = (-_tmpVec.y * 0.5 + 0.5) * h;
    if (_tmpVec.z <= 1 && sx > 20 && sx < w - 20 && sy > 70 && sy < h - 40) {
      if (!sunEl) {
        sunEl = document.createElement('div');
        sunEl.className = 'city-label sun';
        sunEl.textContent = '☀️ Sonne (Live)';
        sunEl.addEventListener('click', (e) => {
          e.stopPropagation();
          flyTo(currentSunPoint.lat, currentSunPoint.lon, 18.0);
        });
        labelsLayer.appendChild(sunEl);
        labelPool.set('__sun__', sunEl);
      }
      sunEl.style.display = 'block';
      sunEl.style.left = `${sx.toFixed(1)}px`;
      sunEl.style.top = `${sy.toFixed(1)}px`;
    } else if (sunEl) {
      sunEl.style.display = 'none';
    }
  } else if (sunEl) {
    sunEl.style.display = 'none';
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let lastSunSync = 0;
function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  if (elapsed - lastSunSync > 15) {
    updateRealTimeSun();
    lastSunSync = elapsed;
  }

  // Slower, calm & ultra-precise movement scaled by altitude
  const alt = Math.max(0.05, camera.position.length() - GLOBE_RADIUS);
  controls.rotateSpeed = THREE.MathUtils.clamp(alt * 0.036, 0.008, 0.26);
  controls.zoomSpeed = THREE.MathUtils.clamp(alt * 0.08, 0.08, 0.45);

  if (flyAnim) {
    flyAnim.progress += 0.04;
    const t = Math.min(1, flyAnim.progress);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(flyAnim.startPos, flyAnim.endPos, ease);
    const targetLen = THREE.MathUtils.lerp(flyAnim.startPos.length(), flyAnim.endPos.length(), ease);
    camera.position.normalize().multiplyScalar(targetLen);
    if (t >= 1) flyAnim = null;
  }

  controls.update();
  spaceEnv.update(elapsed);
  globe.update(elapsed, camera.position);
  updateCityLabels();

  renderer.render(scene, camera);
}

async function init() {
  loadState();
  applySettings();
  updateRealTimeSun();
  await globe.loadCountries();
  globe.syncPeaks(COUNTRY_PEAKS);

  if (!localStorage.getItem(STORAGE_KEY)) {
    const germany = globe.countries.find((c) => c._name === 'Germany');
    if (germany) state.visitedCountries.add(germany._id);
    saveState();
  }

  refreshAll();
  animate();
}

init();
