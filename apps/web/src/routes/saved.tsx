import { createFileRoute } from '@tanstack/react-router';
import { SavedCollection } from '@/components/saved-napplets';

export const Route = createFileRoute('/saved')({
  head: () => ({
    meta: [
      { title: 'Saved napplets — napplet.soy' },
      { name: 'robots', content: 'noindex, follow' },
    ],
  }),
  component: SavedCollection,
});
