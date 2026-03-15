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
      const flameGeo = new THREE.PlaneGeometry(1.0, 2.5, 1, 12);

      for (let i = 0; i < FLAME_COUNT; i++) {
        const flameMat = new MeshBasicNodeMaterial();
        flameMat.transparent = true;
        flameMat.blending = THREE.AdditiveBlending;
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

      // --- Smoke puffs above the fire (improved with node material) ---
      const smokeOffsets = [2.8, 3.4, 4.0, 4.5, 5.0];
      for (let s = 0; s < smokeOffsets.length; s++) {
        const yOff = smokeOffsets[s];
        const smokeGeo = new THREE.SphereGeometry(
          0.2 + Math.random() * 0.2,
          8,
          8,
        );
        const smokeMat = new MeshBasicNodeMaterial();
        smokeMat.transparent = true;
        smokeMat.depthWrite = false;

        // Dark wispy smoke with slight noise-driven opacity variation
        const smokeSeed = float(s * 2.3 + 7.0);
        const smokeNoise = mx_fractal_noise_float(
          positionLocal.mul(2.0).add(vec3(0, time.mul(0.3), smokeSeed)),
        );
        smokeMat.colorNode = vec3(0.08, 0.08, 0.1);
        // Fade out higher smoke puffs more
        const heightRatio = float(1.0 - (yOff - 2.8) / 2.5);
        smokeMat.opacityNode = smokeNoise
          .mul(0.5)
          .add(0.5)
          .mul(0.35)
          .mul(heightRatio)
          .clamp(0, 0.4);

        const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
        smokeMesh.position.set(
          (Math.random() - 0.5) * 0.5,
          yOff,
          (Math.random() - 0.5) * 0.5,
        );
        smokeMesh.castShadow = false;
        fireGroup.add(smokeMesh);
      }

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
      const posY = base.y + 2.5;
      const posZ = base.z;

      // --- Lightning bolt plane ---
      const boltGeo = new THREE.PlaneGeometry(0.5, 4, 1, 20);
      const boltMat = new MeshBasicNodeMaterial();
      boltMat.transparent = true;
      boltMat.blending = THREE.AdditiveBlending;
      boltMat.depthWrite = false;
      boltMat.side = THREE.DoubleSide;

      // Vertex displacement: zigzag the X position based on Y + time noise
      const vertY = positionLocal.y;
      const zigzag = sin(vertY.mul(8.0).add(time.mul(15.0))).mul(0.3);
      boltMat.positionNode = vec3(
        positionLocal.x.add(zigzag),
        positionLocal.y,
        positionLocal.z,
      );

      // Color: bright white-blue with a fast flicker
      const flicker = sin(time.mul(25.0)).mul(0.4).add(0.6);
      boltMat.colorNode = vec3(0.7, 0.85, 1.0).mul(flicker.mul(2.0));
      boltMat.opacityNode = flicker;

      const boltMesh = new THREE.Mesh(boltGeo, boltMat);
      boltMesh.position.set(posX, posY, posZ);
      boltMesh.castShadow = false;
      scene.add(boltMesh);
      created.push(boltMesh);

      // --- Rain particles ---
      const rainCount = 200;
      const rainPositions = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        const i3 = i * 3;
        rainPositions[i3] = (Math.random() - 0.5) * 6;     // X: +-3
        rainPositions[i3 + 1] = Math.random() * 4;           // Y: 0..4
        rainPositions[i3 + 2] = (Math.random() - 0.5) * 6;  // Z: +-3
      }

      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(rainPositions, 3),
      );

      const rainMat = new THREE.PointsMaterial({
        color: 0xaabbcc,
        size: 0.05,
        transparent: true,
        opacity: 0.6,
      });

      const rainPoints = new THREE.Points(rainGeo, rainMat);
      rainPoints.position.set(posX, posY - 1, posZ);
      rainPoints.castShadow = false;
      scene.add(rainPoints);
      created.push(rainPoints);

      // --- Cloud plane ---
      const cloudGeo = new THREE.PlaneGeometry(8, 6);
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0x334455,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      cloudMesh.position.set(posX, base.y + 5, posZ);
      cloudMesh.rotation.x = -Math.PI / 2;
      cloudMesh.castShadow = false;
      scene.add(cloudMesh);
      created.push(cloudMesh);

      // --- Lightning flash point light ---
      const lightningLight = new THREE.PointLight(0x88ccff, 0, 15, 2);
      lightningLight.position.set(posX, posY + 1, posZ);
      lightningLight.castShadow = false;
      scene.add(lightningLight);
      created.push(lightningLight);

      // Periodic flash: ramp intensity up and down
      let flashTimer = 0;
      const flashInterval = setInterval(() => {
        flashTimer += 0.05;
        if (flashTimer < 0.2) {
          lightningLight.intensity = 15;
        } else if (flashTimer < 0.4) {
          lightningLight.intensity = 0;
        } else if (flashTimer < 0.5) {
          lightningLight.intensity = 10;
        } else {
          lightningLight.intensity = 0;
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

      // Note: The intervals will keep running for the lifetime of the page.
      // If cleanup is needed, the caller can remove the light from the scene.
      // The setInterval reference is intentionally not stored since VFX
      // persist for the level's lifetime.
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
