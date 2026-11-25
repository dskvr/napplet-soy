import { test, expect } from '@playwright/test';

test('signed-out bookmarks persist, stay in sync across tabs, and can be removed from Saved', async ({
  page,
  context,
}) => {
  await context.routeWebSocket(/wss?:\/\//, (route) => route.close());
  await page.goto('/');
  const card = page.locator('.napplet-grid .napplet-card').first();
  const titleLink = card.locator('.card-heading a').first();
  const title = (await titleLink.innerText()).trim();
  const destination = await titleLink.getAttribute('href');
  await card.getByRole('button', { name: 'Save for later: ' + title, exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Remove from Saved: ' + title, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const saved = await context.newPage();
  await saved.goto('/saved');
  const stored = saved.getByRole('link', { name: title, exact: true });
  await expect(stored).toHaveAttribute('href', destination!);
  await saved.reload();
  await expect(stored).toBeVisible();
  await saved.getByRole('button', { name: 'Remove from Saved: ' + title, exact: true }).click();
  await expect(stored).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'Save for later: ' + title, exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});
