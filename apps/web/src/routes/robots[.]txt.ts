import { createFileRoute } from '@tanstack/react-router';
import { robotsResponse } from '../../../../packages/backend/src/sitemap';

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: ({ request }) => robotsResponse(request),
      HEAD: ({ request }) => robotsResponse(request),
    },
  },
});
