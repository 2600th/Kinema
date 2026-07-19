# KIN-020 Settings Integrity And Comfort Design

## Goal

Kinema's Settings menu must be a truthful, persistent control surface. Every value shown in
the menu must represent stored user intent, apply immediately to its owning runtime system,
survive reload, and preserve today's behavior at defaults. KIN-020 also adds accessibility-
oriented motion, flash, hold/toggle, remapping, and device-look controls.

## Architecture

`UserSettingsStore` remains the only persistent source of user preference. Runtime systems do
not infer settings from their current effective state. This matters for compatibility renderers,
where an effect may be requested but unsupported, and for the master post-processing switch,
which can temporarily mask subordinate effect choices.

A new pure `InputBindings` module owns the rebindable action type, cloned defaults, validation,
display labels, reserved-key policy, conflict swapping, and reset behavior. `UserSettings`,
`InputManager`, prompt glyph rendering, Help, and Settings consume that shared contract. There
is no mutable global glyph table and no second persistence store.

Settings apply at two boundaries:

1. Bootstrap loads and sanitizes settings, applies the graphics profile, atomically applies
   persisted graphics overrides, then initializes input, camera, touch, HUD, and motion state.
2. A Settings-menu change is persisted first and immediately passed to the owning subsystem.

## Persistence And Graphics Integrity

The existing storage key remains additive-compatible. New fields are accepted only when their
runtime types are valid; missing or invalid values receive deterministic defaults. Legacy saves
seed missing post-effect flags from the saved profile rather than from renderer-effective debug
state.

The six requested flags are:

- post-processing
- SSAO
- SSR
- bloom
- vignette
- LUT

Bootstrap and every user-facing profile change apply the profile first and the six sticky user
overrides second. A renderer batch API applies structural changes through one mutation boundary
and performs at most one pipeline rebuild. Profile switching also reapplies persisted AA and CAS
choices so those existing controls remain truthful.

The Settings menu reads requested values from the store. An unsupported effect remains checked
according to user intent but is disabled with an explanatory capability message; the application
does not silently rewrite it to false.

## Ranges

Range metadata is exported once and reused by parsing and UI controls:

| Setting | Minimum | Maximum | Step | Default |
| --- | ---: | ---: | ---: | ---: |
| Mouse sensitivity | 0.0005 | 0.01 | 0.0001 | existing value |
| Gamepad deadzone | 0.02 | 0.4 | 0.01 | existing value |
| Gamepad curve | 0.6 | 3 | 0.1 | existing value |
| Camera FOV | 50 | 90 | 1 | existing value |
| Gamepad look sensitivity | 6 | 30 | 1 | 18 |
| Touch look sensitivity | 1 | 8 | 0.25 | 4 |
| Resolution scale | 0.5 | 1 | 0.05 | existing value |
| Environment rotation | -180 | 180 | 1 | existing value |
| CAS, camera effects, damage flash, and volumes | 0 | 1 | 0.05 or 0.01 | existing/1 |

Sanitization clamps persisted numbers to these same endpoints before labels and range inputs are
constructed.

## Keyboard Remapping

The rebindable actions are move forward, move backward, move left, move right, jump, interact,
crouch, and sprint. Bindings store `KeyboardEvent.code`, preserving the existing layout-independent
input model. Existing alternates remain part of the map: arrow movement, left Control crouch, and
right Shift sprint.

The UI captures the next key for the selected primary slot. Escape cancels, the current code is a
no-op, and a collision swaps the exact owning slot with the target action's previous primary so
duplicates are impossible. Reset replaces the full map with a fresh clone of defaults.

Tab and application-owned keys such as Escape, Backquote, F1, F6–F11, plus hard-coded vehicle
altitude keys outside this remap scope, are rejected with an inline explanation. Updated bindings
apply immediately to gameplay, interaction prompts, and Help labels.

## Hold And Toggle

Sprint and crouch each persist `hold` or `toggle`, defaulting to `hold`. Toggle changes only on a
rising edge and clears on menu/editor entry, pointer-lock loss, respawn, or a control-context
transition. The setting applies to character traversal, including traversal contexts where holding
the semantic action is an accessibility burden. Vehicle uses of the shared raw buttons—handbrake,
descend, reset, and boost—remain hold-based and cannot inherit a stale latch.

## Motion And Flash Comfort

Camera-effects intensity ranges from zero to one and defaults to one. Camera springs, trauma,
and timers continue advancing at every intensity; only their output contributions are scaled.
Scaled contributions include landing dip, look-ahead, lateral and drift displacement, dynamic
FOV and FOV punches, vehicle motion offsets, and positional/rotational screen shake. Collision
correction, ordinary follow, crouch height, zoom, and manual orbit remain functional.

Reduced Motion has three states:

- System follows `prefers-reduced-motion`.
- On forces camera-effect output to zero and activates reduced decorative UI animation.
- Off ignores the OS preference and uses the chosen camera-effects intensity.

It does not silently alter the stored intensity. Damage flash remains independently adjustable.
Damage-flash intensity linearly scales peak opacity and duration; zero suppresses the flash and one
preserves the legacy timing and appearance. CSS custom properties carry the resolved values so fall
and spike variants share the same contract.

## Verification

Unit coverage proves additive migrations, profile-derived missing fields, explicit false values,
all clamps, defensive binding cloning, every conflict location, reserved keys, toggle edges and
resets, exact default sensitivity output, and zero/one camera and HUD boundaries.

The existing allowlisted Settings Playwright spec will cover SSAO persistence across reload,
requested-versus-effective compatibility behavior, all corrected input endpoints, binding swap and
reset, an updated interact prompt, and screenshot evidence for Comfort and Remap. Browser checks run
serially on the default renderer and compatibility path. Physical input hardware and a true-WebGPU
pipeline mutation remain explicit manual checks when the test environment cannot provide them.
