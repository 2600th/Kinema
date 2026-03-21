# Audio Overhaul — Astro Bot/Nintendo Style

## Context
The game has basic procedural audio via Tone.js but many interactions lack sound feedback, the music system is minimal (2 loops), and volume balance needs work. This spec defines a complete audio overhaul targeting the bright, bouncy, rewarding sonic personality of Astro Bot PS5 / Nintendo platformers.

## Sonic Personality
- **Bright**: High harmonics, clean sine/triangle tones, sparkle overtones
- **Bouncy**: Spring-like envelopes, upward pitch sweeps on positive actions
- **Rewarding**: Musical feedback (pentatonic chimes), satisfying "pop" on interactions
- **Alive**: Everything that moves makes sound, proportional to intensity

## Files to Modify
- `src/audio/SFXEngine.ts` — add 15+ new SFX methods, refine existing ones
- `src/audio/MusicEngine.ts` — complete rewrite with 4-layer dynamic system
- `src/audio/AudioManager.ts` — add new event bindings, rebalance gain chain

---

## New SFX Recipes (15 new sounds)

### Interaction Polish
| Sound | Synth | Oscillator | Envelope (ADSR) | Freq/Note | Volume | Trigger Event |
|-------|-------|-----------|-----------------|-----------|--------|---------------|
| `focusTick()` | Synth | triangle | 0.001/0.015/0/0.01 | C7 | -26dB | `interaction:focusChanged` (only when id != null) |
| `holdCharge(progress)` | Synth | sine | 0.01/0.1/0.8/0.1 | 200 + progress*600 Hz | -20 + progress*6 dB | `interaction:holdProgress` (on each threshold) |
| `interactBlocked()` | Synth | square | 0.005/0.08/0/0.05 | E4→C4 (two notes, 60ms apart) | -16dB | `interaction:blocked` |
| `drop()` | MembraneSynth | sine | 0.001/0.06/0/0.02 | C2 | -14dB | `interaction:drop` |
| `grabRelease()` | Synth | sine | 0.001/0.03/0/0.02 | A5 (descending to F5) | -18dB | `interaction:grabEnd` |

### Vehicle
| Sound | Synth | Type | Params | Volume | Event |
|-------|-------|------|--------|--------|-------|
| `vehicleEnter()` | NoiseSynth + Synth | noise sweep 500→3kHz + C6 chime | 150ms sweep + 50ms chime | -14dB | `vehicle:enter` |
| `vehicleExit()` | NoiseSynth + Synth | noise sweep 2kHz→300Hz + thud | 200ms sweep + G3 thud | -14dB | `vehicle:exit` |
| `droneRotorStart()` | Oscillator | triangle 220Hz + filtered white noise | Continuous, speed modulates pitch 180→400Hz | -16dB | `vehicle:engineStart` (when vehicle is drone) |
| `droneRotorUpdate(speed)` | (same osc) | triangle freq = 180 + speed*220 | Noise gain = 0.01 + speed*0.04 | — | `vehicle:speedUpdate` (drone) |
| `droneRotorStop()` | (same osc) | fade out 0.3s | — | — | `vehicle:engineStop` (drone) |

### Death/Respawn
| Sound | Synth | Technique | Duration | Volume | Event |
|-------|-------|-----------|----------|--------|-------|
| `deathDescend()` | Synth | Chromatic descent G4→C3, each note 50ms, square wave | 400ms total | -10dB | `player:dying` (replace deathPop) |
| `deathMidpoint()` | NoiseSynth + Reverb(wet:0.8) | Filtered noise burst with long reverb tail | 100ms burst + 1s tail | -16dB | `player:deathMidpoint` |

### Movement Polish
| Sound | Synth | Technique | Volume | Event/Trigger |
|-------|-------|-----------|--------|---------------|
| `crouchDown()` | NoiseSynth | Brown noise, bandpass 800Hz, 30ms | -22dB | Crouch state enter (in AudioManager fixedUpdate) |
| `crouchUp()` | NoiseSynth | Brown noise, bandpass 1200Hz, 25ms | -22dB | Crouch state exit |
| `slopeSlide(speed)` | NoiseSynth + Filter | Continuous white noise, comb filter, speed→cutoff | -20dB | Player sliding on steep slope |

---

## Existing SFX Refinements

### Volume Rebalance (all values in dBFS)
| Sound | Current | Target | Change |
|-------|---------|--------|--------|
| Jump tone | -10 | -8 | +2 (punchier) |
| Jump noise | -22 | -18 | +4 (more pop) |
| Air jump tone | -10 | -8 | +2 |
| Air jump sparkle | -18 | -14 | +4 (more shimmer) |
| Land soft noise | -16 | -14 | +2 |
| Land soft tone | -14 | -12 | +2 |
| Land hard | -14 to -6 | -12 to -4 | +2 (more impact) |
| Footstep | -20 to -16 | -18 to -14 | +2 |
| Interact | -12 | -10 | +2 |
| Checkpoint | -10 | -8 | +2 (more rewarding) |
| Objective complete | -8 | -6 | +2 |
| Grab | -14/-22 | -12/-18 | +2/+4 |
| Throw | -14 | -12 | +2 |
| Death | -12 | -10 | +2 (reworked entirely) |
| Respawn chime | -18 | -12 | +6 (was too quiet) |
| Engine base/sub | -12/-18 | -10/-14 | +2/+4 |
| Menu open/close | -18 | -16 | +2 |
| UI click | -16 | -18 | -2 (subtler) |
| UI hover | -24 | -26 | -2 (subtler) |

