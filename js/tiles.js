import * as THREE from 'three';
import { GLOBE_RADIUS, latLonToVector3 } from './globe.js';

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat, z) {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z));
}

function tileXToLon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function vector3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) * (180 / Math.PI);
  const lon = Math.atan2(n.z, -n.x) * (180 / Math.PI) - 180;
  let wrappedLon = lon;
  while (wrappedLon < -180) wrappedLon += 360;
  while (wrappedLon > 180) wrappedLon -= 360;
  return { lat, lon: wrappedLon };
}

function createCurvedTileGeometry(z, x, y, radius, segs = 8) {
  const lonLeft = tileXToLon(x, z);
  const lonRight = tileXToLon(x + 1, z);

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let iy = 0; iy <= segs; iy++) {
    const ty = y + iy / segs;
    const lat = tileYToLat(ty, z);
    const v = 1 - iy / segs;

    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const lon = lonLeft + u * (lonRight - lonLeft);
      const pos = latLonToVector3(lat, lon, radius);
      const norm = pos.clone().normalize();
      positions.push(pos.x, pos.y, pos.z);
      normals.push(norm.x, norm.y, norm.z);
      uvs.push(u, v);
    }
  }

  for (let iy = 0; iy < segs; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * (segs + 1) + ix;
      const b = a + 1;
      const c = a + (segs + 1);
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export class GlobeTileLayer {
  constructor(parentGroup, maxAnisotropy = 16) {
    this.group = new THREE.Group();
    parentGroup.add(this.group);

    this.maxAnisotropy = Math.min(16, maxAnisotropy);
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');

    this.style = 'satellite'; // 'satellite' | 'streets'
    this.tiles = new Map(); // key -> { mesh, lastUsed, z }
    this.loading = new Set();
    this.maxCache = 140;
    this.lastUpdateKey = '';
  }

  setStyle(style) {
    if (this.style === style) return;
    this.style = style;
    this.clearAll();
    this.lastUpdateKey = '';
  }

  clearAll() {
    for (const entry of this.tiles.values()) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      if (entry.mesh.material.map) entry.mesh.material.map.dispose();
      entry.mesh.material.dispose();
    }
    this.tiles.clear();
    this.loading.clear();
  }

  _getTileUrl(z, x, y) {
    if (this.style === 'streets') {
      return `https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}@2x.png`;
    }
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }

  _getZoomForAltitude(alt) {
    if (alt > 7.5) return 0; // Use base 8K globe when zoomed out
    if (alt > 4.2) return 4;
    if (alt > 2.2) return 5;
    if (alt > 1.1) return 6;
    if (alt > 0.55) return 7;
    if (alt > 0.28) return 8;
    if (alt > 0.14) return 9;
    if (alt > 0.07) return 10;
    return 11;
  }

  update(cameraPosition, nowMs) {
    const camDist = cameraPosition.length();
    const alt = camDist - GLOBE_RADIUS;
    const z = this._getZoomForAltitude(alt);

    if (z === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const center = vector3ToLatLon(cameraPosition);
    const cx = lonToTileX(center.lon, z);
    const cy = latToTileY(center.lat, z);
    const keyState = `${this.style}_${z}_${cx}_${cy}`;

    // Hide tiles from other zoom levels once current zoom is active, or keep as fallback
    const n = Math.pow(2, z);
    const radiusTiles = z <= 5 ? 2 : 2; // 5x5 grid around camera center = 25 crisp tiles

    const wantedKeys = new Set();
    for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
      const ty = cy + dy;
      if (ty < 0 || ty >= n) continue;
      for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
        const tx = ((cx + dx) % n + n) % n;
        const key = `${this.style}_${z}_${tx}_${ty}`;
        wantedKeys.add(key);

        const existing = this.tiles.get(key);
        if (existing) {
          existing.lastUsed = nowMs;
          existing.mesh.visible = true;
        } else if (!this.loading.has(key) && keyState !== this.lastUpdateKey || !existing && !this.loading.has(key)) {
          this._loadTile(key, z, tx, ty, nowMs);
        }
      }
    }
    this.lastUpdateKey = keyState;

    // Show only wanted tiles (plus keep lower-z fallback visible if needed)
    for (const [k, entry] of this.tiles.entries()) {
      entry.mesh.visible = wantedKeys.has(k);
    }

    // Evict oldest tiles if cache exceeds maxCache
    if (this.tiles.size > this.maxCache) {
      const sorted = [...this.tiles.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const toRemove = sorted.length - this.maxCache;
      for (let i = 0; i < toRemove; i++) {
        const [k, entry] = sorted[i];
        this.group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        if (entry.mesh.material.map) entry.mesh.material.map.dispose();
        entry.mesh.material.dispose();
        this.tiles.delete(k);
      }
    }
  }

  _loadTile(key, z, x, y, nowMs) {
    this.loading.add(key);
    const url = this._getTileUrl(z, x, y);
    this.loader.load(
      url,
      (tex) => {
        this.loading.delete(key);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.maxAnisotropy;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const geo = createCurvedTileGeometry(z, x, y, GLOBE_RADIUS + 0.002, 8);
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.55,
          metalness: 0.05,
          transparent: true,
          opacity: 0.92
        });
        const mesh = new THREE.Mesh(geo, mat);
        this.group.add(mesh);
        this.tiles.set(key, { mesh, lastUsed: nowMs, z });
      },
      undefined,
      () => {
        this.loading.delete(key);
      }
    );
  }
}
