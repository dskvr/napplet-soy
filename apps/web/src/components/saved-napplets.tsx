import { useState, useSyncExternalStore } from 'react';
import { Link } from '@tanstack/react-router';
import { Bookmark } from 'lucide-react';
import { savedId, savedNapplets, serverSaved, type SavedNapplet } from '@/lib/saved-napplets';
import { publicLink } from '../../../../packages/backend/src/public-model';
import { Button } from './ui/button';
import { useDiscoveryLink } from './discovery-navigation';
import './catalogue-cards.css';

const useSaved = () =>
  useSyncExternalStore(savedNapplets.subscribe, savedNapplets.snapshot, serverSaved);

export function SaveButton({ item, compact = false }: { item: SavedNapplet; compact?: boolean }) {
  const entries = useSaved();
  const id = savedId(item);
  const active = entries.some((entry) => entry.id === id);
  const [error, setError] = useState(false);
  const label = active ? 'Remove from Saved' : 'Save for later';
  return (
    <>
      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'icon-sm' : 'default'}
        title={label}
        aria-label={`${label}: ${item.title}`}
        aria-pressed={active}
        onClick={() => {
          try {
            savedNapplets.set(item, !active);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        <Bookmark aria-hidden="true" fill={active ? 'currentColor' : 'none'} />
        {!compact && (active ? 'Saved' : 'Save')}
      </Button>
      {error && (
        <span role="alert">Couldn't update Saved. Check browser storage and try again.</span>
      )}
    </>
  );
}

export function SavedLink() {
  const count = useSaved().length;
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to="/saved">
        <Bookmark aria-hidden="true" />
        Saved{count > 0 && ` (${count})`}
      </Link>
    </Button>
  );
}

export function SavedCollection() {
  const origin = useDiscoveryLink();
  const entries = useSaved();
  return (
    <section className="saved-collection">
      <Link to="/" hash="napplets">
        ← Explore napplets
      </Link>
      <h1>Saved napplets</h1>
      <p>Bookmarks you choose to keep in this browser.</p>
      {entries.length ? (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <Link {...publicLink(entry)} {...origin} preload={false}>
                  {entry.title}
                </Link>
                {entry.description && <p>{entry.description}</p>}
              </div>
              <SaveButton item={entry} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p>Choose the bookmark beside a napplet to find it here.</p>
      )}
    </section>
  );
}
