import { communityStore } from '../../community/src/store';

/** Only the site's validated, visible catalogue can assign a permanent name. */
export function withPublicationLink<T extends { naddr: string | null; title: string }>(
  entry: T,
): T & { permalink?: string } {
  if (!entry.naddr || !process.env.SPACE_COMMUNITY_DIR) return entry;
  const permalink = communityStore().registerPublication(entry.naddr, entry.title);
  return { ...entry, permalink };
}
