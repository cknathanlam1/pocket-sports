import { describe, expect, it } from 'vitest';
import { ROOM_ALPHABET, ROOM_IDLE_EXPIRY_MS } from '../shared/constants.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { Rooms, type Sock } from '../server/rooms.ts';

class FakeSock implements Sock {
  inbox: ServerMsg[] = [];
  send(d: string) {
    this.inbox.push(JSON.parse(d) as ServerMsg);
  }
  close() {}
  last<K extends ServerMsg['k']>(k: K): Extract<ServerMsg, { k: K }> | undefined {
    return this.inbox.filter((m) => m.k === k).at(-1) as Extract<ServerMsg, { k: K }> | undefined;
  }
}

function setup() {
  let now = 1_000_000;
  const rooms = new Rooms({ now: () => now });
  const display = new FakeSock();
  rooms.connect(display);
  rooms.message(display, JSON.stringify({ k: 'create' }));
  const room = display.last('room')!;
  return { rooms, display, room, tick: (ms: number) => (now += ms) };
}

describe('rooms', () => {
  it('creates 4-letter codes without ambiguous characters', () => {
    const { room } = setup();
    expect(room.code).toMatch(/^[A-Z]{4}$/);
    for (const ch of room.code) expect(ROOM_ALPHABET).toContain(ch);
    for (const bad of 'ILO') expect(ROOM_ALPHABET).not.toContain(bad);
  });

  it('phone joins (case-insensitive); both sides get peer up; unknown code errors', () => {
    const { rooms, display, room } = setup();
    const phone = new FakeSock();
    rooms.connect(phone);
    rooms.message(phone, JSON.stringify({ k: 'join', code: 'ZZZZ', pid: 'a' }));
    expect(phone.last('err')?.e).toBe('room-not-found');
    rooms.message(phone, JSON.stringify({ k: 'join', code: room.code.toLowerCase(), pid: 'a' }));
    expect(phone.last('joined')?.code).toBe(room.code);
    expect(phone.last('peer')?.up).toBe(true);
    expect(display.last('peer')?.up).toBe(true);
  });

  it('relays and signaling are forwarded to the other side only', () => {
    const { rooms, display, room } = setup();
    const phone = new FakeSock();
    rooms.connect(phone);
    rooms.message(phone, JSON.stringify({ k: 'join', code: room.code, pid: 'a' }));
    rooms.message(phone, JSON.stringify({ k: 'relay', m: { k: 'tap', t: 5 } }));
    expect(display.last('relay')?.m).toEqual({ k: 'tap', t: 5 });
    rooms.message(display, JSON.stringify({ k: 'sig', d: { cand: { candidate: 'x' } } }));
    expect(phone.last('sig')?.d).toEqual({ cand: { candidate: 'x' } });
    expect(display.last('sig')).toBeUndefined();
  });

  it('phone disconnect notifies the display; rejoin with a new socket works', () => {
    const { rooms, display, room } = setup();
    const p1 = new FakeSock();
    rooms.connect(p1);
    rooms.message(p1, JSON.stringify({ k: 'join', code: room.code, pid: 'a' }));
    rooms.disconnect(p1);
    expect(display.last('peer')?.up).toBe(false);
    const p2 = new FakeSock();
    rooms.connect(p2);
    rooms.message(p2, JSON.stringify({ k: 'join', code: room.code, pid: 'a' }));
    expect(display.last('peer')?.up).toBe(true);
  });

  it('a second phone replaces the first', () => {
    const { rooms, room } = setup();
    const p1 = new FakeSock();
    const p2 = new FakeSock();
    rooms.connect(p1);
    rooms.connect(p2);
    rooms.message(p1, JSON.stringify({ k: 'join', code: room.code, pid: 'a' }));
    rooms.message(p2, JSON.stringify({ k: 'join', code: room.code, pid: 'b' }));
    expect(p1.last('err')?.e).toBe('replaced');
  });

  it('display can resume its room with the token after a reload', () => {
    const { rooms, display, room } = setup();
    rooms.disconnect(display);
    const d2 = new FakeSock();
    rooms.connect(d2);
    rooms.message(d2, JSON.stringify({ k: 'resume', code: room.code, token: 'nope' }));
    expect(d2.last('err')?.e).toBe('bad-token');
    rooms.message(d2, JSON.stringify({ k: 'resume', code: room.code, token: room.token }));
    expect(d2.last('room')?.code).toBe(room.code);
  });

  it('rooms expire after 10 minutes idle, not while active', () => {
    const { rooms, display, room, tick } = setup();
    tick(ROOM_IDLE_EXPIRY_MS - 1000);
    rooms.message(display, JSON.stringify({ k: 'echo', t0: 0 }));
    tick(ROOM_IDLE_EXPIRY_MS - 1000);
    expect(rooms.sweep()).toEqual([]);
    tick(2000);
    expect(rooms.sweep()).toEqual([room.code]);
    expect(rooms.has(room.code)).toBe(false);
  });
});
