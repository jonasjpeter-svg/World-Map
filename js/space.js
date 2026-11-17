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
  grad.addColorStop(0.25, colorHex + 'aa');
  grad.addColorStop(0.6, colorHex + '22');
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
  const starCount = 4200;
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
    const r = 180 + Math.random() * 260;
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

  // Subtle brighter hero stars
  const heroCount = 120;
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
      size: 1.9,
      color: '#e8f4ff',
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false
    })
  );
  spaceGroup.add(heroStars);

  // 2. Planets in the background
  const planets = [];

  // Moon (orbiting near Earth)
  const moonTex = createPlanetTexture((ctx, w, h) => {
    ctx.fillStyle = '#aeb3bc';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rad = 2 + Math.random() * 14;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(70,74,82,0.45)' : 'rgba(215,220,228,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 32),
    new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.9, metalness: 0.05 })
  );
  const moonPivot = new THREE.Group();
  moonMesh.position.set(24, 4, -14);
  moonPivot.add(moonMesh);
  spaceGroup.add(moonPivot);
  planets.push({ mesh: moonMesh, spin: 0.002 });

  // Sun (far background light source + corona)
  const sunGroup = new THREE.Group();
  sunGroup.position.set(115, 42, -95);
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(8.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: '#ffd97d' })
  );
  const sunGlow = createGlowSprite('#ffaa33');
  sunGlow.scale.set(42, 42, 1);
  sunGroup.add(sunMesh, sunGlow);
  spaceGroup.add(sunGroup);

  // Mars
  const marsTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f2d9cc');
    grad.addColorStop(0.12, '#c75b39');
    grad.addColorStop(0.5, '#a84226');
    grad.addColorStop(0.88, '#bf5534');
    grad.addColorStop(1, '#f0d7c9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 65; i++) {
      ctx.fillStyle = 'rgba(75, 22, 12, 0.28)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 28, 4 + Math.random() * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(4.4, 32, 32),
    new THREE.MeshStandardMaterial({ map: marsTex, roughness: 0.85 })
  );
  mars.position.set(-72, 24, -85);
  spaceGroup.add(mars);
  planets.push({ mesh: mars, spin: 0.003 });

  // Jupiter
  const jupiterTex = createPlanetTexture((ctx, w, h) => {
    const bandColors = ['#d8c3a5', '#b88b64', '#e5d4b8', '#a36f49', '#d2b48c', '#c7976e', '#e7d9c4'];
    const bandH = h / 14;
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = bandColors[i % bandColors.length];
      ctx.fillRect(0, i * bandH, w, bandH + 1);
    }
    // Great Red Spot
    ctx.fillStyle = '#c2593f';
    ctx.beginPath();
    ctx.ellipse(w * 0.62, h * 0.64, 24, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const jupiter = new THREE.Mesh(
    new THREE.SphereGeometry(11.5, 40, 40),
    new THREE.MeshStandardMaterial({ map: jupiterTex, roughness: 0.72 })
  );
  jupiter.position.set(-105, -28, -110);
  spaceGroup.add(jupiter);
  planets.push({ mesh: jupiter, spin: 0.0045 });

  // Saturn + Rings
  const saturnGroup = new THREE.Group();
  saturnGroup.position.set(92, -32, -120);
  const saturnTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c9b48a');
    grad.addColorStop(0.3, '#e3cfa1');
    grad.addColorStop(0.5, '#d1b57e');
    grad.addColorStop(0.75, '#e8d7ae');
    grad.addColorStop(1, '#baa274');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const saturn = new THREE.Mesh(
    new THREE.SphereGeometry(8.5, 36, 36),
    new THREE.MeshStandardMaterial({ map: saturnTex, roughness: 0.75 })
  );
  const ringGeo = new THREE.RingGeometry(11.2, 18.5, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#d9c398',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.62
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
    grad.addColorStop(0, '#2a4fb5');
    grad.addColorStop(0.5, '#3b6fe0');
    grad.addColorStop(1, '#1f3d94');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const neptune = new THREE.Mesh(
    new THREE.SphereGeometry(5.6, 32, 32),
    new THREE.MeshStandardMaterial({ map: neptuneTex, roughness: 0.65 })
  );
  neptune.position.set(45, 58, -135);
  spaceGroup.add(neptune);
  planets.push({ mesh: neptune, spin: 0.003 });

  // Venus
  const venusTex = createPlanetTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#e8c487');
    grad.addColorStop(0.5, '#d9a45b');
    grad.addColorStop(1, '#e8c487');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  const venus = new THREE.Mesh(
    new THREE.SphereGeometry(3.6, 32, 32),
    new THREE.MeshStandardMaterial({ map: venusTex, roughness: 0.7 })
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
    }
  };
}
