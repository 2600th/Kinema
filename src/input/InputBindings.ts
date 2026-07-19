export const KEYBOARD_BINDING_ACTIONS = [
  "moveForward",
  "moveBackward",
  "moveLeft",
  "moveRight",
  "jump",
  "interact",
  "crouch",
  "sprint",
] as const;

export type KeyboardBindingAction = (typeof KEYBOARD_BINDING_ACTIONS)[number];
export type KeyboardBindings = Record<KeyboardBindingAction, string[]>;
export type ReadonlyKeyboardBindings = {
  readonly [Action in KeyboardBindingAction]: readonly string[];
};

export const DEFAULT_KEYBOARD_BINDINGS: ReadonlyKeyboardBindings = Object.freeze({
  moveForward: Object.freeze(["KeyW", "ArrowUp"]),
  moveBackward: Object.freeze(["KeyS", "ArrowDown"]),
  moveLeft: Object.freeze(["KeyA", "ArrowLeft"]),
  moveRight: Object.freeze(["KeyD", "ArrowRight"]),
  jump: Object.freeze(["Space"]),
  interact: Object.freeze(["KeyF"]),
  crouch: Object.freeze(["KeyC", "ControlLeft"]),
  sprint: Object.freeze(["ShiftLeft", "ShiftRight"]),
});

export const INPUT_ACTION_LABELS: Readonly<Record<KeyboardBindingAction, string>> = Object.freeze({
  moveForward: "Move forward",
  moveBackward: "Move backward",
  moveLeft: "Move left",
  moveRight: "Move right",
  jump: "Jump",
  interact: "Interact",
  crouch: "Crouch",
  sprint: "Sprint",
});

export const RESERVED_BINDING_CODES: readonly string[] = Object.freeze([
  "Escape",
  "Tab",
  "Backquote",
  "F1",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "KeyE",
  "KeyQ",
]);

const RESERVED_BINDING_CODE_SET = new Set(RESERVED_BINDING_CODES);

// Named values from the W3C UI Events KeyboardEvent.code value tables. Patterned
// families (letters, digits, function keys, language keys, and numpad digits)
// are handled below so future members do not require another curated subset.
const NAMED_KEYBOARD_CODES = new Set([
  "Abort",
  "Again",
  "AltLeft",
  "AltRight",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "AudioVolumeDown",
  "AudioVolumeMute",
  "AudioVolumeUp",
  "Space",
  "Enter",
  "Backspace",
  "Backquote",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "BrowserBack",
  "BrowserFavorites",
  "BrowserForward",
  "BrowserHome",
  "BrowserRefresh",
  "BrowserSearch",
  "BrowserStop",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "CapsLock",
  "ContextMenu",
  "ControlLeft",
  "ControlRight",
  "Convert",
  "Copy",
  "Cut",
  "Eject",
  "Escape",
  "Find",
  "Fn",
  "FnLock",
  "Help",
  "Hiragana",
  "Hyper",
  "IntlBackslash",
  "IntlRo",
  "IntlYen",
  "KanaMode",
  "Katakana",
  "LaunchApp1",
  "LaunchApp2",
  "LaunchMail",
  "MediaPlayPause",
  "MediaSelect",
  "MediaStop",
  "MediaTrackNext",
  "MediaTrackPrevious",
  "MetaLeft",
  "MetaRight",
  "NonConvert",
  "NumLock",
  "NumpadAdd",
  "NumpadBackspace",
  "NumpadClear",
  "NumpadClearEntry",
  "NumpadComma",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadHash",
  "NumpadMemoryAdd",
  "NumpadMemoryClear",
  "NumpadMemoryRecall",
  "NumpadMemoryStore",
  "NumpadMemorySubtract",
  "NumpadMultiply",
  "NumpadParenLeft",
  "NumpadParenRight",
  "NumpadStar",
  "NumpadSubtract",
  "Open",
  "Paste",
  "Power",
  "PrintScreen",
  "Props",
  "Resume",
  "ScrollLock",
  "Pause",
  "Select",
  "ShiftLeft",
  "ShiftRight",
  "Sleep",
  "Super",
  "Suspend",
  "Tab",
  "Turbo",
  "Undo",
  "Unidentified",
  "WakeUp",
  "Comma",
  "Period",
  "Slash",
  "Semicolon",
  "Quote",
  "Minus",
  "Equal",
]);

