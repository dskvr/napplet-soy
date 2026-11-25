import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { backendProvider, blocked, manifestAllowed } from '@/lib/network';
import { availableCatalog, lookupProtocol } from '@/lib/protocol-catalog';
import { acceptsRoomEntry, openRoomFor, roomPath } from '@/lib/playing-now';
import { directoryPage, type DirectoryRow } from '../../../../packages/multiplayer/src/directory';
import { decodeAddress, encodeAddress } from '../../../../packages/protocol/src';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
type Row = DirectoryRow & { game: string };
const RoomDirectory = createContext<Row[]>([]);
export function RoomDirectoryProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const provider = backendProvider();
    if (!provider) return;
    let active = true,
      busy = false;
    let connection: import('../../../../packages/multiplayer/src/client').CvmConnection | undefined;

    async function refresh() {
      if (!provider || !active || busy || document.hidden) return;
      busy = true;
      try {
        const [{ CvmConnection }, { PrivateKeySigner }] = await Promise.all([
          import('../../../../packages/multiplayer/src/client'),
          import('@contextvm/sdk/signer'),
        ]);
        if (!active) return;
        if (!connection || connection.closed)
          connection = new CvmConnection(provider, new PrivateKeySigner());
        const page = directoryPage.parse(
          await connection.tool('soy_room_directory', { limit: 50 }),
        );
        const titles = new Map<string, PublicNapplet>();
        for (const n of availableCatalog())
          if (n.naddr) titles.set(encodeAddress(decodeAddress(n.naddr)), n);
        const next: Row[] = [];
        const candidates = page.rooms.filter(
          (r) =>
            r.entry.provider === provider.pubkey &&
            r.expiresAt > Date.now() &&
            !blocked('pubkey', decodeAddress(r.entry.napplet).pubkey),
        );
        // At most four uncached identities per refresh. Never use room-provided network URLs.
        const missing = [...new Set(candidates.map((r) => r.entry.napplet))]
          .filter((id) => !titles.has(id))
          .slice(0, 4);
        await Promise.allSettled(
          missing.map(async (id) => {
            const n = await lookupProtocol({ type: 'address', naddr: id });
            if (n) titles.set(id, n);
          }),
        );
        for (const r of candidates) {
          const n = titles.get(r.entry.napplet);
          if (
            n?.availability === 'ready' &&
            manifestAllowed(n.manifest) &&
            acceptsRoomEntry(n.manifest)
          )
            next.push({ ...r, game: n.title });
        }
        if (active)
          setRows(
            next
              .filter((r) => r.expiresAt > Date.now())
              .sort(
                (a, b) =>
                  Number(b.accepting && b.players < b.capacity) -
                  Number(a.accepting && a.players < a.capacity),
              ),
          );
      } catch {
        if (active) setRows((old) => old.filter((r) => r.expiresAt > Date.now()));
      } finally {
        busy = false;
      }
    }
    void refresh();
    const poll = setInterval(refresh, 20000);
    const expire = setInterval(
      () =>
        setRows((old) =>
          old.some((r) => r.expiresAt <= Date.now())
            ? old.filter((r) => r.expiresAt > Date.now())
            : old,
        ),
      1000,
    );
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(expire);
      document.removeEventListener('visibilitychange', refresh);
      void connection?.close();
    };
  }, []);
  return <RoomDirectory.Provider value={rows}>{children}</RoomDirectory.Provider>;
}

export function CardJoinRoom({ napplet }: { napplet: PublicNapplet }) {
  const rows = useContext(RoomDirectory);
  if (
    !rows.length ||
    !napplet.naddr ||
    napplet.availability !== 'ready' ||
    !acceptsRoomEntry(napplet.manifest)
  )
    return null;
  const room = openRoomFor(rows, napplet.naddr);
  if (!room) return null;
  return (
    <a
      className="card-join-room"
      href={roomPath(room.entry)}
      aria-label={`Join ${room.title} in ${napplet.title}, ${room.players} of ${room.capacity} players`}
    >
      Join room · {room.players}/{room.capacity} players
    </a>
  );
}

export function PlayingNow({ grid = false }: { grid?: boolean }) {
  return grid ? (
    <RoomDirectoryProvider>
      <RoomList grid />
    </RoomDirectoryProvider>
  ) : (
    <RoomList />
  );
}

function RoomList({ grid = false }: { grid?: boolean }) {
  const rows = useContext(RoomDirectory);
  if (!rows.length) return null;
  return (
    <section className={'playing-now ' + (grid ? 'gg-live' : '')} aria-label="Playing now">
      <h2>Playing now</h2>
      <ul>
        {rows.slice(0, 12).map((r) => (
          <li key={r.entry.room}>
            <div>
              <strong>{r.game}</strong> · {r.title}
              <small>
                {[
                  r.phase === 'playing' ? 'In progress' : 'In lobby',
                  r.players + '/' + r.capacity + ' players',
                  ...r.badges,
                ].join(' · ')}
              </small>
            </div>
            {r.accepting && r.players < r.capacity ? (
              <a href={roomPath(r.entry)} aria-label={'Join ' + r.title + ' in ' + r.game}>
                Join room →
              </a>
            ) : (
              <span>{r.players === r.capacity ? 'Full' : 'Closed to joins'}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
