import * as THREE from 'three';

/**
 * Creates 4 VFX demos arranged in a row within the given bay area.
 * Returns all created meshes so the caller can track them.
 *
 * Effects:
 *   A) Dissolve sphere  (X = -15)
 *   B) Fire & smoke      (X = -5)
 *   C) Lightning & rain   (X = +5)
 *   D) Glowing ring       (X = +15)
 */
export async function createVfxShowcase(
  scene: THREE.Scene,
  base: THREE.Vector3,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _bayWidth: number,
): Promise<THREE.Object3D[]> {
  const created: THREE.Object3D[] = [];

  try {
    // ── Dynamic TSL / WebGPU imports ─────────────────────────────────────
    const { MeshBasicNodeMaterial, MeshStandardNodeMaterial } = await import(
      'three/webgpu'
    );
    const {
      time,
      uv,
      positionLocal,
      float,
      sin,
      vec2,
      vec3,
      mix,
      step,
      abs,
      pow,
      smoothstep,
      mul,
      add,
      cos,
    } = await import('three/tsl');
    const { mx_fractal_noise_float } = await import('three/tsl');

    // =====================================================================
    // EFFECT A — DISSOLVE SPHERE
    // =====================================================================
    {
      const posX = base.x - 15;
      const posY = base.y + 1.5;
      const posZ = base.z;

      const geometry = new THREE.SphereGeometry(1.2, 32, 32);
      const material = new MeshStandardNodeMaterial();
      material.transparent = true;
      material.side = THREE.DoubleSide;

      // Dissolve threshold oscillates 0 → 1 → 0
      const dissolveThreshold = sin(time.mul(0.5)).mul(0.5).add(0.5);

      // Fractal noise based on object-space position
      const noise = mx_fractal_noise_float(positionLocal.mul(3.0));

      // Height mask: 0 at bottom of sphere, 1 at top (sphere radius 1.2)
      const heightMask = positionLocal.y.add(1.2).div(2.4);

      // Combined dissolve value
      const dissolveValue = noise.add(heightMask);

      // Alpha: visible where dissolveValue exceeds threshold
      material.opacityNode = step(dissolveThreshold, dissolveValue);

      // Edge glow: bright orange at the dissolve boundary
      const edgeDist = dissolveValue.sub(dissolveThreshold).abs();
      const edgeGlow = step(edgeDist, float(0.05)).mul(3.0);
      material.colorNode = mix(
        vec3(0, 0.87, 1),   // cyan body
        vec3(1, 0.5, 0),    // orange edge
        edgeGlow,
      );
      material.emissiveNode = mix(
        vec3(0, 0.2, 0.3),
        vec3(1, 0.4, 0),
        edgeGlow,
      );

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(posX, posY, posZ);
      mesh.castShadow = false;
      scene.add(mesh);
      created.push(mesh);
    }

    // =====================================================================
    // EFFECT B — FIRE WITH SMOKE (multi-layered volumetric)
    // =====================================================================
    {
      const posX = base.x - 5;
      const posY = base.y + 0.2;
      const posZ = base.z;

      const fireGroup = new THREE.Group();
      fireGroup.position.set(posX, posY, posZ);
      scene.add(fireGroup);
      created.push(fireGroup);

      // --- 6 flame sheet planes rotated around Y axis ---
      const FLAME_COUNT = 6;
      const flameGeo = new THREE.PlaneGeometry(1.8, 3.5, 1, 12);

      for (let i = 0; i < FLAME_COUNT; i++) {
        const flameMat = new MeshBasicNodeMaterial();
        flameMat.transparent = true;
        flameMat.blending = THREE.NormalBlending;
        flameMat.depthWrite = false;
        flameMat.side = THREE.DoubleSide;

        // Unique seed per sheet for variation
        const seed = float(i * 1.7 + 0.3);

        // --- Position node: sway upper vertices ---
        const uvY = uv().y;
        const swayAmount = mul(uvY, uvY); // quadratic weight — base stays still
        const swayX = sin(add(time.mul(2.5), seed)).mul(0.12).mul(swayAmount);
        const swayZ = cos(add(time.mul(1.8), seed.mul(1.3))).mul(0.06).mul(swayAmount);
        flameMat.positionNode = vec3(
          positionLocal.x.add(swayX),
          positionLocal.y,
          positionLocal.z.add(swayZ),
        );

        // --- Scrolling UV for upward flame motion ---
        const flameUV = uv();
        const scrollSpeed = float(0.9).add(sin(seed).mul(0.15)); // slight per-sheet speed variation
        const scrolledV = flameUV.y.sub(time.mul(scrollSpeed));
        const scrolledUV = vec2(
          flameUV.x.add(sin(add(time.mul(0.7), seed.mul(2.0))).mul(0.08)),
          scrolledV,
        );

        // --- Fractal noise for fire shape ---
        const noise = mx_fractal_noise_float(scrolledUV.mul(3.5).add(seed));

        // Remap noise to 0..1 heat value
        const heat = noise.mul(0.5).add(0.5).clamp(0, 1);

        // --- 5-stop color ramp ---
        // 0.0: #2A0A02  0.3: #A61E06  0.55: #FF5A0A  0.8: #FFB01F  1.0: #FFFFFF
        const darkEmber  = vec3(0.165, 0.039, 0.008);
        const redOrange  = vec3(0.651, 0.118, 0.024);
        const hotOrange  = vec3(1.0, 0.353, 0.039);
        const golden     = vec3(1.0, 0.690, 0.122);
        const whiteCore  = vec3(1.0, 1.0, 1.0);

        // Piecewise lerp through the ramp stops
        const t1 = smoothstep(0.0, 0.3, heat);
        const t2 = smoothstep(0.3, 0.55, heat);
        const t3 = smoothstep(0.55, 0.8, heat);
        const t4 = smoothstep(0.8, 1.0, heat);

        const rampColor = mix(
          mix(
            mix(
              mix(darkEmber, redOrange, t1),
              hotOrange,
              t2,
            ),
            golden,
            t3,
          ),
          whiteCore,
          t4,
        );

        flameMat.colorNode = rampColor;

        // --- Opacity: noise * vertical fade * horizontal taper ---
        // Horizontal taper: fade at left/right edges
        const horizDist = abs(flameUV.x.mul(2.0).sub(1.0));
        const horizTaper = pow(float(1.0).sub(horizDist), float(1.3));

        // Vertical fade: strong at bottom, fades out at top, small fade at very bottom
        const topFade = float(1.0).sub(smoothstep(0.65, 1.0, flameUV.y));
        const bottomFade = smoothstep(0.0, 0.08, flameUV.y);
        const vertFade = mul(topFade, bottomFade);

        // Combine
        const flameAlpha = mul(heat, mul(vertFade, horizTaper)).clamp(0, 1);

        flameMat.opacityNode = flameAlpha;

        const flameMesh = new THREE.Mesh(flameGeo, flameMat);
        flameMesh.rotation.y = (i * 30 * Math.PI) / 180; // every 30 degrees
        flameMesh.position.y = 1.25; // raise so base sits at group origin
        flameMesh.castShadow = false;
        flameMesh.renderOrder = 1;
        fireGroup.add(flameMesh);
      }

      // --- Point light for ground illumination ---
      const fireLight = new THREE.PointLight(0xff6600, 8, 10, 2);
      fireLight.position.set(posX, base.y + 0.5, posZ);
      fireLight.castShadow = false;
      scene.add(fireLight);
      created.push(fireLight);

      // --- Animated smoke particles rising from fire ---
      const SMOKE_COUNT = 8;
      const smokeMinY = 2.0;
      const smokeMaxY = 8.0;
      const smokePuffs: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; speed: number; baseX: number; baseZ: number; phase: number }[] = [];
      for (let s = 0; s < SMOKE_COUNT; s++) {
        const startR = 0.4 + Math.random() * 0.3;
        const smokeGeo = new THREE.SphereGeometry(startR, 10, 10);
        const smokeMat = new THREE.MeshStandardMaterial({
          color: 0x222228,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          roughness: 1.0,
          metalness: 0.0,
        });
        const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
        // Stagger initial positions so they don't all start at once
        const startY = smokeMinY + (s / SMOKE_COUNT) * (smokeMaxY - smokeMinY);
        smokeMesh.position.set(
          (Math.random() - 0.5) * 0.5,
          startY,
          (Math.random() - 0.5) * 0.5,
        );
        smokeMesh.castShadow = false;
        fireGroup.add(smokeMesh);
        smokePuffs.push({
          mesh: smokeMesh,
          mat: smokeMat,
          speed: 0.4 + Math.random() * 0.3,
          baseX: (Math.random() - 0.5) * 0.4,
          baseZ: (Math.random() - 0.5) * 0.4,
          phase: Math.random() * Math.PI * 2,
        });
      }

      // Animate smoke: rise, grow, fade, then respawn at base
      let smokeTime = 0;
      const smokeInterval = setInterval(() => {
        smokeTime += 0.016; // ~60fps assumed
        for (const sp of smokePuffs) {
          sp.mesh.position.y += sp.speed * 0.016;
          // Gentle lateral drift
          sp.mesh.position.x = sp.baseX + Math.sin(smokeTime * 0.8 + sp.phase) * 0.3;
          sp.mesh.position.z = sp.baseZ + Math.cos(smokeTime * 0.6 + sp.phase) * 0.2;

          // Grow as it rises
          const lifeT = (sp.mesh.position.y - smokeMinY) / (smokeMaxY - smokeMinY);
          const scale = 1.0 + lifeT * 2.0; // grows to 3x original size
          sp.mesh.scale.setScalar(scale);

          // Fade out as it rises
          sp.mat.opacity = Math.max(0, 0.45 * (1.0 - lifeT));

          // Respawn at base when it reaches the top
          if (sp.mesh.position.y > smokeMaxY) {
            sp.mesh.position.y = smokeMinY;
            sp.mesh.position.x = (Math.random() - 0.5) * 0.5;
            sp.mesh.position.z = (Math.random() - 0.5) * 0.5;
            sp.baseX = sp.mesh.position.x;
            sp.baseZ = sp.mesh.position.z;
            sp.mesh.scale.setScalar(1.0);
            sp.mat.opacity = 0.45;
          }
        }
      }, 16);
      void smokeInterval;

      // --- Ember particles (tiny rising sparks) ---
      const emberCount = 30;
      const emberPositions = new Float32Array(emberCount * 3);
      for (let e = 0; e < emberCount; e++) {
        const e3 = e * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 0.4;
        emberPositions[e3] = Math.cos(angle) * radius;
        emberPositions[e3 + 1] = 0.5 + Math.random() * 2.0;
        emberPositions[e3 + 2] = Math.sin(angle) * radius;
      }
      const emberGeo = new THREE.BufferGeometry();
      emberGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(emberPositions, 3),
      );
      const emberMat = new THREE.PointsMaterial({
        color: 0xff8820,
        size: 0.06,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const emberPoints = new THREE.Points(emberGeo, emberMat);
      emberPoints.castShadow = false;
      fireGroup.add(emberPoints);
    }

    // =====================================================================
    // EFFECT C — LIGHTNING WITH RAIN
    // =====================================================================
    {
      const posX = base.x + 5;
      const posZ = base.z;

      // --- Bolt point generation with jittered control points ---
      function generateBoltPoints(
        boltStart: THREE.Vector3,
        boltEnd: THREE.Vector3,
        segments: number,
        seed: number,
      ): THREE.Vector3[] {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const p = boltStart.clone().lerp(boltEnd, t);
          // Lateral jitter — bell curve amplitude, stronger in the middle
          const amplitude = 0.4 * Math.sin(t * Math.PI);
          const jitterX = (Math.sin(seed * 13.7 + i * 7.3) * 2 - 1) * amplitude;
          const jitterZ = (Math.cos(seed * 17.1 + i * 11.2) * 2 - 1) * amplitude * 0.5;
          // Snap direction changes every 3 segments for electric feel
          if (i % 3 === 0) {
            p.x += jitterX * 1.5;
            p.z += jitterZ * 1.5;
          } else {
            p.x += jitterX * 0.4;
            p.z += jitterZ * 0.4;
          }
          pts.push(p);
        }
        return pts;
      }

      // --- TSL materials for bolt core and halo ---
      // Strike timing: visible for ~200ms every 3 seconds (fract(time*0.33) < 0.07)
      const strikePhase = time.mul(0.33); // 3-second cycle
      const strikeFract = strikePhase.sub(strikePhase.floor()); // fract
      const boltFlicker = step(strikeFract, float(0.07)); // ON for first 7% of cycle (~210ms)

      const coreMat = new MeshBasicNodeMaterial();
      coreMat.transparent = true;
      coreMat.blending = THREE.AdditiveBlending;
      coreMat.depthWrite = false;
      coreMat.side = THREE.DoubleSide;
      coreMat.colorNode = vec3(0.9, 0.95, 1.0);
      coreMat.opacityNode = boltFlicker;

      const haloMat = new MeshBasicNodeMaterial();
      haloMat.transparent = true;
      haloMat.blending = THREE.AdditiveBlending;
      haloMat.depthWrite = false;
      haloMat.side = THREE.DoubleSide;
      haloMat.colorNode = vec3(0.56, 0.83, 1.0);
      haloMat.opacityNode = mul(boltFlicker, float(0.3));

      // Smaller materials for fork branches
      const forkCoreMat = coreMat.clone();
      const forkHaloMat = haloMat.clone();

      // --- Container group for all bolt meshes ---
      const boltGroup = new THREE.Group();
      boltGroup.position.set(posX, 0, posZ);
      scene.add(boltGroup);
      created.push(boltGroup);

      // --- Build bolt geometry from a set of points ---
      function createBoltMeshes(
        pts: THREE.Vector3[],
        coreRadius: number,
        haloRadius: number,
        cMat: InstanceType<typeof MeshBasicNodeMaterial>,
        hMat: InstanceType<typeof MeshBasicNodeMaterial>,
      ): THREE.Mesh[] {
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
        const coreGeo = new THREE.TubeGeometry(curve, pts.length * 4, coreRadius, 6, false);
        const haloGeo = new THREE.TubeGeometry(curve, pts.length * 4, haloRadius, 6, false);

        const coreBoltMesh = new THREE.Mesh(coreGeo, cMat);
        coreBoltMesh.castShadow = false;
        const haloBoltMesh = new THREE.Mesh(haloGeo, hMat);
        haloBoltMesh.castShadow = false;

        return [coreBoltMesh, haloBoltMesh];
      }

      // --- Regenerate the entire bolt structure ---
      function rebuildBolt(): void {
        // Clear previous bolt meshes from group
        while (boltGroup.children.length > 0) {
          const child = boltGroup.children[0];
          boltGroup.remove(child);
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        }

        const seed = Math.random() * 1000;

        // Main bolt: 12 control points from cloud to ground
        const mainStart = new THREE.Vector3(0, base.y + 5, 0);
        const mainEnd = new THREE.Vector3(0, base.y + 0.5, 0);
        const mainPts = generateBoltPoints(mainStart, mainEnd, 12, seed);
        const mainMeshes = createBoltMeshes(mainPts, 0.03, 0.12, coreMat, haloMat);
        for (const m of mainMeshes) boltGroup.add(m);

        // Fork branches at 30%, 50%, 70% along the main bolt
        const forkIndices = [
          Math.round(12 * 0.3),
          Math.round(12 * 0.5),
          Math.round(12 * 0.7),
        ];

        for (let f = 0; f < forkIndices.length; f++) {
          const idx = forkIndices[f];
          const forkOrigin = mainPts[idx].clone();
          // Fork direction: outward at 25-45 degree angle
          const angleDeg = 25 + Math.random() * 20;
          const angleRad = (angleDeg * Math.PI) / 180;
          const forkSide = f % 2 === 0 ? 1 : -1;
          const forkLength = 1.2 + Math.random() * 0.8;
          const forkEnd = forkOrigin.clone().add(
            new THREE.Vector3(
              Math.sin(angleRad) * forkSide * forkLength,
              -Math.cos(angleRad) * forkLength,
              (Math.random() - 0.5) * 0.4,
            ),
          );

          const forkSeed = seed + (f + 1) * 100;
          const forkPts = generateBoltPoints(forkOrigin, forkEnd, 6, forkSeed);
          const forkMeshes = createBoltMeshes(
            forkPts, 0.015, 0.06, forkCoreMat, forkHaloMat,
          );
          for (const m of forkMeshes) boltGroup.add(m);
        }
      }

      // Initial build + periodic regeneration every ~2 seconds
      rebuildBolt();
      const boltInterval = setInterval(rebuildBolt, 2000);
      void boltInterval; // suppress unused-var lint

      // --- Rain particles — dense, tall column of falling streaks ---
      const rainCount = 500;
      const rainPositions = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        const i3 = i * 3;
        rainPositions[i3] = (Math.random() - 0.5) * 10;
        rainPositions[i3 + 1] = Math.random() * 8;
        rainPositions[i3 + 2] = (Math.random() - 0.5) * 10;
      }

      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(rainPositions, 3),
      );

      const rainMat = new THREE.PointsMaterial({
        color: 0x99bbdd,
        size: 0.12,
        transparent: true,
        opacity: 0.7,
      });

      const rainPoints = new THREE.Points(rainGeo, rainMat);
      rainPoints.position.set(posX, base.y + 1.5, posZ);
      rainPoints.castShadow = false;
      scene.add(rainPoints);
      created.push(rainPoints);

      // --- Storm cloud — soft puffy overlapping spheres with low opacity ---
      const cloudGroup = new THREE.Group();
      cloudGroup.position.set(posX, base.y + 6.0, posZ);
      // Many small soft puffs create a natural cloud shape
      const cloudPuffs = [
        { pos: [0, 0, 0], r: 2.0 },
        { pos: [-1.5, 0.3, 0.3], r: 1.8 },
        { pos: [1.5, 0.2, -0.2], r: 1.7 },
        { pos: [0, -0.3, -1.0], r: 1.5 },
        { pos: [-0.8, 0.5, 0.8], r: 1.3 },
        { pos: [0.8, 0.4, 0.6], r: 1.4 },
        { pos: [-2.2, -0.1, -0.3], r: 1.2 },
        { pos: [2.0, 0.1, 0.4], r: 1.1 },
        { pos: [0, 0.6, 0], r: 1.6 },
        { pos: [-0.5, -0.4, -0.5], r: 1.9 },
      ];
      for (const cp of cloudPuffs) {
        // Each puff gets its own material with slightly varied opacity
        const puffMat = new THREE.MeshStandardMaterial({
          color: 0x2a3040,
          roughness: 1.0,
          metalness: 0.0,
          transparent: true,
          opacity: 0.35 + Math.random() * 0.15,
          depthWrite: false,
        });
        const puffMesh = new THREE.Mesh(
          new THREE.SphereGeometry(cp.r, 16, 16),
          puffMat,
        );
        puffMesh.position.set(cp.pos[0], cp.pos[1], cp.pos[2]);
        puffMesh.castShadow = false;
        cloudGroup.add(puffMesh);
      }
      scene.add(cloudGroup);
      created.push(cloudGroup);

      // No flat plane — clouds only
      const cloudMesh = cloudGroup; // alias for reference below
      cloudMesh.castShadow = false;
      scene.add(cloudMesh);
      created.push(cloudMesh);

      // --- Lightning flash point light (pulses with bolt) ---
      const lightningLight = new THREE.PointLight(0x88ccff, 0, 20, 2);
      lightningLight.position.set(posX, base.y + 3, posZ);
      lightningLight.castShadow = false;
      scene.add(lightningLight);
      created.push(lightningLight);

      // Periodic flash: sharp double-strike pattern
      let flashTimer = 0;
      const flashInterval = setInterval(() => {
        flashTimer += 0.05;
        if (flashTimer < 0.15) {
          lightningLight.intensity = 20;
          rainMat.color.setHex(0xffffff);
        } else if (flashTimer < 0.3) {
          lightningLight.intensity = 0;
          rainMat.color.setHex(0xddeeff);
        } else if (flashTimer < 0.4) {
          lightningLight.intensity = 12;
          rainMat.color.setHex(0xeef4ff);
        } else {
          lightningLight.intensity = 0;
          rainMat.color.setHex(0xddeeff);
          flashTimer = 0;
        }
      }, 50);

      // Random flash timing: restart the flash cycle at random intervals
      const triggerFlash = (): void => {
        flashTimer = 0;
        const nextDelay = 1500 + Math.random() * 3000;
        setTimeout(triggerFlash, nextDelay);
      };
      setTimeout(triggerFlash, 2000 + Math.random() * 2000);

      void flashInterval; // suppress unused-var lint
    }

    // =====================================================================
    // EFFECT D — GLOWING RING WITH PARTICLES
    // =====================================================================
    {
      const posX = base.x + 15;
      const posY = base.y + 2.0;
      const posZ = base.z;

      // --- Torus ring ---
      const torusGeo = new THREE.TorusGeometry(1.5, 0.15, 16, 48);
      const torusMat = new MeshStandardNodeMaterial();
      torusMat.colorNode = vec3(0, 1, 0.8);
      torusMat.emissiveNode = vec3(0, 1, 0.8).mul(2.0);
      torusMat.roughnessNode = float(0.1);

      const torusMesh = new THREE.Mesh(torusGeo, torusMat);
      torusMesh.rotation.x = Math.PI / 4;
      torusMesh.rotation.z = Math.PI / 6;
      torusMesh.castShadow = false;

      // Wrap in a group for continuous Y-axis rotation
      const ringGroup = new THREE.Group();
      ringGroup.position.set(posX, posY, posZ);
      ringGroup.add(torusMesh);
      scene.add(ringGroup);
      created.push(ringGroup);

      // Animate the group rotation via a simple per-frame updater on userData
      ringGroup.userData.update = (dt: number): void => {
        ringGroup.rotation.y += dt * 0.5;
      };

      // --- Orbiting particles ---
      const particleCount = 100;
      const particlePositions = new Float32Array(particleCount * 3);
      const torusRadius = 1.5;

      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2;
        const tubeAngle = Math.random() * Math.PI * 2;
        const tubeRadius = 0.2 + Math.random() * 0.3;

        const i3 = i * 3;
        particlePositions[i3] =
          (torusRadius + tubeRadius * Math.cos(tubeAngle)) * Math.cos(angle);
        particlePositions[i3 + 1] = tubeRadius * Math.sin(tubeAngle);
        particlePositions[i3 + 2] =
          (torusRadius + tubeRadius * Math.cos(tubeAngle)) * Math.sin(angle);
      }

      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(particlePositions, 3),
      );

      const sparkMat = new THREE.PointsMaterial({
        color: 0x00ffcc,
        size: 0.12,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });

      const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
      sparkPoints.castShadow = false;
      // Nest inside ring group so they rotate together
      ringGroup.add(sparkPoints);

      // --- Point light at ring center ---
      const ringLight = new THREE.PointLight(0x00ffcc, 5, 12, 2);
      ringLight.position.set(posX, posY, posZ);
      ringLight.castShadow = false;
      scene.add(ringLight);
      created.push(ringLight);
    }
  } catch (err) {
    console.warn('[VfxShowcase] Failed to create VFX demos:', err);
    return [];
  }

  return created;
}
