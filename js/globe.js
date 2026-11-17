import * as THREE from 'three';
import * as topojson from 'topojson-client';
import { latLonToVector3, createCitySkyline } from './skyline.js';

export const GLOBE_RADIUS = 10;

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
    this.hoveredCountryId = null;

    this.citySkylines = new Map(); // id -> skylineObj
    this.markerRings = [];
    this.arcsGroup = new THREE.Group();
    this.skylinesGroup = new THREE.Group();
    this.ringsGroup = new THREE.Group();

    this.group.add(this.skylinesGroup);
    this.group.add(this.ringsGroup);
    this.group.add(this.arcsGroup);

    this.showArcs = true;
    this.showSkylines = true;
    this.arcAnimations = [];

    this._initCanvasTexture();
    this._initSphere();
    this._initAtmosphere();
  }

  _initCanvasTexture() {
    this.texWidth = 4096;
    this.texHeight = 2048;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.texWidth;
    this.canvas.height = this.texHeight;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  _initSphere() {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
    const mat = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.78,
      metalness: 0.12
    });
    this.sphereMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.sphereMesh);
  }

  _initAtmosphere() {
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.035, 64, 48);
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
          float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
          gl_FragColor = vec4(0.28, 0.78, 1.0, 1.0) * intensity * 0.65;
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

    this.redrawTexture();
    return this.countries;
  }

  redrawTexture() {
    const { ctx, texWidth: w, texHeight: h } = this;

    // Ocean background (dark slate matching reference)
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(0, 0, w, h);

    // Subtle lat/lon grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
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

    // Draw countries
    for (const feature of this.countries) {
      const isVisited = this.visitedCountries.has(feature._id);
      const isHovered = this.hoveredCountryId === feature._id;

      if (isVisited) {
        ctx.fillStyle = isHovered ? '#edc25e' : '#c99b38';
        ctx.strokeStyle = '#ffe18c';
        ctx.lineWidth = 1.6;
      } else {
        ctx.fillStyle = isHovered ? '#535c6e' : '#3a404c';
        ctx.strokeStyle = '#5c6577';
        ctx.lineWidth = 1.0;
      }

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
              // Avoid antimeridian horizontal streaks
              const prevLon = ring[i - 1][0];
              if (Math.abs(lon - prevLon) > 180) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
          }
          ctx.closePath();
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    this.texture.needsUpdate = true;
  }

  findCountryAt(lat, lon) {
    for (const f of this.countries) {
      if (pointInFeature(lon, lat, f)) {
        return f;
      }
    }
    return null;
  }

  setVisitedCountries(ids) {
    this.visitedCountries = new Set(ids);
    this.redrawTexture();
  }

  setHoveredCountry(id) {
    if (this.hoveredCountryId === id) return;
    this.hoveredCountryId = id;
    this.redrawTexture();
  }

  syncCities(allCities, visitedCityIds, homeBaseId) {
    // Clear existing rings & skylines
    while (this.skylinesGroup.children.length) {
      this.skylinesGroup.remove(this.skylinesGroup.children[0]);
    }
    while (this.ringsGroup.children.length) {
      this.ringsGroup.remove(this.ringsGroup.children[0]);
    }
    this.citySkylines.clear();
    this.markerRings = [];

    for (const city of allCities) {
      const isVisited = visitedCityIds.has(city.id);
      const skyline = createCitySkyline(city, GLOBE_RADIUS, isVisited);
      this.skylinesGroup.add(skyline.root);
      this.citySkylines.set(city.id, skyline);

      if (isVisited) {
        this._createPulsingRings(city.lat, city.lon, city.id === homeBaseId);
      }
    }

    this._rebuildArcs(allCities, visitedCityIds, homeBaseId);
  }

  _createPulsingRings(lat, lon, isHome) {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS + 0.025);
    const normal = pos.clone().normalize();
    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);
    ringGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    const color = isHome ? '#48d1ff' : '#f0c05a';
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 20),
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })
    );
    dot.rotation.x = -Math.PI / 2;
    ringGroup.add(dot);

    for (let i = 0; i < 2; i++) {
      const ringGeo = new THREE.RingGeometry(0.11, 0.145, 32);
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

      // Base glowing white/cyan arc
      const mat = new THREE.LineBasicMaterial({
        color: '#8be4ff',
        transparent: true,
        opacity: 0.55
      });
      const line = new THREE.Line(geo, mat);
      this.arcsGroup.add(line);

      // Traveling pulse particle along the arc
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
    // 1. Pulse target rings
    for (const r of this.markerRings) {
      const t = (elapsed * 0.65 + r.phase) % 1;
      const scale = 1 + t * 2.2;
      r.mesh.scale.set(scale, 1, scale);
      r.mat.opacity = (1 - t) * 0.78;
    }

    // 2. Animate connection arc pulses
    this.arcsGroup.visible = this.showArcs;
    if (this.showArcs) {
      for (const a of this.arcAnimations) {
        const t = (elapsed * a.speed + a.offset) % 1;
        a.pulseMesh.position.copy(a.curve.getPoint(t));
      }
    }

    // 3. Grow/shrink 3D skylines smoothly when zooming in!
    this.skylinesGroup.visible = this.showSkylines;
    let activeSkylineCity = null;

    if (this.showSkylines) {
      const camDist = cameraPosition.length();
      // Zoomed in threshold: camDist < 19.5 (globe radius = 10)
      const zoomFactor = THREE.MathUtils.clamp((20.5 - camDist) / 6.5, 0, 1);

      let closestDist = Infinity;
      for (const skyline of this.citySkylines.values()) {
        const worldPos = skyline.root.position;
        const dToCam = worldPos.distanceTo(cameraPosition);
        // Also ensure it's on the camera-facing hemisphere
        const facing = worldPos.clone().normalize().dot(cameraPosition.clone().normalize());
        const targetScale = facing > 0.25 ? Math.max(0.001, zoomFactor * (facing > 0.65 ? 1.0 : 0.65)) : 0.001;

        skyline.currentScaleY = THREE.MathUtils.lerp(skyline.currentScaleY, targetScale, 0.12);
        skyline.skylineGroup.scale.set(1, skyline.currentScaleY, 1);

        if (zoomFactor > 0.35 && facing > 0.6 && dToCam < closestDist) {
          closestDist = dToCam;
          activeSkylineCity = skyline.city;
        }
      }
    }

    return activeSkylineCity;
  }
}