const KEYBOARD_CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Space: "Space",
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  MetaLeft: "Left Meta",
  MetaRight: "Right Meta",
  Backquote: "`",
});

export function createDefaultKeyboardBindings(): KeyboardBindings {
  return Object.fromEntries(
    KEYBOARD_BINDING_ACTIONS.map((action) => [action, [...DEFAULT_KEYBOARD_BINDINGS[action]]]),
  ) as KeyboardBindings;
}

export function isReservedBindingCode(code: string): boolean {
  return RESERVED_BINDING_CODE_SET.has(code);
}

function isKeyboardEventCode(value: unknown): value is string {
  if (typeof value !== "string" || isReservedBindingCode(value)) return false;
  return (
    NAMED_KEYBOARD_CODES.has(value) ||
    /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right))$/.test(value) ||
    /^(?:(?:Shift|Control|Alt|Meta)(?:Left|Right))$/.test(value) ||
    /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)$/.test(value) ||
    /^F[1-9][0-9]*$/.test(value) ||
    /^Lang[1-5]$/.test(value)
  );
}

export function sanitizeKeyboardBindings(raw: unknown): KeyboardBindings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createDefaultKeyboardBindings();
  }

  const source = raw as Record<string, unknown>;
  const slots = KEYBOARD_BINDING_ACTIONS.flatMap((action) => {
    const saved = Array.isArray(source[action]) ? source[action] : [];
    return DEFAULT_KEYBOARD_BINDINGS[action].map((defaultCode, index) => ({
      action,
      index,
      defaultCode,
      code: isKeyboardEventCode(saved[index]) ? saved[index] : defaultCode,
    }));
  });

  for (let pass = 0; pass < slots.length; pass += 1) {
    let repaired = false;
    const slotsByCode = new Map<string, typeof slots>();
    for (const slot of slots) {
      const matches = slotsByCode.get(slot.code) ?? [];
      matches.push(slot);
      slotsByCode.set(slot.code, matches);
    }
    for (const matches of slotsByCode.values()) {
      if (matches.length < 2) continue;
      const keeper = matches.find((slot) => slot.code === slot.defaultCode) ?? matches[0];
      for (const slot of matches) {
        if (slot === keeper || slot.code === slot.defaultCode) continue;
        slot.code = slot.defaultCode;
        repaired = true;
      }
    }
    if (!repaired) break;
  }

  const result = createDefaultKeyboardBindings();
  for (const slot of slots) {
    result[slot.action][slot.index] = slot.code;
  }
  return result;
}

export function rebindKeyboardAction(
  bindings: ReadonlyKeyboardBindings,
  action: KeyboardBindingAction,
  capturedCode: string,
): KeyboardBindings {
  const next = sanitizeKeyboardBindings(bindings);
  const oldPrimary = next[action][0];
  if (!isKeyboardEventCode(capturedCode) || capturedCode === oldPrimary) return next;

  for (const candidateAction of KEYBOARD_BINDING_ACTIONS) {
    const slotIndex = next[candidateAction].indexOf(capturedCode);
    if (slotIndex < 0) continue;
    next[candidateAction][slotIndex] = oldPrimary;
    break;
  }
  next[action][0] = capturedCode;
  return next;
}

export function getKeyboardCodeLabel(code: string): string {
  const knownLabel = KEYBOARD_CODE_LABELS[code];
  if (knownLabel) return knownLabel;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Numpad ${code.slice(6)}`;
  return code;
}
