import * as THREE from 'three';
import * as topojson from 'topojson-client';
import { GlobeTileLayer } from './tiles.js';

export const GLOBE_RADIUS = 10;

export function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function computeFeatureBBox(feature) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(lon, lat, feature) {
  const b = feature._bbox;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) {
    return false;
  }
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    if (pointInRing(lon, lat, poly[0])) {
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

export function getFeatureCenter(feature) {
  const b = feature._bbox;
  return {
    lat: (b.minLat + b.maxLat) / 2,
    lon: (b.minLon + b.maxLon) / 2
  };
}

export class WorldGlobe {
  constructor(scene, maxAnisotropy = 16) {
    this.scene = scene;
    this.maxAnisotropy = maxAnisotropy;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.countries = [];
    this.visitedCountries = new Set();

    this.cityBeacons = null;
    this.peakMarkers = null;
    this.borderLines = null;
    this.markerRings = [];
    this.arcsGroup = new THREE.Group();
    this.ringsGroup = new THREE.Group();

    this.group.add(this.ringsGroup);
    this.group.add(this.arcsGroup);

    this.showArcs = true;
    this.showClouds = true;
    this.arcAnimations = [];

    this._initTextures();
    this._initSphere();
    this.tileLayer = new GlobeTileLayer(this.group, this.maxAnisotropy);
    this._initClouds();
    this._initAtmosphere();
    this._initSunMarker();
  }

  _initTextures() {
    // 8K sharp color map
    this.texWidth = 8192;
    this.texHeight = 4096;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.texWidth;
    this.canvas.height = this.texHeight;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(16, this.maxAnisotropy);
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // 4K roughness & bump maps
    this.mapW = 4096;
    this.mapH = 2048;
    this.roughCanvas = document.createElement('canvas');
    this.roughCanvas.width = this.mapW;
    this.roughCanvas.height = this.mapH;
    this.roughCtx = this.roughCanvas.getContext('2d');
    this.roughTexture = new THREE.CanvasTexture(this.roughCanvas);
    this.roughTexture.anisotropy = Math.min(16, this.maxAnisotropy);

    this.bumpCanvas = document.createElement('canvas');
    this.bumpCanvas.width = this.mapW;
    this.bumpCanvas.height = this.mapH;
    this.bumpCtx = this.bumpCanvas.getContext('2d');
    this.bumpTexture = new THREE.CanvasTexture(this.bumpCanvas);
    this.bumpTexture.anisotropy = Math.min(16, this.maxAnisotropy);

    // Night population lights map (emissive)
    this.nightCanvas = document.createElement('canvas');
    this.nightCanvas.width = this.mapW;
    this.nightCanvas.height = this.mapH;
    this.nightCtx = this.nightCanvas.getContext('2d');
    this.nightTexture = new THREE.CanvasTexture(this.nightCanvas);
    this.nightTexture.colorSpace = THREE.SRGBColorSpace;
    this.nightTexture.anisotropy = Math.min(16, this.maxAnisotropy);
  }

  _initSphere() {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 96);
    const mat = new THREE.MeshPhysicalMaterial({
      map: this.texture,
      roughnessMap: this.roughTexture,
      bumpMap: this.bumpTexture,
      bumpScale: 0.014,
      emissive: new THREE.Color('#ffbe59'),
      emissiveMap: this.nightTexture,
      emissiveIntensity: 1.45,
      roughness: 1.0,
      metalness: 0.16,
      clearcoat: 0.88,
      clearcoatRoughness: 0.11,
      reflectivity: 0.95
    });
    this.sphereMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.sphereMesh);
  }

  _initClouds() {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = 1024;
    cCanvas.height = 512;
    const cCtx = cCanvas.getContext('2d');
    cCtx.clearRect(0, 0, 1024, 512);

    for (let i = 0; i < 180; i++) {
      const x = Math.random() * 1024;
      const y = 30 + Math.random() * 452;
      const rx = 18 + Math.random() * 70;
      const ry = 4 + Math.random() * 14;
      const grad = cCtx.createRadialGradient(x, y, 0, x, y, rx);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
      grad.addColorStop(0.5, 'rgba(220, 238, 255, 0.08)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      cCtx.fillStyle = grad;
      cCtx.beginPath();
      cCtx.ellipse(x, y, rx, ry, (Math.random() - 0.5) * 0.3, 0, Math.PI * 2);
      cCtx.fill();
    }

    const cloudTex = new THREE.CanvasTexture(cCanvas);
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    const cloudGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 64, 48);
    this.cloudMat = new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      roughness: 0.9
    });
    this.cloudsMesh = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.group.add(this.cloudsMesh);
  }

  _initAtmosphere() {
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 64, 48);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
          gl_FragColor = vec4(0.32, 0.78, 1.0, 1.0) * intensity * 0.85;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    const atmos = new THREE.Mesh(atmosGeo, atmosMat);
    this.group.add(atmos);
  }

  _initSunMarker() {
    this.sunMarkerGroup = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 32),
      new THREE.MeshBasicMaterial({ color: '#ffe875', side: THREE.DoubleSide })
    );
    core.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.19, 0.25, 36),
      new THREE.MeshBasicMaterial({
        color: '#ffb732',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      })
    );
    ring.rotation.x = -Math.PI / 2;
    this.sunMarkerGroup.add(core, ring);
    this.group.add(this.sunMarkerGroup);
  }

  setSubsolarPoint(lat, lon) {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS + 0.035);
    this.sunMarkerGroup.position.copy(pos);
    const normal = pos.clone().normalize();
    this.sunMarkerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  }

  async loadCountries() {
    const res = await fetch('data/countries-50m.json');
    const world = await res.json();
    const geojson = topojson.feature(world, world.objects.countries);

    this.countries = geojson.features
      .filter((f) => f.geometry && f.properties && f.properties.name)
      .map((f) => {
        f._id = String(f.id ?? f.properties.name);
        f._name = f.properties.name;
        f._bbox = computeFeatureBBox(f);
        return f;
      });

    this._buildVectorBorders();
    this.redrawTextures();
    return this.countries;
  }

  _buildVectorBorders() {
    if (this.borderLines) {
      this.group.remove(this.borderLines);
      this.borderLines.geometry.dispose();
      this.borderLines.material.dispose();
    }

    const positions = [];
    const r = GLOBE_RADIUS + 0.008;

    for (const feature of this.countries) {
      const geom = feature.geometry;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 0; i < ring.length - 1; i++) {
            const [lon1, lat1] = ring[i];
            const [lon2, lat2] = ring[i + 1];
            if (Math.abs(lon2 - lon1) > 180) continue;
            const p1 = latLonToVector3(lat1, lon1, r);
            const p2 = latLonToVector3(lat2, lon2, r);
            positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#050608',
      transparent: true,
      opacity: 0.92
    });
    this.borderLines = new THREE.LineSegments(geo, mat);
    this.group.add(this.borderLines);
  }

  _traceFeaturePath(ctx, feature, w, h) {
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    ctx.beginPath();
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [lon, lat] = ring[i];
          const x = ((lon + 180) / 360) * w;
          const y = ((90 - lat) / 180) * h;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevLon = ring[i - 1][0];
            if (Math.abs(lon - prevLon) > 180) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
      }
    }
  }

  redrawTextures() {
    const { ctx, texWidth: w, texHeight: h } = this;
    const { roughCtx, bumpCtx, mapW, mapH } = this;

    // 1. Deep glossy sapphire ocean gradient
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, h);
    oceanGrad.addColorStop(0, '#0d2b52');
    oceanGrad.addColorStop(0.5, '#154278');
    oceanGrad.addColorStop(1, '#0d2b52');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle ocean grid
    ctx.strokeStyle = 'rgba(110, 190, 255, 0.045)';
    ctx.lineWidth = 1.5;
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = ((lon + 180) / 360) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    roughCtx.fillStyle = '#242424';
    roughCtx.fillRect(0, 0, mapW, mapH);

    bumpCtx.fillStyle = '#181818';
    bumpCtx.fillRect(0, 0, mapW, mapH);

    // 2. Countries with crisp black borders
    for (const feature of this.countries) {
      const isVisited = this.visitedCountries.has(feature._id);

      this._traceFeaturePath(ctx, feature, w, h);
      if (isVisited) {
        ctx.fillStyle = '#e8b642';
      } else {
        ctx.fillStyle = '#3c546b';
      }
      ctx.strokeStyle = '#07080b';
      ctx.lineWidth = 1.6;
      ctx.fill();
      ctx.stroke();

      this._traceFeaturePath(roughCtx, feature, mapW, mapH);
      roughCtx.fillStyle = isVisited ? '#2e2e2e' : '#646464';
      roughCtx.fill();

      this._traceFeaturePath(bumpCtx, feature, mapW, mapH);
      bumpCtx.fillStyle = isVisited ? '#b0b0b0' : '#808080';
      bumpCtx.fill();
    }

    this.texture.needsUpdate = true;
    this.roughTexture.needsUpdate = true;
    this.bumpTexture.needsUpdate = true;
  }

  findCountryAt(lat, lon) {
    for (const f of this.countries) {
      if (pointInFeature(lon, lat, f)) return f;
    }
    return null;
  }

  setVisitedCountries(ids) {
    this.visitedCountries = new Set(ids);
    this.redrawTextures();
  }

  syncCities(allCities, visitedCityIds, homeBaseId) {
    if (this.cityBeacons) {
      this.group.remove(this.cityBeacons);
      this.cityBeacons.geometry.dispose();
      this.cityBeacons.material.dispose();
    }

    // Sleek, flat circular pinpoints flush on the globe surface
    const beaconGeo = new THREE.CircleGeometry(0.026, 24);
    beaconGeo.rotateX(-Math.PI / 2);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      side: THREE.DoubleSide
    });

    this.cityBeacons = new THREE.InstancedMesh(beaconGeo, beaconMat, allCities.length);
    this.cityBasePositions = [];
    this.cityBaseScales = [];

    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const colorCapital = new THREE.Color('#ff3b4e');
    const colorVisited = new THREE.Color('#ffd369');
    const colorHome = new THREE.Color('#48d1ff');
    const colorDefault = new THREE.Color('#e6f2ff');

    allCities.forEach((city, idx) => {
      const isVisited = visitedCityIds.has(city.id);
      const isHome = city.id === homeBaseId;
      const isCap = Boolean(city.isCapital);
      const pos = latLonToVector3(city.lat, city.lon, GLOBE_RADIUS + 0.013);
      const normal = pos.clone().normalize();
      const baseScale = isCap ? 1.4 : isHome ? 1.5 : isVisited ? 1.25 : 0.8;

      this.cityBasePositions.push({ pos, normal });
      this.cityBaseScales.push(baseScale);

      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(up, normal);
      dummy.scale.setScalar(baseScale);
      dummy.updateMatrix();
      this.cityBeacons.setMatrixAt(idx, dummy.matrix);

      const col = isCap ? colorCapital : isHome ? colorHome : isVisited ? colorVisited : colorDefault;
      this.cityBeacons.setColorAt(idx, col);
    });

    this.cityBeacons.instanceMatrix.needsUpdate = true;
    if (this.cityBeacons.instanceColor) this.cityBeacons.instanceColor.needsUpdate = true;
    this.group.add(this.cityBeacons);

    this._buildNightLights(allCities);

    // Pulsing target rings for visited cities
    while (this.ringsGroup.children.length) {
      this.ringsGroup.remove(this.ringsGroup.children[0]);
    }
    this.markerRings = [];

    for (const city of allCities) {
      if (visitedCityIds.has(city.id)) {
        this._createPulsingRings(city.lat, city.lon, city.id === homeBaseId, Boolean(city.isCapital));
      }
    }

    this._rebuildArcs(allCities, visitedCityIds, homeBaseId);
  }

  _buildNightLights(allCities) {
    const { nightCtx: ctx, mapW: w, mapH: h } = this;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Paint warm golden population light clusters around all cities
    for (const city of allCities) {
      const cx = ((city.lon + 180) / 360) * w;
      const cy = ((90 - city.lat) / 180) * h;

      // Main metro glow
      const r = city.isCapital ? 15 : 10;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(255, 225, 150, 0.92)');
      grad.addColorStop(0.3, 'rgba(255, 185, 85, 0.48)');
      grad.addColorStop(0.7, 'rgba(255, 145, 45, 0.14)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Deterministic surrounding town/suburb scatter for realistic population belts
      let seed = (Math.abs(Math.round(city.lat * 100 + city.lon * 37)) % 997) + 1;
      for (let s = 0; s < 10; s++) {
        seed = (seed * 16807) % 2147483647;
        const angle = (seed / 2147483647) * Math.PI * 2;
        seed = (seed * 16807) % 2147483647;
        const dist = 4 + (seed / 2147483647) * 16;
        const sx = cx + Math.cos(angle) * dist;
        const sy = cy + Math.sin(angle) * dist * 0.7;
        ctx.fillStyle = 'rgba(255, 200, 110, 0.55)';
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
    }

    this.nightTexture.needsUpdate = true;
  }

  syncPeaks(peaks) {
    if (this.peakMarkers) {
      this.group.remove(this.peakMarkers);
      this.peakMarkers.geometry.dispose();
      this.peakMarkers.material.dispose();
    }

    // Sleek, flat minimal alpine triangle flush on the surface
    const triGeo = new THREE.CircleGeometry(0.03, 3);
    triGeo.rotateX(-Math.PI / 2);
    const triMat = new THREE.MeshBasicMaterial({
      color: '#a8ffea',
      side: THREE.DoubleSide
    });

    this.peakMarkers = new THREE.InstancedMesh(triGeo, triMat, peaks.length);
    this.peakBasePositions = [];
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);

    peaks.forEach((peak, idx) => {
      const pos = latLonToVector3(peak.lat, peak.lon, GLOBE_RADIUS + 0.013);
      const normal = pos.clone().normalize();
      this.peakBasePositions.push({ pos, normal });

      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(up, normal);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.peakMarkers.setMatrixAt(idx, dummy.matrix);
    });

    this.peakMarkers.instanceMatrix.needsUpdate = true;
    this.group.add(this.peakMarkers);
  }

  _createPulsingRings(lat, lon, isHome, isCapital) {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS + 0.028);
    const normal = pos.clone().normalize();
    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);
    ringGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    const color = isCapital ? '#ff3b4e' : isHome ? '#48d1ff' : '#ffd369';
    for (let i = 0; i < 2; i++) {
      const ringGeo = new THREE.RingGeometry(0.11, 0.145, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ringGroup.add(ring);
      this.markerRings.push({ mesh: ring, mat: ringMat, phase: i * 0.5 });
    }
    this.ringsGroup.add(ringGroup);
  }

  _rebuildArcs(allCities, visitedCityIds, homeBaseId) {
    while (this.arcsGroup.children.length) {
      this.arcsGroup.remove(this.arcsGroup.children[0]);
    }
    this.arcAnimations = [];

    const homeCity = allCities.find((c) => c.id === homeBaseId);
    if (!homeCity) return;

    const startVec = latLonToVector3(homeCity.lat, homeCity.lon, GLOBE_RADIUS);

    for (const city of allCities) {
      if (!visitedCityIds.has(city.id) || city.id === homeBaseId) continue;

      const endVec = latLonToVector3(city.lat, city.lon, GLOBE_RADIUS);
      const dist = startVec.distanceTo(endVec);
      const midVec = startVec.clone().add(endVec).multiplyScalar(0.5);
      const arcHeight = GLOBE_RADIUS + Math.min(4.8, dist * 0.34);
      midVec.normalize().multiplyScalar(arcHeight);

      const curve = new THREE.QuadraticBezierCurve3(startVec, midVec, endVec);
      const points = curve.getPoints(56);
      const geo = new THREE.BufferGeometry().setFromPoints(points);

      const mat = new THREE.LineBasicMaterial({
        color: '#6ce0ff',
        transparent: true,
        opacity: 0.62
      });
      const line = new THREE.Line(geo, mat);
      this.arcsGroup.add(line);

      const pulseMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 10, 10),
        new THREE.MeshBasicMaterial({ color: '#ffffff' })
      );
      this.arcsGroup.add(pulseMesh);
      this.arcAnimations.push({
        curve,
        pulseMesh,
        speed: 0.22 + Math.random() * 0.14,
        offset: Math.random()
      });
    }
  }

  update(elapsed, cameraPosition) {
    // Stream Google-Maps-style high-res tiles when zoomed in!
    this.tileLayer.update(cameraPosition, performance.now());

    // Scale markers smoothly with altitude so they stay sleek & delicate at close zoom
    const camDist = cameraPosition.length();
    const alt = Math.max(0.04, camDist - GLOBE_RADIUS);
    const markerZoomScale = THREE.MathUtils.clamp(alt / 5.0, 0.18, 1.0);

    if (this.cityBeacons && this.cityBasePositions) {
      const dummy = new THREE.Object3D();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < this.cityBasePositions.length; i++) {
        const { pos, normal } = this.cityBasePositions[i];
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up, normal);
        dummy.scale.setScalar(this.cityBaseScales[i] * markerZoomScale);
        dummy.updateMatrix();
        this.cityBeacons.setMatrixAt(i, dummy.matrix);
      }
      this.cityBeacons.instanceMatrix.needsUpdate = true;
    }

    if (this.peakMarkers && this.peakBasePositions) {
      const dummy = new THREE.Object3D();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < this.peakBasePositions.length; i++) {
        const { pos, normal } = this.peakBasePositions[i];
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up, normal);
        dummy.scale.setScalar(markerZoomScale);
        dummy.updateMatrix();
        this.peakMarkers.setMatrixAt(i, dummy.matrix);
      }
      this.peakMarkers.instanceMatrix.needsUpdate = true;
    }

    // Fade clouds out smoothly when zoomed in so surface stays razor sharp!
    const cloudFade = THREE.MathUtils.clamp((camDist - 16.5) / 6.0, 0, 1);
    this.cloudsMesh.visible = this.showClouds && cloudFade > 0.02;
    if (this.cloudsMesh.visible) {
      this.cloudMat.opacity = 0.42 * cloudFade;
      this.cloudsMesh.rotation.y = elapsed * 0.008;
    }

    for (const r of this.markerRings) {
      const t = (elapsed * 0.65 + r.phase) % 1;
      const scale = 1 + t * 2.2;
      r.mesh.scale.set(scale, 1, scale);
      r.mat.opacity = (1 - t) * 0.78;
    }

    this.arcsGroup.visible = this.showArcs;
    if (this.showArcs) {
      for (const a of this.arcAnimations) {
        const t = (elapsed * a.speed + a.offset) % 1;
        a.pulseMesh.position.copy(a.curve.getPoint(t));
      }
    }
  }
}
