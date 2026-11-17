import * as THREE from 'three';

const SHARED_MATERIALS = {
  towerDark: new THREE.MeshStandardMaterial({
    color: '#1f2633',
    roughness: 0.45,
    metalness: 0.65,
    emissive: '#0c1624',
    emissiveIntensity: 0.4
  }),
  towerGold: new THREE.MeshStandardMaterial({
    color: '#d9ad4c',
    roughness: 0.35,
    metalness: 0.7,
    emissive: '#8f6516',
    emissiveIntensity: 0.45
  }),
  towerCyan: new THREE.MeshStandardMaterial({
    color: '#3ec7f5',
    roughness: 0.3,
    metalness: 0.6,
    emissive: '#1d87b5',
    emissiveIntensity: 0.65
  }),
  towerLight: new THREE.MeshStandardMaterial({
    color: '#dce4f0',
    roughness: 0.4,
    metalness: 0.35,
    emissive: '#42516b',
    emissiveIntensity: 0.25
  }),
  towerRed: new THREE.MeshStandardMaterial({
    color: '#d64545',
    roughness: 0.45,
    metalness: 0.4,
    emissive: '#6e1919',
    emissiveIntensity: 0.35
  })
};

function addBox(group, w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  group.add(mesh);
  return mesh;
}

function addCylinder(group, rt, rb, h, x, y, z, mat, radialSegments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, radialSegments), mat);
  mesh.position.set(x, y + h / 2, z);
  group.add(mesh);
  return mesh;
}

function buildLandmark(group, type) {
  switch (type) {
    case 'eiffel': {
      addCylinder(group, 0.04, 0.14, 0.22, 0, 0, 0, SHARED_MATERIALS.towerGold, 4);
      addCylinder(group, 0.02, 0.045, 0.24, 0, 0.22, 0, SHARED_MATERIALS.towerGold, 4);
      addCylinder(group, 0.004, 0.015, 0.14, 0, 0.46, 0, SHARED_MATERIALS.towerCyan, 6);
      break;
    }
    case 'burj': {
      addCylinder(group, 0.05, 0.09, 0.2, 0, 0, 0, SHARED_MATERIALS.towerCyan, 6);
      addCylinder(group, 0.03, 0.05, 0.22, 0, 0.2, 0, SHARED_MATERIALS.towerCyan, 6);
      addCylinder(group, 0.012, 0.03, 0.22, 0, 0.42, 0, SHARED_MATERIALS.towerLight, 6);
      addCylinder(group, 0.002, 0.008, 0.14, 0, 0.64, 0, SHARED_MATERIALS.towerGold, 6);
      break;
    }
    case 'nyc': {
      addBox(group, 0.11, 0.28, 0.11, 0, 0, 0, SHARED_MATERIALS.towerDark);
      addBox(group, 0.07, 0.18, 0.07, 0, 0.28, 0, SHARED_MATERIALS.towerCyan);
      addCylinder(group, 0.003, 0.01, 0.14, 0, 0.46, 0, SHARED_MATERIALS.towerGold, 6);
      break;
    }
    case 'berlin': {
      addCylinder(group, 0.016, 0.026, 0.36, 0, 0, 0, SHARED_MATERIALS.towerLight, 10);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 16), SHARED_MATERIALS.towerGold);
      sphere.position.set(0, 0.36, 0);
      group.add(sphere);
      addCylinder(group, 0.003, 0.01, 0.16, 0, 0.41, 0, SHARED_MATERIALS.towerRed, 6);
      break;
    }
    case 'tokyo': {
      addCylinder(group, 0.025, 0.08, 0.34, 0, 0, 0, SHARED_MATERIALS.towerRed, 8);
      addBox(group, 0.06, 0.03, 0.06, 0, 0.22, 0, SHARED_MATERIALS.towerGold);
      addCylinder(group, 0.004, 0.018, 0.22, 0, 0.34, 0, SHARED_MATERIALS.towerCyan, 8);
      break;
    }
    case 'sydney': {
      for (let i = -1; i <= 1; i++) {
        const sail = new THREE.Mesh(
          new THREE.ConeGeometry(0.085, 0.22, 4),
          SHARED_MATERIALS.towerLight
        );
        sail.position.set(i * 0.08, 0.11, 0.02 * i);
        sail.rotation.z = -0.22;
        group.add(sail);
      }
      break;
    }
    case 'cairo': {
      const p1 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 4), SHARED_MATERIALS.towerGold);
      p1.position.set(-0.07, 0.11, 0.03);
      p1.rotation.y = Math.PI / 4;
      const p2 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 4), SHARED_MATERIALS.towerGold);
      p2.position.set(0.1, 0.08, -0.05);
      p2.rotation.y = Math.PI / 4;
      group.add(p1, p2);
      break;
    }
    case 'singapore': {
      addBox(group, 0.05, 0.32, 0.05, -0.1, 0, 0, SHARED_MATERIALS.towerDark);
      addBox(group, 0.05, 0.32, 0.05, 0, 0, 0, SHARED_MATERIALS.towerDark);
      addBox(group, 0.05, 0.32, 0.05, 0.1, 0, 0, SHARED_MATERIALS.towerDark);
      addBox(group, 0.32, 0.04, 0.07, 0, 0.32, 0, SHARED_MATERIALS.towerCyan);
      break;
    }
    case 'london': {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.48, 4), SHARED_MATERIALS.towerCyan);
      shard.position.set(-0.04, 0.24, 0);
      group.add(shard);
      addBox(group, 0.05, 0.26, 0.05, 0.1, 0, 0.04, SHARED_MATERIALS.towerGold);
      break;
    }
    case 'sanfrancisco': {
      const pyramid = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 4), SHARED_MATERIALS.towerLight);
      pyramid.position.set(0, 0.21, 0);
      group.add(pyramid);
      addBox(group, 0.025, 0.24, 0.025, -0.15, 0, 0.08, SHARED_MATERIALS.towerRed);
      addBox(group, 0.025, 0.24, 0.025, -0.05, 0, 0.14, SHARED_MATERIALS.towerRed);
      break;
    }
    case 'toronto': {
      addCylinder(group, 0.015, 0.035, 0.36, 0, 0, 0, SHARED_MATERIALS.towerLight, 10);
      addCylinder(group, 0.055, 0.055, 0.04, 0, 0.32, 0, SHARED_MATERIALS.towerCyan, 12);
      addCylinder(group, 0.003, 0.01, 0.15, 0, 0.36, 0, SHARED_MATERIALS.towerGold, 6);
      break;
    }
    case 'shanghai': {
      addCylinder(group, 0.018, 0.028, 0.42, -0.04, 0, 0, SHARED_MATERIALS.towerCyan, 8);
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 14), SHARED_MATERIALS.towerGold);
      s1.position.set(-0.04, 0.18, 0);
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 14), SHARED_MATERIALS.towerGold);
      s2.position.set(-0.04, 0.31, 0);
      group.add(s1, s2);
      addBox(group, 0.07, 0.44, 0.07, 0.09, 0, 0.04, SHARED_MATERIALS.towerDark);
      break;
    }
    case 'rome': {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.14, 0.12, 18, 1, true),
        SHARED_MATERIALS.towerGold
      );
      ring.position.set(0, 0.06, 0);
      group.add(ring);
      break;
    }
    case 'rio': {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.22, 12), SHARED_MATERIALS.towerDark);
      hill.position.set(0, 0.11, 0);
      group.add(hill);
      addBox(group, 0.025, 0.12, 0.025, 0, 0.22, 0, SHARED_MATERIALS.towerLight);
      addBox(group, 0.11, 0.02, 0.02, 0, 0.29, 0, SHARED_MATERIALS.towerLight);
      break;
    }
    case 'zurich': {
      addBox(group, 0.05, 0.25, 0.05, -0.05, 0, 0, SHARED_MATERIALS.towerLight);
      addBox(group, 0.05, 0.25, 0.05, 0.05, 0, 0, SHARED_MATERIALS.towerLight);
      addCylinder(group, 0.015, 0.025, 0.08, -0.05, 0.25, 0, SHARED_MATERIALS.towerGold, 8);
      addCylinder(group, 0.015, 0.025, 0.08, 0.05, 0.25, 0, SHARED_MATERIALS.towerGold, 8);
      break;
    }
    default: {
      addBox(group, 0.08, 0.34, 0.08, 0, 0, 0, SHARED_MATERIALS.towerCyan);
      addCylinder(group, 0.004, 0.01, 0.1, 0, 0.34, 0, SHARED_MATERIALS.towerGold, 6);
    }
  }
}

