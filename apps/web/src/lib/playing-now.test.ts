import { test, expect } from 'bun:test';
import { encodeAddress, type SignedEvent } from '../../../../packages/protocol/src';
import { Rooms } from '../../../../packages/multiplayer/src/rooms';
import { directoryPage } from '../../../../packages/multiplayer/src/directory';
import { matchesGallery } from '../../../../packages/protocol/src/topics';
import { openRoomFor, roomPath, verifiedRoomEntry } from './playing-now';
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

test('a card offers only a live joinable room of the exact publication, independent of relay hints', () => {
  const address = { kind: 35129 as const, pubkey: 'a'.repeat(64), identifier: 'game' };
  const row = {
    title: 'Open lobby',
    phase: 'lobby' as const,
    accepting: true,
    players: 2,
    capacity: 6,
    expiresAt: 1000,
    badges: [],
    entry: {
      version: 1 as const,
      provider: 'b'.repeat(64),
      napplet: encodeAddress(address),
      protocol: 'game-v2',
      room: crypto.randomUUID(),
    },
  };
  const hints = encodeAddress(address, ['wss://relay.example']);
  const closed = [
    { ...row, players: 6 },
    { ...row, accepting: false },
    { ...row, expiresAt: 999 },
  ];
  expect(openRoomFor(closed, hints, 999)).toBeUndefined();
  expect(openRoomFor([...closed, row], hints, 999)).toEqual(row);
  expect(openRoomFor([row], hints, 1000)).toBeUndefined();
  expect(
    openRoomFor([row], encodeAddress({ ...address, pubkey: 'c'.repeat(64) }), 999),
  ).toBeUndefined();
  expect(roomPath(openRoomFor([row], hints, 999)!.entry)).toContain('room=' + row.entry.room);
});

test('card join survives different room protocols and the provider rechecks capacity at admission', () => {
  let now = 50;
  const rooms = new Rooms(() => now);
  const pubkey = '1'.repeat(64),
    provider = '2'.repeat(64);
  const napplet = encodeAddress({ kind: 35129, pubkey, identifier: 'race' });
  const game = {
    kind: 35129,
    pubkey,
    tags: [
      ['d', 'race'],
      ['z', 'game'],
      ['i', 'napplet:game/join'],
    ],
  } as SignedEvent;
  const listing = { title: 'Racing', phase: 'lobby', accepting: true, badges: [] };
  const old = rooms.create('host1', { napplet, protocol: 'v1', capacity: 2, name: 'Old room' });
  const current = rooms.create('host2', { napplet, protocol: 'v2', capacity: 2, name: 'New room' });
  rooms.advertise('host1', { room: old.room, listing: { ...listing, accepting: false } });
  rooms.advertise('host2', { room: current.room, listing });
  const open = () =>
    openRoomFor(directoryPage.parse(rooms.directory(provider, {})).rooms, napplet, now);
  const link = roomPath(open()!.entry);
  const ref = verifiedRoomEntry('https://shell.example' + link, game, provider);
  expect(ref?.protocol).toBe('v2');
  expect(ref?.room).toBe(current.room);
  rooms.enter('new-player', provider, ref);
  expect(open()).toBeUndefined();
  expect(() => rooms.enter('late-player', provider, ref)).toThrow('full');
  rooms.leave('new-player', { room: current.room });
  now += 60_001;
  expect(open()).toBeUndefined();
});
