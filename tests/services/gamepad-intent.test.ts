import { expect, test } from 'bun:test';
import { expect as browserExpect, type Browser } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools';
import { browserEngine } from '../../apps/cli/src/browser';
import { sha256 } from '../../packages/protocol/src/artifact';
import { PLAYER_ALLOW } from '../../packages/runtime/src';

async function bundleIntentClient() {
  const output = await mkdtemp(join(tmpdir(), 'soy-gamepad-intent-'));
  const entry = new URL('../../apps/cli/src/preview/intent-client.ts', import.meta.url).pathname;
  // Build in a fresh process, as previewAssets does: the test runner has already
  // resolved server-side dependencies whose browser exports differ.
  const build = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    const build = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}], outdir: ${JSON.stringify(output)}, target: 'browser', format: 'esm',
      plugins: [{
        name: 'raw-prelude',
        setup(build) {
          build.onResolve({ filter: /^@napplet\\/shim\\/prelude.global\\?raw$/ }, () => ({
            path: Bun.resolveSync('@napplet/shim/prelude.global', ${JSON.stringify(import.meta.dir)}), namespace: 'raw',
          }));
          build.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
            contents: await Bun.file(path).text(), loader: 'text',
          }));
        },
      }],
    });
    if (!build.success) { console.error(build.logs); process.exit(1); }
  `,
    ],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' },
  );
  const timer = setTimeout(() => build.kill('SIGKILL'), 15000);
  try {
    const [code, errors] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    expect(code, `Failed to bundle intent client: ${errors}`).toBe(0);
    return await Bun.file(join(output, 'intent-client.js')).text();
  } finally {
    clearTimeout(timer);
    await rm(output, { recursive: true, force: true });
  }
}

test('CLI intent targets deny the original native reader and expose brokered NAP and compatibility APIs', async () => {
  const artifact = '<button>Focus target</button>';
  const hash = await sha256(new TextEncoder().encode(artifact));
  const script = await bundleIntentClient();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/host.js')
        return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
      if (path === '/')
        return new Response(
          `<!doctype html><script type="module">
        import { previewIntents } from '/host.js';
        const preview = previewIntents({
          signal: new AbortController().signal, sourceFrame: () => undefined,
          hostOptions: () => ({ relays: [], pubkey: null, prompt() {}, files() {}, localServers: [location.origin] }),
        });
        preview.workspace.register({ id: 'source', contracts: [] });
        const source = preview.workspace.attach('source', () => {});
        window.openTarget = async manifest => {
          await preview.workspace.install(manifest);
          return source.handle({ type: 'intent.invoke', request: { archetype: 'game', action: 'open', convention: 'napplet:game/open' } });
        };
      </script>`,
          { headers: { 'Content-Type': 'text/html' } },
        );
      return new Response(artifact, { headers: { 'Access-Control-Allow-Origin': '*' } });
    },
  });
  let browser: Browser | undefined;
  try {
    const manifest = finalizeEvent(
      {
        kind: 35129,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Gamepad review fixture',
        tags: [
          ['d', 'gamepad-review'],
          ['x', hash],
          ['server', server.url.origin],
          ['z', 'game'],
          ['i', 'napplet:game/open'],
        ],
      },
      new Uint8Array(32).fill(76),
    );
    browser = await (await browserEngine()).chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    // Retain the actual native operation before the prelude replaces it. A saved
    // reference must remain denied: replacing a JS property is not isolation.
    await page.addInitScript(() => {
      (window as any).originalGamepadReader = Navigator.prototype.getGamepads;
    });
    await page.goto(server.url.href);
    await page.waitForFunction(() => typeof (window as any).openTarget === 'function');
    expect(
      await page.evaluate((manifest) => (window as any).openTarget(manifest), manifest),
    ).toMatchObject({ result: { ok: true } });
    await browserExpect(page.locator('iframe')).toHaveAttribute('allow', PLAYER_ALLOW);
    const target = page.frameLocator('iframe');
    await target.getByRole('button', { name: 'Focus target' }).click();
    const frame = page.frames().find((frame) => frame.parentFrame())!;
    expect(
      await frame.evaluate(() => {
        let native;
        try {
          (window as any).originalGamepadReader.call(navigator);
          native = 'allowed';
        } catch (error) {
          native = (error as Error).name;
        }
        return {
          native,
          policy: (document as any).featurePolicy.allowsFeature('gamepad'),
          binding: typeof (window as any).napplet.gamepad.getGamepads,
        };
      }),
    ).toEqual({ native: 'SecurityError', policy: false, binding: 'function' });
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'getGamepads', {
        value: () => [
          {
            connected: true,
            id: 'Host controller',
            mapping: 'standard',
            timestamp: 9,
            axes: [0.75],
            buttons: [{ value: 1, pressed: true, touched: true }],
          },
        ],
      }),
    );
    await browserExpect
      .poll(() =>
        frame.evaluate(() => ({
          nap: (window as any).napplet.gamepad.getGamepads()[0]?.axes[0],
          compatibility: navigator.getGamepads()[0]?.axes[0],
          focused: (window as any).napplet.gamepad.focused,
        })),
      )
      .toEqual({ nap: 0.75, compatibility: 0.75, focused: true });
    await page.locator('button', { hasText: 'Close napplet' }).focus();
    await browserExpect
      .poll(() =>
        frame.evaluate(() => ({
          nap: (window as any).napplet.gamepad.getGamepads()[0]?.axes[0],
          compatibility: navigator.getGamepads()[0]?.axes[0],
          focused: (window as any).napplet.gamepad.focused,
        })),
      )
      .toEqual({ nap: 0, compatibility: 0, focused: false });
  } finally {
    await browser?.close();
    server.stop(true);
  }
}, 30000);