export function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export function createCitySkyline(city, globeRadius, isVisited) {
  const root = new THREE.Group();
  const pos = latLonToVector3(city.lat, city.lon, globeRadius);
  root.position.copy(pos);

  // Align +Y with surface normal
  const normal = pos.clone().normalize();
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

  // Inner group scales on Y when zooming in
  const skylineGroup = new THREE.Group();
  skylineGroup.scale.set(1, 0.001, 1);

  // Subtle base pad
  const padGeo = new THREE.RingGeometry(0.18, 0.24, 24);
  padGeo.rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshBasicMaterial({
    color: isVisited ? '#e0b34c' : '#48d1ff',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55
  });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = 0.005;
  root.add(pad);

  // Surrounding procedural skyscrapers (deterministic from city name)
  let seed = 0;
  for (let i = 0; i < city.name.length; i++) {
    seed = (seed * 31 + city.name.charCodeAt(i)) % 9973;
  }
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.35;
    const dist = 0.14 + rand() * 0.14;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const w = 0.035 + rand() * 0.035;
    const d = 0.035 + rand() * 0.035;
    const h = 0.08 + rand() * 0.22;
    const mat = i % 4 === 0
      ? SHARED_MATERIALS.towerGold
      : i % 3 === 0
        ? SHARED_MATERIALS.towerCyan
        : SHARED_MATERIALS.towerDark;
    addBox(skylineGroup, w, h, d, x, 0, z, mat);
  }

  // Signature landmark in center
  buildLandmark(skylineGroup, city.landmark || 'generic');

  root.add(skylineGroup);

  return {
    city,
    root,
    skylineGroup,
    padMat,
    currentScaleY: 0.001,
    setVisited(visited) {
      padMat.color.set(visited ? '#e0b34c' : '#48d1ff');
    }
  };
}
