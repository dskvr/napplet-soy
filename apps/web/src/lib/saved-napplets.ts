import { decodeAddress, identityAddress } from '../../../../packages/protocol/src';

export type SavedNapplet = {
  title: string;
  description: string;
  naddr: string | null;
  revisionId: string;
  permalink?: string;
};

const prefix = 'napplet.soy.saved.v1.';
type SavedEntry = SavedNapplet & { id: string; savedAt: number };
const empty: SavedEntry[] = [];
export const serverSaved = () => empty;

export function savedId(item: Pick<SavedNapplet, 'naddr' | 'revisionId'>) {
  return item.naddr ? identityAddress(decodeAddress(item.naddr)) : item.revisionId;
}

function readSaved(storage: Storage): SavedEntry[] {
  const entries: SavedEntry[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const item = JSON.parse(storage.getItem(key)!);
      if (
        typeof item.title === 'string' &&
        typeof item.description === 'string' &&
        (item.naddr === null || typeof item.naddr === 'string') &&
        typeof item.revisionId === 'string' &&
        /^[0-9a-f]{64}$/.test(item.revisionId) &&
        (item.permalink === undefined ||
          (typeof item.permalink === 'string' && /^[a-z0-9-]+$/.test(item.permalink))) &&
        Number.isFinite(item.savedAt) &&
        prefix + savedId(item) === key
      )
        entries.push({ ...item, id: key.slice(prefix.length) });
    } catch {
      // Ignore a damaged entry. Other bookmarks are independent.
    }
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

// Independent keys let tabs update separate bookmarks without overwriting each other.
export function createSavedStore(storage: () => Storage) {
  let snapshot: SavedEntry[] | undefined;
  const listeners = new Set<() => void>();
  function read() {
    try {
      return readSaved(storage());
    } catch {
      return empty;
    }
  }
  function refresh() {
    snapshot = read();
    for (const listener of listeners) listener();
  }
  function externalChange(event: StorageEvent) {
    if (event.key === null || event.key.startsWith(prefix)) refresh();
  }
  return {
    snapshot: () => (snapshot ??= read()),
    subscribe(listener: () => void) {
      if (!listeners.size) {
        window.addEventListener('storage', externalChange);
        snapshot = read();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener('storage', externalChange);
          snapshot = undefined;
        }
      };
    },
    set(item: SavedNapplet, saved: boolean) {
      // Whitelist the display fields: callers can supply a larger signed release.
      const { title, description, naddr, revisionId, permalink } = item;
      const key = prefix + savedId(item);
      if (saved)
        storage().setItem(
          key,
          JSON.stringify({ title, description, naddr, revisionId, permalink, savedAt: Date.now() }),
        );
      else storage().removeItem(key);
      refresh();
    },
  };
}
export const savedNapplets = createSavedStore(() => window.localStorage);
