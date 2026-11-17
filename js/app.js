import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FEATURED_CITIES } from './cities.js';
import { createSpaceEnvironment } from './space.js';
import { WorldGlobe, GLOBE_RADIUS, getFeatureCenter } from './globe.js';
import { latLonToVector3 } from './skyline.js';

const STORAGE_KEY = 'world_map_3d_state_v1';

// State
const state = {
  visitedCountries: new Set(),
  visitedCities: new Set(['berlin']),
  customCities: [],
  homeBaseId: 'berlin',
  mode: 'country', // 'country' | 'pin'
  settings: {
    arcs: true,
    skylines: true,
    space: true,
    autoRotate: false
  }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.visitedCountries)) {
      state.visitedCountries = new Set(data.visitedCountries);
    }
    if (Array.isArray(data.visitedCities)) {
      state.visitedCities = new Set(data.visitedCities);
    }
    if (Array.isArray(data.customCities)) {
      state.customCities = data.customCities;
    }
    if (data.homeBaseId) {
      state.homeBaseId = data.homeBaseId;
    }
    if (data.settings) {
      Object.assign(state.settings, data.settings);
    }
  } catch (err) {
    console.warn('Could not load saved state:', err);
  }
}

function saveState() {
  const payload = {
    visitedCountries: [...state.visitedCountries],
    visitedCities: [...state.visitedCities],
    customCities: state.customCities,
    homeBaseId: state.homeBaseId,
    settings: state.settings
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getAllCities() {
  return [...FEATURED_CITIES, ...state.customCities];
}

// Scene setup
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04070e');

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 8, 28);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.minDistance = 12.1;
controls.maxDistance = 68;

// Lighting
const ambientLight = new THREE.AmbientLight('#a9bcd9', 1.35);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight('#fff2d6', 2.2);
sunLight.position.set(60, 30, 45);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight('#48d1ff', 0.75);
rimLight.position.set(-40, -20, -35);
scene.add(rimLight);

// Space & Globe
const spaceEnv = createSpaceEnvironment(scene);
const globe = new WorldGlobe(scene);

// Smooth Camera Fly-To animation
let flyAnim = null;
function flyTo(lat, lon, targetDist = 14.5) {
  const targetPos = latLonToVector3(lat, lon, targetDist);
  flyAnim = {
    startPos: camera.position.clone(),
    endPos: targetPos,
    progress: 0
  };
}

// Raycasting
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('globe-tooltip');
let pointerDownPos = { x: 0, y: 0 };
let pendingPinCoords = null;

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
  const coords = getHitLatLon(e.clientX, e.clientY);
  if (!coords) {
    globe.setHoveredCountry(null);
    tooltip.classList.add('hidden');
    return;
  }

  const country = globe.findCountryAt(coords.lat, coords.lon);
  if (country) {
    globe.setHoveredCountry(country._id);
    const visited = state.visitedCountries.has(country._id);
    tooltip.innerHTML = `<strong>${country._name}</strong> ${visited ? '✓ Besucht' : '• Klicken zum Markieren'}`;
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.classList.remove('hidden');
  } else {
    globe.setHoveredCountry(null);
    if (state.mode === 'pin') {
      tooltip.textContent = `📍 Pin setzen (${coords.lat.toFixed(1)}°, ${coords.lon.toFixed(1)}°)`;
      tooltip.style.left = `${e.clientX + 14}px`;
      tooltip.style.top = `${e.clientY + 14}px`;
      tooltip.classList.remove('hidden');
    } else {
      tooltip.classList.add('hidden');
    }
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  if (dist > 6 || e.button !== 0) return; // Ignore drags or right-clicks

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

  // Country toggle mode
  const country = globe.findCountryAt(coords.lat, coords.lon);
  if (country) {
    toggleCountryVisited(country._id);
  }
});

// UI Elements
const statCountries = document.getElementById('stat-countries');
const statCities = document.getElementById('stat-cities');
const statPercent = document.getElementById('stat-percent');
const skylineBanner = document.getElementById('skyline-banner');
const skylineBannerText = document.getElementById('skyline-banner-text');

const sidebar = document.getElementById('sidebar');
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// Tabs
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
    ? 'Klicke auf ein Land auf dem Globus, um es als „Besucht“ zu markieren. Zoome nah heran, um die 3D-Skylines der Städte zu sehen!'
    : 'Klicke auf eine beliebige Stelle auf dem Globus, um dort einen eigenen Ort mit 3D-Skyline zu speichern.';
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
    landmark: 'generic',
    isCustom: true
  };

  state.customCities.push(newCity);
  state.visitedCities.add(id);

  // Also mark the country if found
  const country = globe.findCountryAt(pendingPinCoords.lat, pendingPinCoords.lon);
  if (country) {
    state.visitedCountries.add(country._id);
  }

  pinModal.classList.add('hidden');
  saveState();
  refreshAll();
  flyTo(newCity.lat, newCity.lon, 13.6);
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
    .slice(0, 6);

  const countryMatches = globe.countries
    .filter((f) => f._name.toLowerCase().includes(q))
    .slice(0, 6);

  for (const city of cityMatches) {
    const visited = state.visitedCities.has(city.id);
    const el = document.createElement('div');
    el.className = 'search-item';
    el.innerHTML = `
      <span>🏙 ${city.name} <small style="color:#9aa3b2">(${city.country})</small></span>
      <span class="badge ${visited ? 'visited' : ''}">${visited ? 'Besucht' : 'Skyline'}</span>
    `;
    el.addEventListener('click', () => {
      if (!visited) toggleCityVisited(city.id);
      flyTo(city.lat, city.lon, 13.5);
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
      toggleCountryVisited(country._id);
      const center = getFeatureCenter(country);
      flyTo(center.lat, center.lon, 17.5);
    });
    searchResults.appendChild(el);
  }
}

