import { expect, test } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';

test('an unknown signed archetype beyond page one is discoverable with browser relays offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gallery-archetype-'));
  const indexDir = join(dir, 'index');
  const store = new IndexStore(indexDir, true);
  const key = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  // All entries have the same topic. Only the oldest entry advertises the role.
  const role = 'field-recorder';
  try {
    for (let i = 0; i < 25; i++) {
      const template = fixtures[0].current;
      const event = finalizeEvent(
        {
          kind: template.kind,
          created_at: now - 25 + i,
          content: template.content,
          tags: [
            ...template.tags.filter((t) => !['d', 'title', 't', 'z'].includes(t[0])),
            ['d', 'test-' + i],
            ['title', i === 0 ? 'Field notes' : 'Sample ' + i],
            ['t', role],
            ...(i === 0 ? [['z', role]] : []),
          ],
        },
        key,
      );
      store.admit(event);
      const entry = await publicNapplet(event);
      store.project(
        event.id,
        { ...entry, availability: 'ready' },
        (now + 600) * 1000,
        (now + 600) * 1000,
      );
    }
  } finally {
    store.close();
  }
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: indexDir,
      SPACE_COMMUNITY_DIR: join(dir, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timeout = setTimeout(() => server.kill(), 45000);
  const browser = await chromium.launch();
  try {
    let origin = '';
    for await (const chunk of server.stdout) {
      const address = /listening on (http:\/\/[^\s]+)/.exec(new TextDecoder().decode(chunk))?.[1];
      if (address) {
        origin = new URL(address).origin;
        break;
      }
    }
    expect(origin).toStartWith('http://127.0.0.1:');
    const context = await browser.newContext();
    await context.routeWebSocket(/wss?:\/\//, (socket) => socket.close());
    const page = await context.newPage();
    await page.goto(origin);
    await ui(page.locator('#identity-button')).toBeEnabled();
    await ui(page.locator('.napplet-grid .napplet-card')).toHaveCount(24);
    await page.getByRole('combobox', { name: 'Archetype', exact: true }).selectOption(role);
    await ui(page.locator('.napplet-grid .napplet-card')).toHaveCount(1);
    await ui(page.locator('.napplet-grid .napplet-card')).toContainText('Field notes');
    await ui(page).toHaveURL(/archetype=field-recorder/);
    await page.reload();
    await ui(page.getByRole('combobox', { name: 'Archetype', exact: true })).toHaveValue(role);
    await page.getByRole('link', { name: 'Field notes', exact: true }).click();
    await ui(
      page
        .getByRole('navigation', { name: 'Napplet archetypes' })
        .getByRole('link', { name: role }),
    ).toBeVisible();
    const permalink = page.url();
    // A newly opened tab initially has no catalogue cache.
    const fresh = await context.newPage();
    await fresh.goto(origin + '/docs');
    const search = fresh.getByRole('searchbox', { name: 'Search napplets' });
    await search.fill('Field notes');
    await search.press('Enter');
    await ui(fresh.getByRole('heading', { name: /Results for “Field notes”/ })).toBeVisible();
    await ui(fresh.locator('.hero, #story, .create-banner')).toHaveCount(0);
    const result = fresh
      .locator('.card-heading')
      .getByRole('link', { name: 'Field notes', exact: true });
    await ui(result).toBeVisible();
    const resultURL = fresh.url();
    await result.click();
    await ui(fresh).toHaveURL(permalink);
    const back = fresh.getByRole('link', { name: 'Back to results' });
    await ui(back).toBeVisible();
    await back.click();
    await ui(fresh).toHaveURL(resultURL);
    await ui(result).toBeFocused();
    await fresh.setViewportSize({ width: 390, height: 844 });
    const toggle = fresh.getByRole('button', { name: 'Search the catalogue' });
    await toggle.click();
    await ui(search).toBeFocused();
    await search.press('Escape');
    await ui(toggle).toBeFocused();
    await fresh.getByRole('button', { name: 'Create', exact: true }).click();
    await ui(fresh.getByRole('link', { name: 'Create in browser' })).toHaveAttribute(
      'href',
      '/studio/create',
    );
    await ui(fresh.getByRole('link', { name: 'Use soyLI locally' })).toHaveAttribute(
      'href',
      '/create#local-soyli',
    );
    await fresh.keyboard.press('Escape');
    await toggle.click();
    await search.fill(permalink);
    await search.press('Enter');
    await ui(fresh).toHaveURL(permalink);

    await fresh.goto(origin + '/?page=2');
    const pagination = fresh.getByRole('navigation', { name: 'Gallery pages' });
    await ui(pagination).toContainText('Page 2 of 2');
    await ui(result).toBeVisible();
    await result.click();
    await back.click();
    await ui(pagination).toContainText('Page 2 of 2');
    await ui(result).toBeFocused();
  } finally {
    clearTimeout(timeout);
    await browser.close();
    server.kill();
    await server.exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
