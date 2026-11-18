import { RUNTIME_DOMAINS } from './capabilities';
import { validateConfigSchema } from './config-schema';
import { createWebmcpBinding } from './webmcp/binding';
import { createFipsBinding } from './fips/binding';

/**
 * Interim WebRTC removal from the pending NIP-5D revision (dskvr/nips PR 16/17).
 * Neither the iframe sandbox nor CSP governs WebRTC, and a page cannot disable it
 * for its iframes. NAP-WEBRTC peer connections stay in the shell realm, so the
 * napplet realm has no legitimate use for these constructors. A napplet can still
 * nest a srcdoc frame with its own constructors; this narrows, not closes, the
 * channel.
 */
export const WEBRTC_REMOVAL = `
(() => {
  const names = new Set(Object.getOwnPropertyNames(globalThis).filter(name => name.startsWith('RTC')));
  for (const prefix of ['webkit', 'moz'])
    for (const name of ['RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate'])
      names.add(prefix + name);
  for (const name of names) {
    try {
      Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {}
  }
})();`;

/** Empty-slot count of the host browser's own Gamepad API (4 in Chromium, 0 in Firefox). */
export function hostGamepadSlots() {
  try {
    return Math.min(globalThis.navigator?.getGamepads?.().length ?? 0, 8);
  } catch {
    return 0;
  }
}

/**
 * NAP-GAMEPAD binding (proposed upstream draft, docs/NAP-GAMEPAD.md). Permissions-Policy
 * leaves the native API in player frames but makes it throw. Only in that case is the
 * one denied operation replaced, with native property attributes, name, length and
 * receiver check. Events and handlers stay native. Frames where the browser lacks the
 * API, or the host allows native access, keep their native surface unchanged.
 * The standard window.napplet.gamepad binding is always installed.
 */
function nativeGamepadCompatibility(slots = hostGamepadSlots()) {
  return `(() => {
  const native = Navigator.prototype.getGamepads;
  let replaceNative = false;
  if (typeof native === 'function') {
    try { native.call(navigator); }
    catch (error) { replaceNative = error?.name === 'SecurityError'; }
  }
  if (!replaceNative) return;
  const PadProto = typeof Gamepad === 'function' ? Gamepad.prototype : Object.prototype;
  const ButtonProto = typeof GamepadButton === 'function' ? GamepadButton.prototype : Object.prototype;
  const EventProto = typeof GamepadEvent === 'function' ? GamepadEvent.prototype : Event.prototype;
  let state = { available: true, focused: false }, raw = [], current = Array(${Math.max(0, Math.min(8, Math.trunc(slots) || 0))}).fill(null);

  const own = (proto, values) => {
    const object = Object.create(proto);
    for (const key of Object.keys(values))
      Object.defineProperty(object, key, { value: values[key], enumerable: true });
    return object;
  };
  const unit = (value, min) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : 0;
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
  const pad = (data, index, connected = true) => own(PadProto, {
    id: String(data.id ?? '').slice(0, 128),
    index,
    mapping: String(data.mapping ?? '').slice(0, 16),
    connected,
    timestamp: typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : 0,
    axes: Object.freeze(list(data.axes, 16).map(value => unit(value, -1))),
    buttons: Object.freeze(list(data.buttons, 32).map(button => own(ButtonProto, {
      pressed: !!button?.pressed, touched: !!button?.touched, value: unit(button?.value, 0),
    }))),
    vibrationActuator: null,
  });
  // GamepadEvent's constructor rejects shim pads. A real Event with GamepadEvent's
  // prototype passes instanceof checks and reaches listeners and native on* handlers.
  const emit = (type, gamepad) => {
    if (!replaceNative) return;
    const event = new Event(type);
    Object.setPrototypeOf(event, EventProto);
    Object.defineProperty(event, 'gamepad', { value: gamepad, enumerable: true });
    window.dispatchEvent(event);
  };
  window.napplet.gamepad.onChange(data => {
    const before = raw;
    raw = data.pads.slice(0, 8).map(value => value && typeof value === 'object' ? value : null);
    current = raw.map((value, index) => value && pad(value, index));
    state = data.available === false
      ? { available: false, reason: data.reason === 'blocked' ? 'blocked' : 'unavailable', focused: false }
      : { available: true, focused: data.focused === true };
    for (let index = 0; index < Math.max(before.length, raw.length); index++) {
      const old = before[index], next = raw[index];
      const same = old && next && old.id === next.id && old.mapping === next.mapping;
      if (old && !same) emit('gamepaddisconnected', pad(old, index, false));
      if (next && !same) emit('gamepadconnected', current[index]);
    }

  });
  const replacement = {
    getGamepads() {
      if (!(this instanceof Navigator)) throw new TypeError('Illegal invocation');
      if (state.reason === 'blocked')
        throw new DOMException('This napplet runtime\\'s host policy blocks Gamepad access.', 'SecurityError');
      return current.slice();
    },
  }.getGamepads;
  Object.defineProperty(Navigator.prototype, 'getGamepads', {
    ...Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads'),
    value: replacement,
  });
})()`;
}

/**
 * The pinned upstream shim plus Soy's static config snapshot. The shim opens the
 * NIP-5D channel before any napplet script runs: it keeps one MessagePort private
 * and hands the other to the shell in the single window-level `napplet.hello`.
 * SHELL, like every other domain, travels only over that port.
 */
export function nappletPrelude(
  shim: string,
  declaration?: { schema?: unknown },
  slots = hostGamepadSlots(),
) {
  let schema = null;
  try {
    if (declaration?.schema !== undefined) schema = validateConfigSchema(declaration.schema);
  } catch {
    /* Host reports the declaration error. */
  }
  // The pinned shim tracks runtime registrations. Supply its missing static schema
  // snapshot before creator scripts, using the same validated, signed build metadata.
  // No additional wire messages or app-owned bootstrap are required.
  const config = `(() => {
    const api = window.napplet.config;
    const declared = ${JSON.stringify(schema)};
    window.napplet.config = Object.freeze({
      ...api,
      registerSchema: (schema, version) => api.registerSchema(structuredClone(schema), version),
      get schema() { return structuredClone(api.schema ?? declared); },
      onSchemaError: callback => {
        const unsubscribe = api.onSchemaError(callback);
        unsubscribe.close = unsubscribe;
        return unsubscribe;
      },
    });
  })();`;
  const options = `{domains:${JSON.stringify(RUNTIME_DOMAINS)},resourceProfile:(${createFipsBinding.toString()}),toolProfile:(${createWebmcpBinding.toString()})}`;
  return `${WEBRTC_REMOVAL}\n${shim}\nglobalThis.NappletShimPrelude.install(${options});\n${nativeGamepadCompatibility(slots)};\n${config}`;
}
