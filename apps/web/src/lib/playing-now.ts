import { decodeAddress, encodeAddress, type SignedEvent } from '../../../../packages/protocol/src';
import {
  entryRef,
  joinConvention,
  type RoomEntry,
  type DirectoryRow,
} from '../../../../packages/multiplayer/src/directory';
import { intentContracts } from '../../../../packages/runtime/src/intent-session';

export function acceptsRoomEntry(event: Pick<SignedEvent, 'tags'>) {
  return intentContracts(event.tags).some((c) => c.convention === joinConvention);
}

export function roomPath(entry: RoomEntry) {
  const ref = entryRef.parse(entry);
  return (
    '/n/' +
    ref.napplet +
    '/play?' +
    new URLSearchParams({ room: ref.room, provider: ref.provider, protocol: ref.protocol })
  );
}
export function verifiedRoomEntry(href: string, event: SignedEvent, provider?: string) {
  try {
    const url = new URL(href);
    const match = /^\/n\/(naddr1[a-z0-9]+)\/play\/?$/.exec(url.pathname);
    if (
      !match ||
      !provider ||
      provider !== url.searchParams.get('provider') ||
      !acceptsRoomEntry(event)
    )
      return;
    const addr = decodeAddress(match[1]);
    if (
      addr.kind !== event.kind ||
      addr.pubkey !== event.pubkey ||
      addr.identifier !== (event.tags.find((t) => t[0] === 'd')?.[1] ?? '')
    )
      return;
    return entryRef.parse({
      version: 1,
      provider,
      napplet: encodeAddress(addr),
      protocol: url.searchParams.get('protocol'),
      room: url.searchParams.get('room'),
    });
  } catch {
    return;
  }
}

/** Reuse the provider's validated directory and compare signed publication identities, ignoring hints. */
export function openRoomFor(rows: DirectoryRow[], naddr: string, now = Date.now()) {
  const address = encodeAddress(decodeAddress(naddr));
  return rows.find(
    (r) =>
      r.entry.napplet === address && r.accepting && r.players < r.capacity && r.expiresAt > now,
  );
}
