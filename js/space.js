import * as THREE from 'three';

function createPlanetTexture(drawFn, width = 512, height = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createGlowSprite(colorHex, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, colorHex);
  grad.addColorStop(0.22, colorHex + 'cc');
  grad.addColorStop(0.55, colorHex + '33');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  return new THREE.Sprite(mat);
}

export function createSpaceEnvironment(scene) {
  const spaceGroup = new THREE.Group();
  spaceGroup.name = 'SpaceEnvironment';

  // 1. Multi-colored Starfield
  const starCount = 4500;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const palette = [
    new THREE.Color('#ffffff'),
    new THREE.Color('#cfe8ff'),
    new THREE.Color('#ffe9c4'),
    new THREE.Color('#ffd2a1'),
    new THREE.Color('#9bbcff')
  ];

  for (let i = 0; i < starCount; i++) {
    const r = 180 + Math.random() * 280;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const c = palette[Math.floor(Math.random() * palette.length)];
    const brightness = 0.55 + Math.random() * 0.45;
    colors[i * 3] = c.r * brightness;
    colors[i * 3 + 1] = c.g * brightness;
    colors[i * 3 + 2] = c.b * brightness;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const starMat = new THREE.PointsMaterial({
    size: 0.95,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    sizeAttenuation: true,
    depthWrite: false
  });

  const stars = new THREE.Points(starGeo, starMat);
  spaceGroup.add(stars);

  // Brighter hero stars
  const heroCount = 140;
  const heroPos = new Float32Array(heroCount * 3);
  for (let i = 0; i < heroCount; i++) {
    const r = 170 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    heroPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    heroPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    heroPos[i * 3 + 2] = r * Math.cos(phi);
  }
  const heroGeo = new THREE.BufferGeometry();
  heroGeo.setAttribute('position', new THREE.BufferAttribute(heroPos, 3));
  const heroStars = new THREE.Points(
    heroGeo,
    new THREE.PointsMaterial({
      size: 2.0,
      color: '#e8f4ff',
      transparent: true,
      opacity: 0.88,
      sizeAttenuation: true,
      depthWrite: false
    })
  );
  spaceGroup.add(heroStars);

  // 2. Glossy, realistic 3D Planets
  const planets = [];

  // Moon (orbiting near Earth)
  const moonTex = createPlanetTexture((ctx, w, h) => {
    ctx.fillStyle = '#bcc2cc';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rad = 2 + Math.random() * 14;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(65,70,80,0.48)' : 'rgba(235,240,248,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 40, 40),
    new THREE.MeshPhysicalMaterial({
      map: moonTex,
      roughness: 0.55,
      metalness: 0.1,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4
    })
  );
  const moonPivot = new THREE.Group();
  moonMesh.position.set(24, 4, -14);
  moonPivot.add(moonMesh);
  spaceGroup.add(moonPivot);
  planets.push({ mesh: moonMesh, spin: 0.002 });

  // Sun (glowing solar sphere + corona)
  const sunGroup = new THREE.Group();
  sunGroup.position.set(115, 42, -95);
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(8.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: '#ffe28a' })
  );
  const sunGlow = createGlowSprite('#ffaa33');
  sunGlow.scale.set(48, 48, 1);
  sunGroup.add(sunMesh, sunGlow);
  spaceGroup.add(sunGroup);

  // Mars (glossy atmosphere sheen)
  const marsTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f4dfd3');
    grad.addColorStop(0.12, '#cf5d38');
    grad.addColorStop(0.5, '#ad4022');
    grad.addColorStop(0.88, '#c65532');
    grad.addColorStop(1, '#f0d7c9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 75; i++) {
      ctx.fillStyle = 'rgba(70, 18, 10, 0.32)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 28, 4 + Math.random() * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(4.4, 40, 40),
    new THREE.MeshPhysicalMaterial({
      map: marsTex,
      roughness: 0.42,
      metalness: 0.12,
      clearcoat: 0.55,
      clearcoatRoughness: 0.25
    })
  );
  mars.position.set(-72, 24, -85);
  spaceGroup.add(mars);
  planets.push({ mesh: mars, spin: 0.003 });

  // Jupiter
  const jupiterTex = createPlanetTexture((ctx, w, h) => {
    const bandColors = ['#dfc9aa', '#bd8b61', '#eadbc0', '#a66d44', '#d9ba8f', '#cc986c', '#ece0cc'];
    const bandH = h / 16;
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = bandColors[i % bandColors.length];
      ctx.fillRect(0, i * bandH, w, bandH + 1);
    }
    ctx.fillStyle = '#c85438';
    ctx.beginPath();
    ctx.ellipse(w * 0.62, h * 0.64, 24, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const jupiter = new THREE.Mesh(
    new THREE.SphereGeometry(11.5, 48, 48),
    new THREE.MeshPhysicalMaterial({
      map: jupiterTex,
      roughness: 0.32,
      metalness: 0.08,
      clearcoat: 0.65,
      clearcoatRoughness: 0.2
    })
  );
  jupiter.position.set(-105, -28, -110);
  spaceGroup.add(jupiter);
  planets.push({ mesh: jupiter, spin: 0.0045 });

  // Saturn + Rings
  const saturnGroup = new THREE.Group();
  saturnGroup.position.set(92, -32, -120);
  const saturnTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#cfb98e');
    grad.addColorStop(0.3, '#ead6a8');
    grad.addColorStop(0.5, '#d6b981');
    grad.addColorStop(0.75, '#efe0b8');
    grad.addColorStop(1, '#c0a778');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const saturn = new THREE.Mesh(
    new THREE.SphereGeometry(8.5, 44, 44),
    new THREE.MeshPhysicalMaterial({
      map: saturnTex,
      roughness: 0.34,
      metalness: 0.08,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22
    })
  );
  const ringGeo = new THREE.RingGeometry(11.2, 18.8, 72);
  const ringMat = new THREE.MeshPhysicalMaterial({
    color: '#e6d2a8',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
    roughness: 0.3,
    metalness: 0.25,
    clearcoat: 0.5
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI * 0.42;
  ring.rotation.y = 0.25;
  saturnGroup.add(saturn, ring);
  spaceGroup.add(saturnGroup);
  planets.push({ mesh: saturn, spin: 0.0038 });

  // Neptune
  const neptuneTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a58cc');
    grad.addColorStop(0.5, '#4280f5');
    grad.addColorStop(1, '#1e42a6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const neptune = new THREE.Mesh(
    new THREE.SphereGeometry(5.6, 40, 40),
    new THREE.MeshPhysicalMaterial({
      map: neptuneTex,
      roughness: 0.25,
      metalness: 0.1,
      clearcoat: 0.75,
      clearcoatRoughness: 0.15
    })
  );
  neptune.position.set(45, 58, -135);
  spaceGroup.add(neptune);
  planets.push({ mesh: neptune, spin: 0.003 });

  // Venus
  const venusTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#eed096');
    grad.addColorStop(0.5, '#e0ac62');
    grad.addColorStop(1, '#eed096');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const venus = new THREE.Mesh(
    new THREE.SphereGeometry(3.6, 40, 40),
    new THREE.MeshPhysicalMaterial({
      map: venusTex,
      roughness: 0.28,
      metalness: 0.1,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18
    })
  );
  venus.position.set(62, 18, 95);
  spaceGroup.add(venus);
  planets.push({ mesh: venus, spin: 0.0018 });

  scene.add(spaceGroup);

  return {
    group: spaceGroup,
    update(elapsed) {
      moonPivot.rotation.y = elapsed * 0.06;
      stars.rotation.y = elapsed * 0.0025;
      for (const p of planets) {
        p.mesh.rotation.y += p.spin;
      }
      starMat.opacity = 0.84 + Math.sin(elapsed * 1.4) * 0.1;
    },
    setVisible(visible) {
      spaceGroup.visible = visible;
    },
    setSunDirection(dir) {
      sunGroup.position.copy(dir).normalize().multiplyScalar(155);
    }
  };
}
