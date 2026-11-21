import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserEngine } from '../../apps/cli/src/browser';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

test('only the preview shell can initiate mouse capture and blocking it releases the game', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-mouse-'));
  const browser = await (await browserEngine()).chromium.launch();
  let preview: ReturnType<typeof startPreviewServer> | undefined;
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Mouse specimen',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: [],
        servers: [],
      }),
    );
    await Bun.write(
      join(root, 'index.html'),
      `<!doctype html>
      <button id="start">Offer capture</button><button id="stop">Withdraw</button>
      <output id="state">idle</output><output id="buttons"></output>
      <script>
        let handle;
        document.querySelector('#start').onclick = () => {
          handle = napplet.soyMouse.offer(event => {
            if (event.type === 'mouse.state') document.querySelector('#state').textContent = String(event.captured);
            if (event.type === 'mouse.input') document.querySelector('#buttons').textContent = String(event.buttons);
          });
        };
        document.querySelector('#stop').onclick = () => handle.close();
      </script>`,
    );
    preview = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    const page = await browser.newPage();
    await page.routeWebSocket(/wss?:\/\//, (route) => route.close());
    // Headless browser backends differ in native cursor support. Model only the
    // OS lock transition; gestures, iframe focus, the shim and private port are real.
    await page.addInitScript(() => {
      if (window !== top) return;
      let locked: Element | null = null;
      Object.defineProperty(document, 'pointerLockElement', { get: () => locked });
      HTMLElement.prototype.requestPointerLock = async function () {
        locked = this;
        queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
      };
      document.exitPointerLock = () => {
        locked = null;
        queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
      };
    });
    await page.goto(preview.url.href);
    page.setDefaultTimeout(4500);
    const child = page.frameLocator('iframe');
    await child.locator('#start').click();
    const control = page.getByRole('button', { name: 'Capture mouse', exact: true });
    await control.waitFor();
    expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain(
      'allow-pointer-lock',
    );
    await control.evaluate((button) => (button as HTMLElement).click());
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    await control.click();
    await child.locator('#state').filter({ hasText: 'true' }).waitFor();
    expect(await page.evaluate(() => document.pointerLockElement?.className)).toBe(
      'soy-mouse-capture',
    );
    const bounds = await page.locator('.soy-mouse-capture').boundingBox();
    if (!bounds) throw new Error('Capture button missing');
    await page.mouse.move(bounds.x + 2, bounds.y + 2);
    await page.mouse.down();
    await child.locator('#buttons').filter({ hasText: '1' }).waitFor();
    await page.mouse.up();
    await child.locator('#buttons').filter({ hasText: '0' }).waitFor();
    await page.locator('iframe').evaluate((frame) => ((frame as HTMLElement).inert = true));
    await child.locator('#state').filter({ hasText: 'false' }).waitFor();
    await page.waitForFunction(() => document.pointerLockElement === null);
    await page.locator('iframe').evaluate((frame) => ((frame as HTMLElement).inert = false));
    await child.locator('#stop').click();
    await control.waitFor({ state: 'detached' });
  } finally {
    await browser.close();
    preview?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
