import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { SignedEvent } from '../../../../packages/protocol/src';
import { Button } from './ui/button';

/**
 * Copyable Nostr identifiers for a napplet page: the addressable naddr (latest
 * publication) when one exists, and the nevent of the release shown here.
 */
export function NostrIdentifiers({
  naddr,
  release,
  relays,
}: {
  naddr: string | null;
  release: SignedEvent;
  relays: string[];
}) {
  const nevent = nip19.neventEncode({
    id: release.id,
    author: release.pubkey,
    kind: release.kind,
    relays: relays.slice(0, 8),
  });
  return (
    <>
      {naddr && <NostrIdentifier label="naddr" value={naddr} />}
      <NostrIdentifier label="nevent" value={nevent} />
    </>
  );
}

function NostrIdentifier({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div className="nostr-identifier">
      <span>{label}</span>
      <code title={value} data-testid={`napplet-${label}`}>
        {value}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setFeedback('copied');
          } catch {
            setFeedback('error');
          }
        }}
      >
        {feedback === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        <span role="status">
          {feedback === 'copied' ? 'Copied' : feedback === 'error' ? 'Select & copy' : ''}
        </span>
      </Button>
    </div>
  );
}
