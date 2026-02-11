import * as THREE from 'three';
import type { EventBus } from '@core/EventBus';
import type { FixedUpdatable, Updatable, Disposable } from '@core/types';
import type { RendererManager } from '@renderer/RendererManager';
import type { PhysicsWorld } from '@physics/PhysicsWorld';
import type { InputManager } from '@input/InputManager';
import type { LevelManager } from '@level/LevelManager';
import type { PlayerController } from '@character/PlayerController';
import type { OrbitFollowCamera } from '@camera/OrbitFollowCamera';
import type { InteractionManager } from '@interaction/InteractionManager';
import type { UIManager } from '@ui/UIManager';
import { Door } from '@interaction/interactables/Door';

// Temp vector for speed calculation
const _prevPos = new THREE.Vector3();
const _currPos = new THREE.Vector3();

/**
 * Top-level orchestrator.
 * Wires all systems together and delegates to the game loop.
 */
export class Game implements FixedUpdatable, Updatable, Disposable {
  private speed = 0;
  private prevPlayerPos = new THREE.Vector3();
  private _onDebugKeyDown = this.handleDebugKeyDown.bind(this);

  constructor(
    private renderer: RendererManager,
    private physicsWorld: PhysicsWorld,
    private eventBus: EventBus,
    private inputManager: InputManager,
    private levelManager: LevelManager,
    private playerController: PlayerController,
    private camera: OrbitFollowCamera,
    private interactionManager: InteractionManager,
    private uiManager: UIManager,
  ) {
    // Listen for interact state to trigger interactions
    this.eventBus.on('player:stateChanged', ({ current }) => {
      if (current === 'interact') {
        this.interactionManager.refreshFocusFromPosition(this.playerController.position);
        this.interactionManager.triggerInteraction();
      }
    });

    // Debug toggle on backtick
    window.addEventListener('keydown', this._onDebugKeyDown);

    // Create a sample door interactable
    this.spawnInteractables();
  }

  /** Fixed 60Hz tick. */
  fixedUpdate(dt: number): void {
    // Poll input — captures accumulated mouse deltas
    const input = this.inputManager.poll();

    // Apply mouse deltas to camera (consumed here, not in render loop)
    this.camera.handleMouseInput(input.mouseDeltaX, input.mouseDeltaY);
    this.camera.handleZoomInput(input.mouseWheelDelta);

    // Update dynamic level elements (moving platforms, etc.)
    this.levelManager.fixedUpdate(dt);

    // Interaction detection first — ensures focus is current before player FSM runs
    this.interactionManager.fixedUpdate(dt);

    // Feed input + camera yaw to player
    this.playerController.cameraYaw = this.camera.getYaw();
    this.playerController.setLadderZones(this.levelManager.getLadderZones());
    this.playerController.setInput(input);
    this.playerController.fixedUpdate(dt);

    // Speed calculation (for debug)
    _prevPos.copy(this.prevPlayerPos);
    _currPos.copy(this.playerController.position);
    const dx = _currPos.x - _prevPos.x;
    const dz = _currPos.z - _prevPos.z;
    this.speed = Math.sqrt(dx * dx + dz * dz) / dt;
    this.prevPlayerPos.copy(_currPos);
  }

  /** Render-frame tick. */
  update(dt: number, alpha: number): void {
    // Update visual interpolation
    this.playerController.update(dt, alpha);
    this.levelManager.updateLighting(this.playerController.position);

    // Camera follows player (runs every render frame for smoothness)
    this.camera.update(dt, alpha);

    // Debug panel
    this.uiManager.debugPanel.tick(
      this.speed,
      this.playerController.fsm.current,
      this.playerController.isGrounded,
    );
  }

  private spawnInteractables(): void {
    const door = new Door(
      'door1',
      new THREE.Vector3(5, -1, -5),
      this.renderer.scene,
      this.physicsWorld,
    );
    this.interactionManager.register(door);
  }

  private handleDebugKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      this.eventBus.emit('debug:toggle', undefined);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this._onDebugKeyDown);
    this.interactionManager.dispose();
    this.playerController.dispose();
    this.camera.dispose();
    this.uiManager.dispose();
    this.levelManager.dispose();
    this.inputManager.dispose();
    this.physicsWorld.dispose();
    this.renderer.dispose();
    this.eventBus.clear();
  }
}
