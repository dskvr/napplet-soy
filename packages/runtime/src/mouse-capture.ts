// Experimental Soy input profile. Only an explicit gesture on the shell button
// can acquire pointer lock. The frame receives relative motion and two buttons.
export const mouseProfile = 'soy.mouse/1';

export function createMouseCapture(
  frame: HTMLIFrameElement,
  surface: HTMLElement,
  send: (event: Record<string, unknown>) => void,
) {
  const doc = frame.ownerDocument;
  const win = doc.defaultView!;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'soy-mouse-capture';
  button.style.cssText =
    'position:absolute;top:.5rem;left:50%;transform:translateX(-50%);z-index:3;padding:.4rem .8rem;border:1px solid #80948b;border-radius:.45rem;background:#152920;color:white;font:600 14px system-ui;cursor:pointer';
  const available = typeof button.requestPointerLock === 'function';
  let offered = false,
    pending = false,
    captured = false,
    dead = false;
  let dx = 0,
    dy = 0,
    buttons = 0,
    raf = 0;
  const clear = () => {
    win.cancelAnimationFrame(raf);
    dx = dy = buttons = raf = 0;
  };
  const interactive = () =>
    frame.isConnected &&
    !doc.hidden &&
    !frame.closest('[inert]') &&
    !doc.querySelector('dialog:modal');
  const label = () => {
    button.textContent = captured ? 'Mouse captured · Esc to release' : 'Capture mouse';
  };
  const state = () => send({ type: 'mouse.state', profile: mouseProfile, captured });
  const exit = () => {
    pending = false;
    if (captured) {
      captured = false;
      clear();
      state();
    }
    if (doc.pointerLockElement === button) doc.exitPointerLock();
    label();
  };
  const change = () => {
    if (doc.pointerLockElement !== button) {
      exit();
      return;
    }
    if (!pending || !offered || !interactive()) {
      exit();
      return;
    }
    pending = false;
    frame.focus({ preventScroll: true });
    if (doc.activeElement !== frame) {
      exit();
      return;
    }
    captured = true;
    clear();
    label();
    state();
  };
  const failed = () => {
    if (!pending) return;
    pending = false;
    button.textContent = 'Capture failed · Try again';
  };
  button.onclick = (e) => {
    if (!e.isTrusted || !offered || !interactive() || pending || captured || doc.pointerLockElement)
      return;
    pending = true;
    try {
      button.requestPointerLock()?.then(() => {
        if ((dead || !offered || !interactive()) && doc.pointerLockElement === button)
          doc.exitPointerLock();
      }, failed);
    } catch {
      failed();
    }
  };
  const flush = () => {
    raf = 0;
    if (!captured) return;
    if (!interactive() || !doc.hasFocus() || doc.activeElement !== frame) {
      exit();
      return;
    }
    send({ type: 'mouse.input', profile: mouseProfile, dx, dy, buttons });
    dx = dy = 0;
  };
  const input = (e: MouseEvent) => {
    if (!e.isTrusted || !captured || doc.pointerLockElement !== button) return;
    e.preventDefault();
    if (e.type === 'mousemove') {
      dx = Math.max(-8192, Math.min(8192, dx + e.movementX));
      dy = Math.max(-8192, Math.min(8192, dy + e.movementY));
    }
    const next = e.buttons & 3;
    if (next !== buttons) {
      buttons = next;
      win.cancelAnimationFrame(raf);
      flush();
    } else if (!raf && (dx || dy)) raf = win.requestAnimationFrame(flush);
  };
  button.oncontextmenu = (e) => e.preventDefault();
  button.onmousemove = button.onmousedown = button.onmouseup = input;
  const guard = () => {
    // Focusing an iframe also emits blur on its parent window.
    queueMicrotask(() => {
      if (
        !dead &&
        (captured || pending) &&
        (!interactive() || !doc.hasFocus() || (captured && doc.activeElement !== frame))
      )
        exit();
    });
  };
  const mutations = new MutationObserver(guard);
  mutations.observe(surface.ownerDocument.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['inert', 'open'],
  });
  doc.addEventListener('pointerlockchange', change);
  doc.addEventListener('pointerlockerror', failed);
  doc.addEventListener('visibilitychange', guard);
  doc.addEventListener('focusin', guard);
  win.addEventListener('blur', guard);
  win.addEventListener('pagehide', exit);
  const withdraw = () => {
    offered = false;
    exit();
    button.remove();
  };
  return {
    offer() {
      if (dead || offered || !available || !interactive()) return;
      offered = true;
      label();
      surface.append(button);
    },
    withdraw,
    close() {
      dead = true;
      withdraw();
      mutations.disconnect();
      doc.removeEventListener('pointerlockchange', change);
      doc.removeEventListener('pointerlockerror', failed);
      doc.removeEventListener('visibilitychange', guard);
      doc.removeEventListener('focusin', guard);
      win.removeEventListener('blur', guard);
      win.removeEventListener('pagehide', exit);
    },
  };
}