### Synth Improvements
- **Jump**: Change oscillator from sine to triangle for brighter, bouncier character. Add pitch envelope 300→900Hz (wider sweep).
- **Checkpoint**: Use FMSynth instead of PolySynth for warmer, more musical tone. Add slight chorus effect.
- **Respawn**: Change from descending (sad) to ascending (hopeful). C5→E5→G5→C6.
- **Death**: Replace simple pop with dramatic descending chromatic run. More character, less harsh.

---

## Music System Rewrite

### Architecture
Replace current 2-loop system (pad chords + occasional melody) with a 4-layer dynamic engine:

```
Layer 1: Pad (always playing)     — warm sine pads, long envelopes
Layer 2: Bass (idle+)             — pentatonic walking bass, PluckSynth
Layer 3: Melody (moving+)         — triangle/sine lead, pentatonic phrases
Layer 4: Percussion (action+)     — soft marimba-like hits, MetalSynth
```

### Musical Parameters
- **Tempo**: 72 BPM (current 55 is too sleepy for Astro Bot feel)
- **Scale**: C major pentatonic (C D E G A) — same as current but wider octave range
- **Chord progression**: I → vi → IV → V (C → Am → F → G) using pentatonic voicings
- **Key changes**: Every 4 bars, 50% chance to shift to G major pentatonic (G A B D E)

### Layer Synth Configs
| Layer | Synth | Oscillator | Envelope | Volume | Loop Interval |
|-------|-------|-----------|----------|--------|---------------|
| Pad | PolySynth(AMSynth) | sine carrier, triangle mod | A:2s D:3s S:0.4 R:4s | -16dB | 2n (half note) |
| Bass | PluckSynth | — | attackNoise:1, resonance:0.8, release:0.6 | -14dB | 4n (quarter note) |
| Melody | FMSynth | sine carrier, triangle mod | A:0.05 D:0.3 S:0.2 R:0.8 | -18dB | 4n (quarter, 40% rest) |
| Percussion | MetalSynth | — | A:0.001 D:0.1 S:0 R:0.08 | -20dB | 8n (eighth note, 60% rest) |

### Dynamic Intensity
```typescript
setIntensity(value: 0..1):
  0.0-0.25: Pad only (idle, menu, editor)
  0.25-0.5: Pad + Bass (walking around)
  0.5-0.75: Pad + Bass + Melody (active gameplay)
  0.75-1.0: All 4 layers (action, vehicle, combat)
```

Intensity driven by:
- Player speed (planar velocity mapped to 0-0.5)
- Vehicle active (+0.3)
- Near checkpoint/objective (+0.2)
- In air (+0.1)

### Effects Chain
```
All layers → AutoFilter(0.06Hz, base:300, oct:3, wet:0.3)
           → FeedbackDelay(4n, fb:0.3, wet:0.25)
           → Reverb(decay:6, wet:0.5)
           → Compressor(threshold:-18, ratio:2.5)
           → Limiter(-1)
           → output
```

---

## Master Mix Bus

### Gain Structure
```
Tone.Destination
  └─ masterGain (0 dB)
       └─ Compressor(threshold:-24, ratio:3, attack:3ms, release:120ms)
            └─ Limiter(threshold:-1)
                 ├─ sfxGain (-2 dB relative)
                 │    └─ SFXEngine.output
                 └─ musicGain (-6 dB relative)
                      └─ MusicEngine.output
```

### Category Targets (peak dBFS)
| Category | Target | Notes |
|----------|--------|-------|
| Music bed | -18 dB | Sits underneath, never fights SFX |
| SFX gameplay (jump, land, interact) | -12 dB | Primary feedback, punchy |
| SFX UI (click, hover, menu) | -20 dB | Subtle, never jarring |
| SFX vehicle | -10 dB | Prominent when driving |
| Master peak | -1 dBFS | Hard limited |

### Ducking
- Pause menu: music ducks to 30% (existing)
- Death sequence: music ducks to 50% for 1.5s
- Checkpoint/objective: music brief duck to 60% for 0.5s (let chime shine)

---

## Event Bindings (new in AudioManager)

```typescript
// New bindings to add in bindEvents():
'interaction:focusChanged'  → if (id != null) sfxEngine.focusTick()
'interaction:holdProgress'  → sfxEngine.holdCharge(progress) on thresholds
'interaction:blocked'       → sfxEngine.interactBlocked()
'interaction:drop'          → sfxEngine.drop()
'interaction:grabEnd'       → sfxEngine.grabRelease()
'vehicle:enter'             → sfxEngine.vehicleEnter()
'vehicle:exit'              → sfxEngine.vehicleExit()
'player:deathMidpoint'      → sfxEngine.deathMidpoint()

// Drone vs car detection:
// VehicleManager emits vehicle:engineStart — AudioManager checks vehicle type
// Store current vehicle type from vehicle:enter event payload
```

---

## Implementation Order
1. SFXEngine — add all new methods, refine existing volumes/envelopes
2. AudioManager — add new event bindings, update gain chain with compressor/limiter
3. MusicEngine — complete rewrite with 4-layer system
4. Integration testing — play through all stations, verify all sounds fire

## Verification
- Every event in EventMap that starts with `interaction:`, `vehicle:`, `player:` has audio
- No Tone.js console errors during gameplay
- Volume levels feel balanced in headphones
- Music responds to player activity (intensity changes)
- `npx tsc --noEmit && npx vite build` passes
