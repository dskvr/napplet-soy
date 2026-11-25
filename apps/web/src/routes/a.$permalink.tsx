import { createFileRoute, notFound } from '@tanstack/react-router';
import { PublicDetail } from '@/components/public-detail';
import { Detail } from '@/components/detail';
import { getPublication } from '@/lib/catalog.functions';
import { currentNappletHead } from '@/lib/napplet-head';

export const Route = createFileRoute('/a/$permalink')({
  loader: async ({ params }) => {
    const n = await getPublication({ data: params.permalink });
    if (!n) throw notFound();
    return n;
  },
  head: ({ loaderData }) => currentNappletHead(loaderData),
  component: () => {
    const n = Route.useLoaderData();
    return 'provenance' in n ? <PublicDetail napplet={n} /> : <Detail napplet={n} />;
  },
});
