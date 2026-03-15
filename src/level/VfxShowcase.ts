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

      // --- Animated smoke billboard sprites using Kenney smoke texture ---
      const smokeTexture = new THREE.TextureLoader().load('/assets/sprites/smoke_black.png');
      const SMOKE_COUNT = 12;
      const smokeMinY = 2.0;
      const smokeMaxY = 9.0;
      const smokeSprites: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; speed: number; baseX: number; baseZ: number; phase: number; startScale: number }[] = [];
      for (let s = 0; s < SMOKE_COUNT; s++) {
        const smokeMat = new THREE.SpriteMaterial({
          map: smokeTexture,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          color: 0x333338,
        });
        const sprite = new THREE.Sprite(smokeMat);
        const startY = smokeMinY + (s / SMOKE_COUNT) * (smokeMaxY - smokeMinY);
        const startScale = 0.8 + Math.random() * 0.5;
        sprite.scale.setScalar(startScale);
        sprite.position.set(
          (Math.random() - 0.5) * 0.6,
          startY,
          (Math.random() - 0.5) * 0.6,
        );
        fireGroup.add(sprite);
        smokeSprites.push({
          sprite,
          mat: smokeMat,
          speed: 0.5 + Math.random() * 0.4,
          baseX: sprite.position.x,
          baseZ: sprite.position.z,
          phase: Math.random() * Math.PI * 2,
          startScale,
        });
      }

      // Animate smoke sprites: rise, grow, fade, respawn
      let smokeTime = 0;
      const smokeInterval = setInterval(() => {
        smokeTime += 0.016;
        for (const sp of smokeSprites) {
          sp.sprite.position.y += sp.speed * 0.016;
          sp.sprite.position.x = sp.baseX + Math.sin(smokeTime * 0.7 + sp.phase) * 0.4;
          sp.sprite.position.z = sp.baseZ + Math.cos(smokeTime * 0.5 + sp.phase) * 0.3;
          // Rotate sprite slightly over time
          sp.mat.rotation += 0.005;
          const lifeT = (sp.sprite.position.y - smokeMinY) / (smokeMaxY - smokeMinY);
          const scale = sp.startScale * (1.0 + lifeT * 3.0);
          sp.sprite.scale.setScalar(scale);
          sp.mat.opacity = Math.max(0, 0.5 * (1.0 - lifeT * lifeT));
          if (sp.sprite.position.y > smokeMaxY) {
            sp.sprite.position.y = smokeMinY;
            sp.sprite.position.x = (Math.random() - 0.5) * 0.6;
            sp.sprite.position.z = (Math.random() - 0.5) * 0.6;
            sp.baseX = sp.sprite.position.x;
            sp.baseZ = sp.sprite.position.z;
            sp.sprite.scale.setScalar(sp.startScale);
            sp.mat.opacity = 0.5;
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
    // EFFECT C — LIGHTNING WITH RAIN (Sketchfab GLB model by Kyyy_24, CC-BY)
    // Uses the model's own cloud, lightning bolts, and rain drop meshes.
    // Lightning bolts flash on/off. Rain drops animate falling downward.
    // =====================================================================
    {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      try {
        const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
          loader.load('assets/models/cloud_lightning.glb', resolve as (gltf: unknown) => void, undefined, reject);
        });
        const model = gltf.scene;
        const posX = base.x + 5;
        const posZ = base.z;

        model.scale.setScalar(0.56);
        // Move cloud up by 2 units from previous position
        model.position.set(posX, base.y + 3.5, posZ);

        // Categorize meshes: keep cloud, collect bolts, extract ONE rain drop for particles
        const boltMeshes: THREE.Mesh[] = [];
        let rainDropGeo: THREE.BufferGeometry | null = null;
        let rainDropMat: THREE.Material | null = null;

        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
          // Lightning bolts
          if (child.name.toLowerCase().includes('bolt') && child instanceof THREE.Mesh) {
            boltMeshes.push(child);
            child.visible = false;
          }
          // Grab geometry/material from the first rain drop mesh, hide ALL rain meshes
          if (child.name.includes('Sphere') && child instanceof THREE.Mesh) {
            if (!rainDropGeo) {
              rainDropGeo = child.geometry.clone();
              rainDropMat = child.material;
            }
            child.visible = false; // hide all original rain drop meshes
          }
        });

        scene.add(model);
        created.push(model);

        // --- Create instanced rain particles from the single drop mesh ---
        // Rain spawns directly under the cloud's visual center.
        // The model geometry is huge (1000+ units) so bounding box is unreliable.
        // Use the cloud's known world position instead.
        const cloudWorldY = base.y + 3.5; // model.position.y
        const RAIN_COUNT = 150;
        const RAIN_AREA_W = 6;  // visual width of rain area
        const RAIN_AREA_D = 6;
        const RAIN_TOP = cloudWorldY - 0.5;  // just below cloud visual bottom
        const RAIN_BOTTOM = base.y - 0.5;    // ground level
        const RAIN_SPEED = 4.0;
        const rainCenterX = posX;
        const rainCenterZ = posZ;

        let rainInstancedMesh: THREE.InstancedMesh | null = null;
        const rainYPositions = new Float32Array(RAIN_COUNT);
        const rainSpeeds = new Float32Array(RAIN_COUNT);
        const rainXZ: Float32Array = new Float32Array(RAIN_COUNT * 2);

        // Use a tiny sphere for rain drops — model's rain geometry is 600+ units tall
        const tinyDropGeo = new THREE.SphereGeometry(0.03, 4, 4);
        const dropMat = rainDropMat ?? new THREE.MeshStandardMaterial({
          color: 0xaaccee, transparent: true, opacity: 0.7, depthWrite: false,
        });
        {
          rainInstancedMesh = new THREE.InstancedMesh(tinyDropGeo, dropMat, RAIN_COUNT);
          rainInstancedMesh.castShadow = false;
          // World space — centered under the cloud
          rainInstancedMesh.position.set(0, 0, 0);

          const dummy = new THREE.Object3D();
          for (let i = 0; i < RAIN_COUNT; i++) {
            const rx = rainCenterX + (Math.random() - 0.5) * RAIN_AREA_W;
            const rz = rainCenterZ + (Math.random() - 0.5) * RAIN_AREA_D;
            const ry = RAIN_BOTTOM + Math.random() * (RAIN_TOP - RAIN_BOTTOM);
            rainXZ[i * 2] = rx;
            rainXZ[i * 2 + 1] = rz;
            rainYPositions[i] = ry;
            rainSpeeds[i] = RAIN_SPEED + Math.random() * 1.5;
            dummy.position.set(rx, ry, rz);
            dummy.scale.set(1, 2 + Math.random(), 1); // elongate slightly for streak look
            dummy.updateMatrix();
            rainInstancedMesh.setMatrixAt(i, dummy.matrix);
          }
          rainInstancedMesh.instanceMatrix.needsUpdate = true;
          scene.add(rainInstancedMesh);
          created.push(rainInstancedMesh);
        }

        // Flash point light
        const flashLight = new THREE.PointLight(0x88ccff, 0, 20, 2);
        flashLight.position.set(posX, base.y + 6, posZ);
        flashLight.castShadow = false;
        scene.add(flashLight);
        created.push(flashLight);

        // --- Animate lightning + rain particles ---
        let strikeTimer = 2 + Math.random() * 2;
        let flashActive = false;
        let flashDuration = 0;
        const dummy = new THREE.Object3D();

        const animInterval = setInterval(() => {
          const dt = 0.016;

          // --- Rain particle animation ---
          if (rainInstancedMesh) {
            for (let i = 0; i < RAIN_COUNT; i++) {
              rainYPositions[i] -= rainSpeeds[i] * dt;
              if (rainYPositions[i] < RAIN_BOTTOM) {
                rainYPositions[i] = RAIN_TOP + Math.random() * 0.3;
                rainXZ[i * 2] = rainCenterX + (Math.random() - 0.5) * RAIN_AREA_W;
                rainXZ[i * 2 + 1] = rainCenterZ + (Math.random() - 0.5) * RAIN_AREA_D;
              }
              dummy.position.set(rainXZ[i * 2], rainYPositions[i], rainXZ[i * 2 + 1]);
              dummy.scale.set(1, 2 + Math.random(), 1);
              dummy.updateMatrix();
              rainInstancedMesh.setMatrixAt(i, dummy.matrix);
            }
            rainInstancedMesh.instanceMatrix.needsUpdate = true;
          }

          // --- Lightning strike timing ---
          strikeTimer -= dt;
          if (strikeTimer <= 0 && !flashActive) {
            flashActive = true;
            flashDuration = 0.15 + Math.random() * 0.1;
            for (const bolt of boltMeshes) bolt.visible = true;
            flashLight.intensity = 20;
            strikeTimer = 2 + Math.random() * 3;
          }
          if (flashActive) {
            flashDuration -= dt;
            flashLight.intensity *= 0.88;
            if (flashDuration <= 0) {
              flashActive = false;
              for (const bolt of boltMeshes) bolt.visible = false;
              flashLight.intensity = 0;
            }
          }
        }, 16);
        void animInterval;
      } catch (err) {
        console.warn('[VfxShowcase] Failed to load cloud_lightning.glb:', err);
      }
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
