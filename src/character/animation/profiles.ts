import type { AnimationProfile } from './AnimationProfile';

const UAL1_URL = './assets/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const UAL2_URL = './assets/models/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';

export const PLAYER_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-player',
  modelUrl: UAL1_URL,
  animationUrls: [UAL1_URL, UAL2_URL],
  stateMap: {
    idle:     { clip: 'Idle_Loop',        loop: true },
    jump:     { clip: 'Jump_Start',       loop: false },
    air:      { clip: 'Jump_Loop',        loop: true },
    land:     { clip: 'Jump_Land',        loop: false },
    crouch:   { clip: 'Crouch_Idle_Loop', loop: true },
    interact: { clip: 'Interact',         loop: false },
    grab:     { clip: 'Push_Loop',        loop: true },
    airJump:  { clip: 'NinjaJump_Start', loop: false },
    climb:    { clip: 'ClimbUp_1m_RM',       loop: true },
    rope:     { clip: 'NinjaJump_Idle_Loop', loop: true },
  },
  locomotion: {
    walk: 'Walk_Loop',
    jog: 'Jog_Fwd_Loop',
    sprint: 'Sprint_Loop',
    thresholds: [2.0, 4.0],
  },
  crouchLocomotion: {
    idle: 'Crouch_Idle_Loop',
    moving: 'Crouch_Fwd_Loop',
  },
  carryLocomotion: {
    idle: 'Idle_Loop',
    moving: 'Walk_Carry_Loop',
  },
  fallbacks: {
    land: 'idle',
  },
  deathClip: 'Death01',
  throwClip: 'OverhandThrow',
};

export const NPC_PROFILE: AnimationProfile = {
  id: 'ual-mannequin-npc',
  modelUrl: UAL1_URL,
  animationUrls: [UAL1_URL],
  stateMap: {
    idle: { clip: 'Idle_Loop',  loop: true },
    move: { clip: 'Walk_Loop',  loop: true },
  },
};