searchInput.addEventListener('input', renderSearchResults);
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  renderSearchResults();
});

// Quick cities chips
const QUICK_CITY_IDS = ['paris', 'nyc', 'berlin', 'zurich', 'dubai', 'tokyo', 'sydney', 'cairo', 'london', 'singapore'];
function renderQuickCities() {
  const containerEl = document.getElementById('quick-cities');
  containerEl.innerHTML = '';
  for (const id of QUICK_CITY_IDS) {
    const city = FEATURED_CITIES.find((c) => c.id === id);
    if (!city) continue;
    const visited = state.visitedCities.has(city.id);
    const btn = document.createElement('button');
    btn.className = `chip-btn ${visited ? 'visited' : ''}`;
    btn.textContent = city.name;
    btn.title = `Zu ${city.name} fliegen & Skyline ansehen`;
    btn.addEventListener('click', () => {
      flyTo(city.lat, city.lon, 13.5);
    });
    containerEl.appendChild(btn);
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

  // Home Base select
  homeBaseSelect.innerHTML = '';
  for (const city of allCities) {
    const opt = document.createElement('option');
    opt.value = city.id;
    opt.textContent = `${city.name} (${city.country})`;
    if (city.id === state.homeBaseId) opt.selected = true;
    homeBaseSelect.appendChild(opt);
  }

  // Visited cities list
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
          <button class="mini-btn" title="Skyline ansehen">🔍</button>
          <button class="mini-btn remove" title="Entfernen">✕</button>
        </div>
      `;
      row.querySelector('.visited-row-info').addEventListener('click', () => flyTo(city.lat, city.lon, 13.5));
      row.querySelector('.mini-btn').addEventListener('click', () => flyTo(city.lat, city.lon, 13.5));
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

  // Visited countries list
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
        const c = getFeatureCenter(country);
        flyTo(c.lat, c.lon, 17.5);
      };
      row.querySelector('.visited-row-info').addEventListener('click', flyCountry);
      row.querySelector('.mini-btn').addEventListener('click', flyCountry);
      row.querySelector('.remove').addEventListener('click', () => toggleCountryVisited(country._id));
      countriesListEl.appendChild(row);
    }
  }
}

// Settings bindings
const toggleArcs = document.getElementById('toggle-arcs');
const toggleSkylines = document.getElementById('toggle-skylines');
const toggleSpace = document.getElementById('toggle-space');
const toggleAutoRotate = document.getElementById('toggle-autorotate');

function applySettings() {
  globe.showArcs = state.settings.arcs;
  globe.showSkylines = state.settings.skylines;
  spaceEnv.setVisible(state.settings.space);
  controls.autoRotate = state.settings.autoRotate;
  controls.autoRotateSpeed = 0.55;

  toggleArcs.checked = state.settings.arcs;
  toggleSkylines.checked = state.settings.skylines;
  toggleSpace.checked = state.settings.space;
  toggleAutoRotate.checked = state.settings.autoRotate;
}

toggleArcs.addEventListener('change', () => {
  state.settings.arcs = toggleArcs.checked;
  saveState();
  applySettings();
});
toggleSkylines.addEventListener('change', () => {
  state.settings.skylines = toggleSkylines.checked;
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
  renderQuickCities();
  renderVisitedLists();
  renderSearchResults();
}

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation Loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  if (flyAnim) {
    flyAnim.progress += 0.035;
    const t = Math.min(1, flyAnim.progress);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(flyAnim.startPos, flyAnim.endPos, ease);
    // Keep spherical distance smooth
    const targetLen = THREE.MathUtils.lerp(flyAnim.startPos.length(), flyAnim.endPos.length(), ease);
    camera.position.normalize().multiplyScalar(targetLen);
    if (t >= 1) flyAnim = null;
  }

  controls.update();
  spaceEnv.update(elapsed);

  const activeSkylineCity = globe.update(elapsed, camera.position);
  if (activeSkylineCity && state.settings.skylines) {
    skylineBannerText.textContent = `Skyline: ${activeSkylineCity.name} (${activeSkylineCity.country})`;
    skylineBanner.classList.remove('hidden');
  } else {
    skylineBanner.classList.add('hidden');
  }

  renderer.render(scene, camera);
}

// Bootstrap
async function init() {
  loadState();
  applySettings();
  await globe.loadCountries();

  // First-time default sample (Germany + Berlin as home base) if nothing was saved yet
  if (!localStorage.getItem(STORAGE_KEY)) {
    const germany = globe.countries.find((c) => c._name === 'Germany');
    if (germany) state.visitedCountries.add(germany._id);
    saveState();
  }

  refreshAll();
  animate();
}

init();
