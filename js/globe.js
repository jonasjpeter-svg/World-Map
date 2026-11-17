import * as THREE from 'three';
import * as topojson from 'topojson-client';

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
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.countries = [];
    this.visitedCountries = new Set();

    this.cityBeacons = null;
    this.cityDataList = [];
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
    this._initClouds();
    this._initAtmosphere();
  }

  _initTextures() {
    // High-res color map
    this.texWidth = 4096;
    this.texHeight = 2048;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.texWidth;
    this.canvas.height = this.texHeight;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    // Roughness & bump maps (for glossy oceans + tactile continents)
    this.mapW = 2048;
    this.mapH = 1024;
    this.roughCanvas = document.createElement('canvas');
    this.roughCanvas.width = this.mapW;
    this.roughCanvas.height = this.mapH;
    this.roughCtx = this.roughCanvas.getContext('2d');
    this.roughTexture = new THREE.CanvasTexture(this.roughCanvas);

    this.bumpCanvas = document.createElement('canvas');
    this.bumpCanvas.width = this.mapW;
    this.bumpCanvas.height = this.mapH;
    this.bumpCtx = this.bumpCanvas.getContext('2d');
    this.bumpTexture = new THREE.CanvasTexture(this.bumpCanvas);
  }

  _initSphere() {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 112, 80);
    const mat = new THREE.MeshPhysicalMaterial({
      map: this.texture,
      roughnessMap: this.roughTexture,
      bumpMap: this.bumpTexture,
      bumpScale: 0.055,
      roughness: 1.0,
      metalness: 0.16,
      clearcoat: 0.88,
      clearcoatRoughness: 0.12,
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

    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 1024;
      const y = 30 + Math.random() * 452;
      const rx = 18 + Math.random() * 75;
      const ry = 4 + Math.random() * 16;
      const grad = cCtx.createRadialGradient(x, y, 0, x, y, rx);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      grad.addColorStop(0.5, 'rgba(220, 238, 255, 0.09)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      cCtx.fillStyle = grad;
      cCtx.beginPath();
      cCtx.ellipse(x, y, rx, ry, (Math.random() - 0.5) * 0.3, 0, Math.PI * 2);
      cCtx.fill();
    }

    const cloudTex = new THREE.CanvasTexture(cCanvas);
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    const cloudGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 64, 48);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      roughness: 0.9
    });
    this.cloudsMesh = new THREE.Mesh(cloudGeo, cloudMat);
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

  async loadCountries() {
    const res = await fetch('data/countries-110m.json');
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

    this.redrawTextures();
    return this.countries;
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
    oceanGrad.addColorStop(0, '#07162b');
    oceanGrad.addColorStop(0.5, '#0b2242');
    oceanGrad.addColorStop(1, '#07162b');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle ocean grid
    ctx.strokeStyle = 'rgba(110, 190, 255, 0.05)';
    ctx.lineWidth = 1;
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

    // Roughness: oceans = very glossy (dark grey #242424 -> roughness ~0.14)
    roughCtx.fillStyle = '#242424';
    roughCtx.fillRect(0, 0, mapW, mapH);

    // Bump: oceans = flat (#181818)
    bumpCtx.fillStyle = '#181818';
    bumpCtx.fillRect(0, 0, mapW, mapH);

    // 2. Countries
    for (const feature of this.countries) {
      const isVisited = this.visitedCountries.has(feature._id);

      // Color map
      this._traceFeaturePath(ctx, feature, w, h);
      if (isVisited) {
        ctx.fillStyle = '#dba93b';
        ctx.strokeStyle = '#ffe594';
        ctx.lineWidth = 2.0;
      } else {
        ctx.fillStyle = '#293847';
        ctx.strokeStyle = '#537391';
        ctx.lineWidth = 1.25;
      }
      ctx.fill();
      ctx.stroke();

      // Roughness map (visited = glossy gold #303030, unvisited = satin #686868)
      this._traceFeaturePath(roughCtx, feature, mapW, mapH);
      roughCtx.fillStyle = isVisited ? '#303030' : '#686868';
      roughCtx.fill();

      // Bump map (continents raised slightly)
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
    this.cityDataList = allCities;

    // 1. Single InstancedMesh for all city beacons (1 draw call = ultra fast!)
    if (this.cityBeacons) {
      this.group.remove(this.cityBeacons);
      this.cityBeacons.geometry.dispose();
      this.cityBeacons.material.dispose();
    }

    const beaconGeo = new THREE.SphereGeometry(0.055, 10, 10);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.15,
      metalness: 0.4,
      emissive: '#1e354d',
      emissiveIntensity: 0.5
    });

    this.cityBeacons = new THREE.InstancedMesh(beaconGeo, beaconMat, allCities.length);
    const dummy = new THREE.Object3D();
    const colorVisited = new THREE.Color('#ffd369');
    const colorHome = new THREE.Color('#48d1ff');
    const colorDefault = new THREE.Color('#7ec8e3');

    allCities.forEach((city, idx) => {
      const isVisited = visitedCityIds.has(city.id);
      const isHome = city.id === homeBaseId;
      const pos = latLonToVector3(city.lat, city.lon, GLOBE_RADIUS + 0.03);
      dummy.position.copy(pos);
      const scale = isHome ? 1.55 : isVisited ? 1.35 : 0.72;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.cityBeacons.setMatrixAt(idx, dummy.matrix);
      this.cityBeacons.setColorAt(idx, isHome ? colorHome : isVisited ? colorVisited : colorDefault);
    });

    this.cityBeacons.instanceMatrix.needsUpdate = true;
    if (this.cityBeacons.instanceColor) this.cityBeacons.instanceColor.needsUpdate = true;
    this.group.add(this.cityBeacons);

    // 2. Pulsing target rings for visited cities
    while (this.ringsGroup.children.length) {
      this.ringsGroup.remove(this.ringsGroup.children[0]);
    }
    this.markerRings = [];

    for (const city of allCities) {
      if (visitedCityIds.has(city.id)) {
        this._createPulsingRings(city.lat, city.lon, city.id === homeBaseId);
      }
    }

    // 3. Connection arcs
    this._rebuildArcs(allCities, visitedCityIds, homeBaseId);
  }

  _createPulsingRings(lat, lon, isHome) {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS + 0.028);
    const normal = pos.clone().normalize();
    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);
    ringGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    const color = isHome ? '#48d1ff' : '#ffd369';
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

  update(elapsed) {
    this.cloudsMesh.visible = this.showClouds;
    if (this.showClouds) {
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
