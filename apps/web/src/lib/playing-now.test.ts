import { test, expect } from 'bun:test';
import { encodeAddress, type SignedEvent } from '../../../../packages/protocol/src';
import { matchesGallery } from '../../../../packages/protocol/src/topics';
import { roomPath, verifiedRoomEntry } from './playing-now';
test('a public entry opens only its verified address, provider and opted-in game', () => {
  const pubkey = 'a'.repeat(64),
    provider = 'b'.repeat(64);
  const napplet = encodeAddress({ kind: 35129, pubkey, identifier: 'game' });
  const entry = {
    version: 1 as const,
    provider,
    napplet,
    protocol: 'v1',
    room: crypto.randomUUID(),
  };
  const event = {
    kind: 35129,
    pubkey,
    tags: [
      ['d', 'game'],
      ['z', 'game'],
      ['i', 'napplet:game/join'],
    ],
  } as SignedEvent;
  const url = 'https://example.test' + roomPath(entry);
  expect(verifiedRoomEntry(url, event, provider)).toEqual(entry);
  expect(verifiedRoomEntry(url, { ...event, pubkey: provider }, provider)).toBeUndefined();
  expect(verifiedRoomEntry(url, event, pubkey)).toBeUndefined();
  expect(
    verifiedRoomEntry(url, { ...event, tags: event.tags.slice(0, 2) }, provider),
  ).toBeUndefined();
});
test('gamegrid includes archetype-only and tag-only games without changing gallery topic filters', () => {
  const item = {
    title: 'Boost Ball',
    creator: 'Player',
    description: '',
    topics: ['sport'],
    archetypes: ['game'],
  };
  const search = { q: '', tag: '', gamesOnly: true };
  expect(matchesGallery(item, search)).toBe(true);
  expect(matchesGallery({ ...item, archetypes: [], topics: ['game'] }, search)).toBe(true);
  expect(matchesGallery({ ...item, archetypes: [] }, search)).toBe(false);
  expect(matchesGallery(item, { tag: 'game', q: '' })).toBe(false);
});
