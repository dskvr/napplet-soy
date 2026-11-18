# NAP-GAMEPAD — shell-brokered controller input (proposed upstream draft)

Status: **proposed upstream draft**, pinned to [NAP-GAMEPAD at
`0b28f77e3dfa0f07dd7c0f9d61a7090ee99f3a5e`](https://github.com/napplet/naps/blob/0b28f77e3dfa0f07dd7c0f9d61a7090ee99f3a5e/naps/NAP-GAMEPAD.md)
([draft PR #130](https://github.com/napplet/naps/pull/130)). The pinned
@napplet/shim 0.35.0 supplies the standard gamepad binding over the private
NIP-5D MessagePort. The host supplies focus-gated snapshots and a compatibility
reader for games using the browser Gamepad API.

## Why

The Gamepad API reads physical controllers for the whole browser. CSP cannot govern it.
Before this change, Chromium let every opaque `allow-scripts` player frame call
`navigator.getGamepads()`, so napplets placed side by side all received the same
presses. Only the creator helper voluntarily ignored input without focus.

The shell now owns the only native reader. Player frames are denied the browser API
by Permissions-Policy (`gamepad 'none'` in `PLAYER_ALLOW`). Each frame receives live input while focused and neutral snapshots otherwise.

## Wire messages

All messages use the NIP-5D envelope. They are notifications, with no `id` and no
`.result` reply.

| Direction       | `type`                | Fields                                    |
| --------------- | --------------------- | ----------------------------------------- |
| napplet → shell | `gamepad.subscribe`   | —                                         |
| napplet → shell | `gamepad.unsubscribe` | —                                         |
| shell → napplet | `gamepad.state`       | `available`, `reason?`, `focused`, `pads` |

`gamepad.state`:

```jsonc
{
  "type": "gamepad.state",
  "available": true, // false when the shell itself cannot read controllers
  "reason": "blocked", // only with available:false: "blocked" | "unavailable"
  "focused": true, // this frame currently owns controller input
  "pads": [
    // browser slot order; null marks an empty slot
    null,
    {
      "index": 1,
      "id": "…",
      "mapping": "standard",
      "connected": true,
      "timestamp": 1234.5,
      "axes": [0.0, -1.0],
      "buttons": [{ "value": 1, "pressed": true, "touched": true }],
    },
  ],
}
```

Shell rules:

- The shell sends a snapshot right after `gamepad.subscribe`. After that it sends
  snapshots only when something changes, at most once per host animation frame.
- Only the frame that is the host document's focused element receives live values,
  and only while the host page is visible and focused.
- Every other subscribed frame still sees which pads are connected. Its axes and
  buttons are zero and its `timestamp` is `0`. Losing focus produces one neutral
  snapshot.
- Bounds: at most 8 slots, 16 axes, 32 buttons, a 128-character `id` and a
  16-character `mapping`. Axes are clamped to −1…1 and button values to 0…1.
- Subscribe requests are limited to 120 per minute per frame; unsubscribe always stops input. Closing the
  session ends the subscription.

The domain is optional. Declare it required only if the napplet cannot run without controllers. Napplets must keep keyboard and
pointer/touch controls.

## Compatibility shim

Denying the `gamepad` Permissions-Policy feature does not remove the API from a
frame. In Chromium 153 the frame still has the native
`Navigator.prototype.getGamepads`, `Gamepad`, `GamepadButton`, `GamepadEvent` and
`ongamepadconnected`; only the call throws `SecurityError`. The host prelude
(`nativeGamepadCompatibility()` in `packages/runtime/src/prelude.ts`) runs before creator scripts
and follows these rules:

- **It replaces only a denied API.** It installs only when the native `getGamepads`
  exists and throws `SecurityError`. If the host allows native access, or the browser
  has no Gamepad API, it leaves the native API untouched. The standard binding subscribes on first use.
- **It replaces exactly one property: `Navigator.prototype.getGamepads`.** The
  replacement keeps the native writable/enumerable/configurable attributes, the name
  `getGamepads`, `length` 0, and the `TypeError` for a non-`Navigator` receiver.
  `addEventListener`, `on…` handlers, constructors and prototypes stay native.
- **The return value has native shape.** It is a fresh array in slot order with
  `null` gaps. Before the first snapshot it has the host browser's empty-slot count:
  `[null, null, null, null]` in Chromium, as native.
- **Pads have native prototypes.** They use `Gamepad.prototype` and
  `GamepadButton.prototype`, with frozen `axes`/`buttons`. `timestamp` comes from the
  shell, so engines that skip unchanged pads still see changes.
- **Events are `GamepadEvent`s.** `gamepadconnected`/`gamepaddisconnected` are real
  `Event`s with `GamepadEvent.prototype`, so `instanceof GamepadEvent` holds and
  `Object.prototype.toString` reports `[object GamepadEvent]`. They reach listeners
  and the native `on…` handlers. A disconnect carries `connected: false`.
- **The standard binding subscribes at install.** It sends one `gamepad.subscribe` so no listener API
  has to be wrapped to detect use.
- **Denial matches native.** `reason: "blocked"` from the shell makes `getGamepads()`
  throw `SecurityError`, as native denial does. `unavailable` returns the empty-slot
  list.
- **There is a standard direct API.** `window.napplet.gamepad` offers
  `getGamepads()`, `available`, `focused` and `onChange(callback) → { close }`. It
  is installed independently of native API replacement, including browsers without a native API.

Remaining observable differences, verified in Chromium 153:

- **Latency and focus.** Input arrives about one host frame plus one `postMessage`
  later, and only while the napplet has focus.
- **Source text.** `String(navigator.getGamepads)` shows source rather than
  `[native code]`. The shim does not patch `Function.prototype.toString`.
- **Untrusted events.** `event.isTrusted` is `false`, and the `GamepadEvent`
  constructor still rejects shim pads.
- **Own properties.** Pad fields are own data properties. Native fields are prototype
  accessors, so `Object.keys`, spread and `JSON.stringify` show fields that native
  pads hide.
- **No haptics.** `vibrationActuator` is `null`, a spec-valid value for pads without
  haptics.
- **Held buttons.** A button held while focus moves into a game can look like a new
  press to the game's own edge detection. The bundled helper waits for
  `focused: true` to avoid this.
- **Other browsers.** Isolation depends on the browser enforcing `gamepad 'none'`.
  Where it is not enforced, the native API keeps working and is left untouched.

## Verification

- `packages/runtime/src/gamepad-session.test.ts` covers:
  - Focus routing and neutral snapshots for unfocused frames.
  - That unchanged state is not resent.
  - Bounds, blocked/unavailable reporting, churn limits and teardown.
- `tests/services/gamepad-shim.test.ts` uses real Chromium to cover:
  - The native property shape, receiver check and untouched listener APIs.
  - Prototypes, frozen arrays, null slots and timestamps.
  - `GamepadEvent` instances through both listeners and `on…` handlers.
  - That a frame whose host allows native access is left untouched.
  - That spoofed self-messages are ignored.
  - Blocked → `SecurityError`.
  - The player-frame Permissions-Policy allowlist.
- `tests/services/controllers.test.ts` drives synthetic pads on the **host** page
  through the real preview and workshop tester. The unmodified helper reads them in
  the opaque frame, and a second side-by-side frame sees only neutral values while
  the other frame has focus.

Physical controllers and Safari/Firefox behavior are not yet verified (see
[CONTROLLERS.md](CONTROLLERS.md)).
