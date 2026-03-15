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
    } = await import('three/tsl');
    const { mx_fractal_noise_float } = await import('three/tsl');

    // Helper constant — TSL float for PI
    const PI_VAL = float(Math.PI);

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
    // EFFECT B — FIRE WITH SMOKE
    // =====================================================================
    {
      const posX = base.x - 5;
      const posY = base.y + 1.5;
      const posZ = base.z;

      // --- Fire cylinder ---
      const fireGeo = new THREE.CylinderGeometry(0.8, 0.4, 3, 16, 16, true);
      const fireMat = new MeshBasicNodeMaterial();
      fireMat.transparent = true;
      fireMat.blending = THREE.AdditiveBlending;
      fireMat.depthWrite = false;
      fireMat.side = THREE.DoubleSide;

      // Scrolling UV for upward flame motion
      const fireUV = uv();
      const scrolledUV = fireUV.sub(vec2(0, time.mul(0.8)));

      // Two octaves of fractal noise for fire shape
      const noise1 = mx_fractal_noise_float(scrolledUV.mul(4.0));
      const noise2 = mx_fractal_noise_float(scrolledUV.mul(8.0).add(1.5));
      const fireMask = noise1.mul(0.7).add(noise2.mul(0.3));

      // Vertical fade: strongest in the middle, fades at top and bottom
      const vertFade = sin(fireUV.y.mul(PI_VAL)).pow(float(0.5));
      const fireAlpha = fireMask.mul(vertFade).clamp(0, 1);

      // Color gradient: white-yellow core → orange-red at edges
      const fireColor = mix(vec3(1, 0.9, 0.3), vec3(1, 0.2, 0), fireMask);

      fireMat.colorNode = fireColor;
      fireMat.opacityNode = fireAlpha;

      const fireMesh = new THREE.Mesh(fireGeo, fireMat);
      fireMesh.position.set(posX, posY, posZ);
      fireMesh.castShadow = false;
      scene.add(fireMesh);
      created.push(fireMesh);

      // --- Point light for ground illumination ---
      const fireLight = new THREE.PointLight(0xff6600, 8, 10, 2);
      fireLight.position.set(posX, base.y + 0.3, posZ);
      fireLight.castShadow = false;
      scene.add(fireLight);
      created.push(fireLight);

      // --- Dark smoke puffs above the fire ---
      const smokeOffsets = [2.5, 3.0, 3.5, 3.8];
      for (const yOff of smokeOffsets) {
        const smokeGeo = new THREE.SphereGeometry(
          0.25 + Math.random() * 0.15,
          8,
          8,
        );
        const smokeMat = new THREE.MeshStandardMaterial({
          color: 0x222222,
          transparent: true,
          opacity: 0.4,
        });
        const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
        smokeMesh.position.set(
          posX + (Math.random() - 0.5) * 0.6,
          posY + yOff,
          posZ + (Math.random() - 0.5) * 0.6,
        );
        smokeMesh.castShadow = false;
        scene.add(smokeMesh);
        created.push(smokeMesh);
      }
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
