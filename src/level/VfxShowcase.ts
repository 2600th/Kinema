import * as THREE from 'three';

export interface VfxShowcaseResult {
  objects: THREE.Object3D[];
  dispose: () => void;
}

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
): Promise<VfxShowcaseResult> {
  const created: THREE.Object3D[] = [];
  const intervalIds: ReturnType<typeof setInterval>[] = [];

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
      vec3,
      mix,
      step,
      abs,
      smoothstep,
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
    // EFFECT B — FIRE (Shadertoy Wtc3W2-inspired, continuous burning)
    // 7 PlaneGeometry sheets with multi-octave FBM noise fire shader
    // =====================================================================
    {
      const posX = base.x - 5;
      const posY = base.y + 0.2;
      const posZ = base.z;

      const fireGroup = new THREE.Group();
      fireGroup.position.set(posX, posY, posZ);
      scene.add(fireGroup);
      created.push(fireGroup);

      // --- WOOD LOGS (5 tilted cylinders like Shadertoy Wtc3W2) ---
      const logMat = new THREE.MeshStandardMaterial({
        color: 0x4a2810, roughness: 0.9, metalness: 0.0,
      });
      const logConfigs = [
        { pos: [0.15, 0.05, 0], rotY: 1.9, rotZ: 0.5, r: 0.08, len: 0.7 },
        { pos: [-0.1, 0.12, 0.1], rotY: -0.8, rotZ: 0.42, r: 0.06, len: 0.9 },
        { pos: [0.2, 0.1, -0.15], rotY: 0.4, rotZ: 0.3, r: 0.055, len: 0.5 },
        { pos: [-0.15, 0.18, -0.08], rotY: -2.1, rotZ: 0.35, r: 0.05, len: 0.8 },
        { pos: [0.05, 0.22, 0.12], rotY: 1.0, rotZ: 0.2, r: 0.05, len: 0.75 },
      ];
      for (const lc of logConfigs) {
        const logGeo = new THREE.CylinderGeometry(lc.r, lc.r * 1.05, lc.len, 8);
        const log = new THREE.Mesh(logGeo, logMat);
        log.position.set(lc.pos[0], lc.pos[1], lc.pos[2]);
        log.rotation.set(0, lc.rotY, lc.rotZ);
        log.castShadow = true;
        log.receiveShadow = true;
        fireGroup.add(log);
      }

      // --- ROCKS (ring of 6-8 around the fire base) ---
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x555555, roughness: 0.85, metalness: 0.0, flatShading: true,
      });
      const ROCK_COUNT = 7;
      const rockRingRadius = 0.65;
      for (let ri = 0; ri < ROCK_COUNT; ri++) {
        const angle = (ri / ROCK_COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const rockGeo = new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.06, 1);
        // Displace vertices slightly for natural shape
        const rpos = rockGeo.attributes.position;
        for (let vi = 0; vi < rpos.count; vi++) {
          rpos.setY(vi, rpos.getY(vi) * (0.5 + Math.random() * 0.3));
        }
        rpos.needsUpdate = true;
        rockGeo.computeVertexNormals();
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(
          Math.cos(angle) * rockRingRadius,
          -0.02,
          Math.sin(angle) * rockRingRadius,
        );
        rock.rotation.y = Math.random() * Math.PI;
        rock.castShadow = true;
        rock.receiveShadow = true;
        fireGroup.add(rock);
      }

      // --- EMBER BED (glowing disc at the base) ---
      const emberMat = new THREE.MeshStandardMaterial({
        color: 0x331100,
        emissive: 0xff4400,
        emissiveIntensity: 1.5,
        roughness: 0.9,
        metalness: 0.0,
      });
      const emberDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.45, 16),
        emberMat,
      );
      emberDisc.rotation.x = -Math.PI / 2;
      emberDisc.position.y = 0.01;
      emberDisc.receiveShadow = true;
      fireGroup.add(emberDisc);

      // --- EMBER PARTICLES (tiny hot sparks rising) ---
      const emberParticleCount = 40;
      const emberPositions = new Float32Array(emberParticleCount * 3);
      for (let e = 0; e < emberParticleCount; e++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3;
        emberPositions[e * 3] = Math.cos(a) * r;
        emberPositions[e * 3 + 1] = 0.2 + Math.random() * 1.5;
        emberPositions[e * 3 + 2] = Math.sin(a) * r;
      }
      const emberGeo = new THREE.BufferGeometry();
      emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
      const emberPMat = new THREE.PointsMaterial({
        color: 0xff6600, size: 0.04,
        blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false,
      });
      const emberPts = new THREE.Points(emberGeo, emberPMat);
      emberPts.castShadow = false;
      fireGroup.add(emberPts);

      // Animate embers rising
      const emberSpeeds = new Float32Array(emberParticleCount);
      for (let e = 0; e < emberParticleCount; e++) emberSpeeds[e] = 0.3 + Math.random() * 0.5;
      const emberInterval = setInterval(() => {
        const epos = (emberGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
        for (let e = 0; e < emberParticleCount; e++) {
          epos[e * 3 + 1] += emberSpeeds[e] * 0.016;
          epos[e * 3] += (Math.random() - 0.5) * 0.005;
          epos[e * 3 + 2] += (Math.random() - 0.5) * 0.005;
          if (epos[e * 3 + 1] > 2.5) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.3;
            epos[e * 3] = Math.cos(a) * r;
            epos[e * 3 + 1] = 0.1;
            epos[e * 3 + 2] = Math.sin(a) * r;
          }
        }
        (emberGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }, 16);
      intervalIds.push(emberInterval);

      // --- FIRE SHEETS (TSL volumetric flames above the logs) ---
      const flameWidth = 1.6;
      const flameHeight = 3.2;
      const SHEET_COUNT = 7;
      const flameGeo = new THREE.PlaneGeometry(flameWidth, flameHeight, 1, 1);
      flameGeo.translate(0, flameHeight * 0.5, 0); // pivot at base

      for (let i = 0; i < SHEET_COUNT; i++) {
        const phase = float(i * 0.73);
        const lateralBias = float((i - (SHEET_COUNT - 1) * 0.5) * 0.21);

        const flameMat = new MeshBasicNodeMaterial();
        flameMat.transparent = true;
        flameMat.side = THREE.DoubleSide;
        flameMat.depthWrite = false;
        flameMat.blending = THREE.AdditiveBlending;
        flameMat.forceSinglePass = true;

        // --- Fire alpha computation ---
        const v = uv();
        const centeredX = v.x.sub(0.5).mul(2.0);
        const t = time.mul(0.9).add(phase);

        // Sway
        const sway = sin(t.add(v.y.mul(5.5)).add(lateralBias)).mul(0.08)
          .add(cos(t.mul(1.37).sub(v.y.mul(7.0))).mul(0.045));

        // Width tapers from base (1.12) to tip (0.18)
        const flameW = mix(float(1.12), float(0.18), smoothstep(0.0, 1.0, v.y));
        const distortion = mix(float(0.35), float(1.15), v.y);
        const flameX = centeredX.add(sway.mul(distortion));
        const widthCoord = abs(flameX).div(flameW);

        // Multi-octave noise
        const nLarge = mx_fractal_noise_float(
          vec3(flameX.mul(1.15), v.y.mul(1.9).sub(t.mul(1.65)), t.mul(0.22).add(1.7))
        );
        const nMedium = mx_fractal_noise_float(
          vec3(flameX.mul(2.5).add(sway.mul(1.8)), v.y.mul(3.4).sub(t.mul(2.35)), t.mul(0.31).add(4.3))
        );
        const nFine = mx_fractal_noise_float(
          vec3(flameX.mul(5.3), v.y.mul(7.2).sub(t.mul(3.2)), t.mul(0.47).add(8.1))
        );

        // Body mask — aggressive horizontal falloff to hide plane edges
        // Use the raw centeredX distance (not divided by flameW) to ensure
        // alpha is zero well before the hard geometry edge at ±1.0
        const rawEdgeDist = abs(centeredX); // 0 at center, 1 at edge
        const edgeFade = float(1.0).sub(smoothstep(0.5, 0.92, rawEdgeDist));
        const bodyMask = float(1.0).sub(smoothstep(0.2, 0.85, widthCoord)).mul(edgeFade);

        // Noisy body
        const noisyBody = smoothstep(
          0.18, 0.95,
          nLarge.add(nMedium.mul(0.45)).sub(v.y.mul(0.18)).add(bodyMask.mul(0.42))
        );

        // Tip fade + breakup
        const tipFade = float(1.0).sub(smoothstep(0.82, 1.0, v.y));
        // Bottom fade — prevent hard line at base of plane
        const bottomFade = smoothstep(0.0, 0.08, v.y);
        const tipBreakMask = smoothstep(0.42, 1.0, v.y);
        const tipBreakup = smoothstep(
          -0.10, 0.85,
          nMedium.sub(widthCoord.mul(0.25)).add(nFine.mul(0.35))
        );

        const alpha = bodyMask
          .mul(noisyBody)
          .mul(tipFade)
          .mul(bottomFade)
          .mul(mix(float(1.0), tipBreakup, tipBreakMask))
          .clamp(0, 1);

        flameMat.opacityNode = alpha;

        // --- Fire color ramp based on heat ---
        const coreMask = float(1.0).sub(
          smoothstep(0.0, 0.55, abs(flameX).div(flameW.mul(0.78)))
        );
        const baseHeat = float(1.0).sub(smoothstep(0.0, 0.68, v.y));
        const heat = alpha.mul(0.65)
          .add(coreMask.mul(0.58))
          .add(baseHeat.mul(0.34))
          .sub(v.y.mul(0.15))
          .add(nFine.mul(0.06))
          .clamp(0, 1);

        // 4-stop color ramp: dark red → orange → yellow → white
        let fireColor = mix(
          vec3(0.10, 0.00, 0.00),
          vec3(0.52, 0.03, 0.00),
          smoothstep(0.02, 0.18, heat)
        );
        fireColor = mix(fireColor, vec3(1.00, 0.26, 0.00), smoothstep(0.16, 0.46, heat));
        fireColor = mix(fireColor, vec3(1.00, 0.76, 0.12), smoothstep(0.42, 0.78, heat));
        fireColor = mix(fireColor, vec3(1.00, 0.98, 0.92), smoothstep(0.78, 1.0, heat));

        flameMat.colorNode = fireColor.mul(alpha.mul(1.65).add(0.08));

        // Create sheet
        const sheet = new THREE.Mesh(flameGeo, flameMat);
        const angle = (i / SHEET_COUNT) * Math.PI * 2;
        const radialOffset = i % 2 === 0 ? 0.035 : 0.065;
        sheet.rotation.y = angle;
        sheet.position.set(
          Math.cos(angle) * radialOffset, 0,
          Math.sin(angle) * radialOffset
        );
        sheet.scale.set(
          1.0 + (i % 3 === 0 ? 0.10 : i % 3 === 1 ? -0.05 : 0.04),
          1.0 + (i % 2 === 0 ? 0.06 : -0.03),
          1
        );
        sheet.renderOrder = 10;
        sheet.castShadow = false;
        fireGroup.add(sheet);
      }

      // Point light for ground illumination
      const fireLight = new THREE.PointLight(0xff6600, 10, 12, 2);
      fireLight.position.set(posX, base.y + 1.0, posZ);
      fireLight.castShadow = false;
      scene.add(fireLight);
      created.push(fireLight);

      // Smoke sprites (keep existing Kenney texture approach)
      const smokeTexture = new THREE.TextureLoader().load('/assets/sprites/smoke_black.png');
      const SMOKE_COUNT = 10;
      const smokeMinY = 3.0;
      const smokeMaxY = 8.0;
      const smokeSprites: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; speed: number; baseX: number; baseZ: number; phase: number; startScale: number }[] = [];
      for (let s = 0; s < SMOKE_COUNT; s++) {
        const smokeMat = new THREE.SpriteMaterial({
          map: smokeTexture,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          color: 0x333338,
        });
        const sprite = new THREE.Sprite(smokeMat);
        const startY = smokeMinY + (s / SMOKE_COUNT) * (smokeMaxY - smokeMinY);
        const startScale = 0.6 + Math.random() * 0.4;
        sprite.scale.setScalar(startScale);
        sprite.position.set((Math.random() - 0.5) * 0.5, startY, (Math.random() - 0.5) * 0.5);
        fireGroup.add(sprite);
        smokeSprites.push({
          sprite, mat: smokeMat,
          speed: 0.4 + Math.random() * 0.3,
          baseX: sprite.position.x, baseZ: sprite.position.z,
          phase: Math.random() * Math.PI * 2, startScale,
        });
      }
      let smokeTime = 0;
      const smokeInterval = setInterval(() => {
        smokeTime += 0.016;
        for (const sp of smokeSprites) {
          sp.sprite.position.y += sp.speed * 0.016;
          sp.sprite.position.x = sp.baseX + Math.sin(smokeTime * 0.7 + sp.phase) * 0.3;
          sp.sprite.position.z = sp.baseZ + Math.cos(smokeTime * 0.5 + sp.phase) * 0.2;
          sp.mat.rotation += 0.004;
          const lifeT = (sp.sprite.position.y - smokeMinY) / (smokeMaxY - smokeMinY);
          sp.sprite.scale.setScalar(sp.startScale * (1.0 + lifeT * 2.5));
          sp.mat.opacity = Math.max(0, 0.4 * (1.0 - lifeT * lifeT));
          if (sp.sprite.position.y > smokeMaxY) {
            sp.sprite.position.y = smokeMinY;
            sp.sprite.position.x = (Math.random() - 0.5) * 0.5;
            sp.sprite.position.z = (Math.random() - 0.5) * 0.5;
            sp.baseX = sp.sprite.position.x;
            sp.baseZ = sp.sprite.position.z;
            sp.sprite.scale.setScalar(sp.startScale);
            sp.mat.opacity = 0.4;
          }
        }
      }, 16);
      intervalIds.push(smokeInterval);
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
        void (base.y + 3.5); // cloudWorldY — now computed from bounding box instead
        // The cloud model geometry is in Blender units (hundreds) — bounding box
        // values are enormous even after scaling. Use visual observation instead:
        // The cloud appears centered ~3 units right of posX, ~4 units above base.
        const rainCenterX = posX + 2.5;
        const rainCenterZ = posZ;

        const RAIN_COUNT = 200;
        const RAIN_AREA_W = 7.5;
        const RAIN_AREA_D = 5.4;
        const RAIN_TOP = base.y + 3.0;   // just below cloud visual bottom
        const RAIN_BOTTOM = base.y - 0.5;
        const RAIN_SPEED = 4.0;

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
        intervalIds.push(animInterval);
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

      // Slowly rotate the ring group
      const ringInterval = setInterval(() => {
        ringGroup.rotation.y += 0.008; // ~0.5 rad/s at 60fps
      }, 16);
      intervalIds.push(ringInterval);

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
    return { objects: [], dispose: () => {} };
  }

  return {
    objects: created,
    dispose: () => { for (const id of intervalIds) clearInterval(id); },
  };
}
