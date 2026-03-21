import * as THREE from 'three';
import type { Disposable, StateId } from '@core/types';
import { STATE } from '@core/types';
import type { AnimationProfile } from './AnimationProfile';
import type { CharacterModel } from './CharacterModel';

const FADE_LOCOMOTION = 0.15;
const FADE_ACTION = 0.1;
const FADE_LAND = 0.08;

const WALK_AUTHORED_SPEED = 1.5;
const JOG_AUTHORED_SPEED = 3.5;
const SPRINT_AUTHORED_SPEED = 6.5;

const WEIGHT_LAMBDA = 8;
const SPEED_SWITCH_THRESHOLD = 0.1;

export class AnimationController implements Disposable {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentState: StateId | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private speed = 0;

  private locoWalk: THREE.AnimationAction | null = null;
  private locoJog: THREE.AnimationAction | null = null;
  private locoSprint: THREE.AnimationAction | null = null;
  private locoWeights = { walk: 0, jog: 0, sprint: 0 };
  private locoTargetWeights = { walk: 0, jog: 0, sprint: 0 };
  private locoActive = false;
  private oneShotActive = false;

  private crouchIdleAction: THREE.AnimationAction | null = null;
  private crouchMoveAction: THREE.AnimationAction | null = null;
  private carryIdleAction: THREE.AnimationAction | null = null;
  private carryMoveAction: THREE.AnimationAction | null = null;

  // Speed-switch smooth weight tracking
  private crouchIdleWeight = 1;
  private crouchMoveWeight = 0;
  private carryIdleWeight = 1;
  private carryMoveWeight = 0;

  constructor(
    private model: CharacterModel,
    private profile: AnimationProfile,
  ) {
    this.mixer = new THREE.AnimationMixer(model.root);
    this.buildActions();
    this.setState(STATE.idle);
  }

  private buildActions(): void {
    const { stateMap, locomotion, crouchLocomotion, carryLocomotion } = this.profile;
    const clips = this.model.clips;

    for (const [stateId, clipDef] of Object.entries(stateMap)) {
      const clip = clips.get(clipDef!.clip);
      if (!clip) {
        console.warn(`[AnimationController] Clip "${clipDef!.clip}" not found for state "${stateId}"`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.loop = clipDef!.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = !clipDef!.loop;
      if (clipDef!.timeScale != null) action.timeScale = clipDef!.timeScale;
      action.weight = 0;
      action.play();
      this.actions.set(stateId, action);
    }

    if (locomotion) {
      this.locoWalk = this.createLocoAction(locomotion.walk);
      this.locoJog = this.createLocoAction(locomotion.jog);
      this.locoSprint = this.createLocoAction(locomotion.sprint);
    }

    if (crouchLocomotion) {
      this.crouchIdleAction = this.createLocoAction(crouchLocomotion.idle);
      this.crouchMoveAction = this.createLocoAction(crouchLocomotion.moving);
    }

    if (carryLocomotion) {
      this.carryIdleAction = this.createLocoAction(carryLocomotion.idle);
      this.carryMoveAction = this.createLocoAction(carryLocomotion.moving);
    }
  }

  private createLocoAction(clipName: string): THREE.AnimationAction | null {
    const originalClip = this.model.clips.get(clipName);
    if (!originalClip) {
      console.warn(`[AnimationController] Locomotion clip "${clipName}" not found`);
      return null;
    }
    // Clone to avoid sharing AnimationAction with stateMap entries using the same clip
    const clip = originalClip.clone();
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.loop = THREE.LoopRepeat;
    action.weight = 0;
    action.play();
    return action;
  }

  setState(state: StateId): void {
    if (this.oneShotActive) return;
    if (state === this.currentState) return;

    const prevState = this.currentState;
    this.currentState = state;

    const fadeDuration = state === STATE.land ? FADE_LAND
      : (state === STATE.move || state === STATE.idle) ? FADE_LOCOMOTION
      : FADE_ACTION;

    if (prevState === STATE.move && state !== STATE.move) {
      this.deactivateLocomotion(fadeDuration);
    }
    if (prevState === STATE.crouch && state !== STATE.crouch) {
      this.deactivateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, fadeDuration);
    }
    if (prevState === STATE.carry && state !== STATE.carry) {
      this.deactivateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, fadeDuration);
    }

    if (state === STATE.move && this.profile.locomotion) {
      this.activateLocomotion(fadeDuration);
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    if (state === STATE.crouch && this.profile.crouchLocomotion) {
      this.activateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, fadeDuration);
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    if (state === STATE.carry && this.profile.carryLocomotion) {
      this.activateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, fadeDuration);
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = null;
      }
      return;
    }

