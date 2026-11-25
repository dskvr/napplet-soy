import { createFileRoute } from '@tanstack/react-router';
import { sitemapResponse } from '../../../../packages/backend/src/sitemap';

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: ({ request }) => sitemapResponse(request),
      HEAD: ({ request }) => sitemapResponse(request),
    },
  },
});