    const nextAction = this.resolveAction(state);
    if (!nextAction) return;

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(fadeDuration);
    }
    nextAction.reset().fadeIn(fadeDuration).play();
    this.currentAction = nextAction;
  }

  setSpeed(horizontalSpeed: number): void {
    this.speed = horizontalSpeed;

    if (this.locoActive && this.profile.locomotion) {
      const [t0, t1] = this.profile.locomotion.thresholds;
      // Three-zone blend: walk↔jog in lower half, jog↔sprint in upper half
      const mid = (t0 + t1) * 0.5;
      if (horizontalSpeed <= t0) {
        this.locoTargetWeights.walk = 1;
        this.locoTargetWeights.jog = 0;
        this.locoTargetWeights.sprint = 0;
      } else if (horizontalSpeed <= mid) {
        const t = (horizontalSpeed - t0) / (mid - t0);
        this.locoTargetWeights.walk = 1 - t;
        this.locoTargetWeights.jog = t;
        this.locoTargetWeights.sprint = 0;
      } else if (horizontalSpeed <= t1) {
        const t = (horizontalSpeed - mid) / (t1 - mid);
        this.locoTargetWeights.walk = 0;
        this.locoTargetWeights.jog = 1 - t;
        this.locoTargetWeights.sprint = t;
      } else {
        this.locoTargetWeights.walk = 0;
        this.locoTargetWeights.jog = 0;
        this.locoTargetWeights.sprint = 1;
      }

      if (this.locoWalk) this.locoWalk.timeScale = Math.max(0.1, horizontalSpeed / WALK_AUTHORED_SPEED);
      if (this.locoJog) this.locoJog.timeScale = Math.max(0.1, horizontalSpeed / JOG_AUTHORED_SPEED);
      if (this.locoSprint) this.locoSprint.timeScale = Math.max(0.1, horizontalSpeed / SPRINT_AUTHORED_SPEED);
    }

    if (this.currentState === STATE.crouch && this.crouchIdleAction && this.crouchMoveAction) {
      this.updateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, horizontalSpeed, 'crouchIdleWeight', 'crouchMoveWeight');
    }

    if (this.currentState === STATE.carry && this.carryIdleAction && this.carryMoveAction) {
      this.updateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, horizontalSpeed, 'carryIdleWeight', 'carryMoveWeight');
    }
  }

  isClipFinished(): boolean {
    if (!this.currentAction) return false;
    if (this.currentAction.loop !== THREE.LoopOnce) return false;
    const clip = this.currentAction.getClip();
    return this.currentAction.time >= clip.duration - 1e-4;
  }

  /** Play a one-shot animation clip, overriding current FSM animation (e.g., death). */
  playOneShot(clipName: string, fadeDuration = 0.2): void {
    const originalClip = this.model.clips.get(clipName);
    if (!originalClip) {
      console.warn(`[AnimationController] OneShot clip "${clipName}" not found`);
      return;
    }
    if (this.currentAction) this.currentAction.fadeOut(fadeDuration);
    if (this.locoActive) this.deactivateLocomotion(fadeDuration);
    this.deactivateSpeedSwitch(this.crouchIdleAction, this.crouchMoveAction, fadeDuration);
    this.deactivateSpeedSwitch(this.carryIdleAction, this.carryMoveAction, fadeDuration);

    const action = this.mixer.clipAction(originalClip.clone());
    action.reset();
    action.loop = THREE.LoopOnce;
    action.clampWhenFinished = true;
    action.fadeIn(fadeDuration).play();
    this.currentAction = action;
    this.oneShotActive = true;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.locoActive) {
      const factor = 1 - Math.exp(-WEIGHT_LAMBDA * dt);
      this.locoWeights.walk += (this.locoTargetWeights.walk - this.locoWeights.walk) * factor;
      this.locoWeights.jog += (this.locoTargetWeights.jog - this.locoWeights.jog) * factor;
      this.locoWeights.sprint += (this.locoTargetWeights.sprint - this.locoWeights.sprint) * factor;

      if (this.locoWalk) this.locoWalk.setEffectiveWeight(this.locoWeights.walk);
      if (this.locoJog) this.locoJog.setEffectiveWeight(this.locoWeights.jog);
      if (this.locoSprint) this.locoSprint.setEffectiveWeight(this.locoWeights.sprint);
    }

    // Smooth speed-switch weight interpolation for crouch/carry
    if (this.currentState === STATE.crouch && this.crouchIdleAction && this.crouchMoveAction) {
      const f = 1 - Math.exp(-WEIGHT_LAMBDA * dt);
      const curIdle = this.crouchIdleAction.getEffectiveWeight();
      const curMove = this.crouchMoveAction.getEffectiveWeight();
      this.crouchIdleAction.setEffectiveWeight(curIdle + (this.crouchIdleWeight - curIdle) * f);
      this.crouchMoveAction.setEffectiveWeight(curMove + (this.crouchMoveWeight - curMove) * f);
    }
    if (this.currentState === STATE.carry && this.carryIdleAction && this.carryMoveAction) {
      const f = 1 - Math.exp(-WEIGHT_LAMBDA * dt);
      const curIdle = this.carryIdleAction.getEffectiveWeight();
      const curMove = this.carryMoveAction.getEffectiveWeight();
      this.carryIdleAction.setEffectiveWeight(curIdle + (this.carryIdleWeight - curIdle) * f);
      this.carryMoveAction.setEffectiveWeight(curMove + (this.carryMoveWeight - curMove) * f);
    }

    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model.root);
    this.actions.clear();
    this.currentAction = null;
    this.locoWalk = null;
    this.locoJog = null;
    this.locoSprint = null;
  }

  private resolveAction(state: StateId): THREE.AnimationAction | null {
    const direct = this.actions.get(state);
    if (direct) return direct;
    const fallback = this.profile.fallbacks?.[state];
    if (fallback) {
      const fallbackAction = this.actions.get(fallback);
      if (fallbackAction) return fallbackAction;
    }
    return this.actions.get(STATE.idle) ?? null;
  }

  private activateLocomotion(_fadeDuration: number): void {
    this.locoActive = true;
    this.setSpeed(this.speed);
    // Start at zero — the exponential smoother in update() ramps to target
    this.locoWeights.walk = 0;
    this.locoWeights.jog = 0;
    this.locoWeights.sprint = 0;

    if (this.locoWalk) { this.locoWalk.reset().play(); this.locoWalk.setEffectiveWeight(0); }
    if (this.locoJog) { this.locoJog.reset().play(); this.locoJog.setEffectiveWeight(0); }
    if (this.locoSprint) { this.locoSprint.reset().play(); this.locoSprint.setEffectiveWeight(0); }
  }

  private deactivateLocomotion(fadeDuration: number): void {
    this.locoActive = false;
    if (this.locoWalk) this.locoWalk.fadeOut(fadeDuration);
    if (this.locoJog) this.locoJog.fadeOut(fadeDuration);
    if (this.locoSprint) this.locoSprint.fadeOut(fadeDuration);
  }

  private activateSpeedSwitch(
    idleAction: THREE.AnimationAction | null,
    moveAction: THREE.AnimationAction | null,
    _fadeDuration: number,
  ): void {
    const moving = this.speed > SPEED_SWITCH_THRESHOLD;
    if (idleAction) { idleAction.reset().play(); idleAction.setEffectiveWeight(moving ? 0 : 1); }
    if (moveAction) { moveAction.reset().play(); moveAction.setEffectiveWeight(moving ? 1 : 0); }
  }

  private deactivateSpeedSwitch(
    idleAction: THREE.AnimationAction | null,
    moveAction: THREE.AnimationAction | null,
    fadeDuration: number,
  ): void {
    if (idleAction) idleAction.fadeOut(fadeDuration);
    if (moveAction) moveAction.fadeOut(fadeDuration);
  }

  private updateSpeedSwitch(
    _idleAction: THREE.AnimationAction,
    moveAction: THREE.AnimationAction,
    speed: number,
    idleWeightKey: 'crouchIdleWeight' | 'carryIdleWeight',
    moveWeightKey: 'crouchMoveWeight' | 'carryMoveWeight',
  ): void {
    // Store target weights — actual interpolation happens in update()
    this[idleWeightKey] = speed > SPEED_SWITCH_THRESHOLD ? 0 : 1;
    this[moveWeightKey] = speed > SPEED_SWITCH_THRESHOLD ? 1 : 0;
    if (speed > SPEED_SWITCH_THRESHOLD) {
      moveAction.timeScale = Math.max(0.1, speed / WALK_AUTHORED_SPEED);
    } else {
      moveAction.timeScale = 1.0;
    }
  }
}
