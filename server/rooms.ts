// Rooms: one display + one phone per 4-letter code. Handles create/resume/join, forwards WebRTC
// signaling and relays peer messages when P2P is unavailable. Transport-agnostic (tests use fakes).
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, ROOM_IDLE_EXPIRY_MS } from '../shared/constants.ts';
import type { ClientMsg, Role, ServerMsg } from '../shared/protocol.ts';

export interface Sock {
  send(data: string): void;
  close(): void;
}

interface Room {
  code: string;
  token: string; // lets the display reclaim the room
  display: Sock | null;
  phone: Sock | null;
  pid: string | null;
  lastActive: number;
}

interface Session {
  role: Role | null;
  room: Room | null;
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private sessions = new Map<Sock, Session>();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(opts: { now?: () => number; random?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  get size(): number {
    return this.rooms.size;
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  connect(s: Sock): void {
    this.sessions.set(s, { role: null, room: null });
    this.send(s, { k: 'hello', serverTime: this.now() });
  }

  disconnect(s: Sock): void {
    const sess = this.sessions.get(s);
    this.sessions.delete(s);
    if (sess) this.leave(s, sess);
  }

  message(s: Sock, raw: string): void {
    const sess = this.sessions.get(s);
    if (!sess) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (sess.room) sess.room.lastActive = this.now();

    switch (msg.k) {
      case 'echo':
        return this.send(s, { k: 'echo', t0: msg.t0, t1: this.now() });
      case 'create': {
        this.leave(s, sess);
        const room: Room = { code: this.newCode(), token: this.newToken(), display: s, phone: null, pid: null, lastActive: this.now() };
        this.rooms.set(room.code, room);
        sess.role = 'display';
        sess.room = room;
        return this.send(s, { k: 'room', code: room.code, token: room.token });
      }
      case 'resume': {
        const code = String(msg.code).toUpperCase();
        // After a server restart (redeploy, free-tier spin-down) rooms are gone. Re-create the display's
        // room under the same code so the phone's rejoin still lands, as long as nobody took the code.
        if (!this.rooms.has(code) && this.validCode(code) && typeof msg.token === 'string' && msg.token.length >= 16) {
          this.rooms.set(code, { code, token: msg.token, display: null, phone: null, pid: null, lastActive: this.now() });
        }
        const room = this.rooms.get(code);
        if (!room) return this.send(s, { k: 'err', e: 'room-not-found' });
        if (room.token !== msg.token) return this.send(s, { k: 'err', e: 'bad-token' });
        this.leave(s, sess);
        if (room.display && room.display !== s) this.drop(room.display, 'replaced');
        room.display = s;
        room.lastActive = this.now();
        sess.role = 'display';
        sess.room = room;
        this.send(s, { k: 'room', code: room.code, token: room.token });
        if (room.phone) {
          this.send(s, { k: 'peer', up: true });
          this.send(room.phone, { k: 'peer', up: true });
        }
        return;
      }
      case 'join': {
        const room = this.rooms.get(String(msg.code).toUpperCase());
        if (!room) return this.send(s, { k: 'err', e: 'room-not-found' });
        this.leave(s, sess);
        // Latest phone wins: a rejoin (or a zombie socket) is replaced.
        if (room.phone && room.phone !== s) this.drop(room.phone, 'replaced');
        room.phone = s;
        room.pid = String(msg.pid);
        room.lastActive = this.now();
        sess.role = 'phone';
        sess.room = room;
        this.send(s, { k: 'joined', code: room.code });
        if (room.display) {
          this.send(s, { k: 'peer', up: true });
          this.send(room.display, { k: 'peer', up: true });
        }
        return;
      }
      case 'sig':
      case 'relay': {
        const peer = this.peerOf(sess);
        if (peer) peer.send(raw); // forward verbatim; no need to re-serialise
        return;
      }
      default:
        this.send(s, { k: 'err', e: 'bad-request' });
    }
  }

  /** Remove rooms idle for longer than the expiry. Returns expired codes. */
  sweep(): string[] {
    const cutoff = this.now() - ROOM_IDLE_EXPIRY_MS;
    const gone: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.lastActive >= cutoff) continue;
      for (const s of [room.display, room.phone]) if (s) this.drop(s, 'room-not-found');
      this.rooms.delete(code);
      gone.push(code);
    }
    return gone;
  }

  private peerOf(sess: Session): Sock | null {
    if (!sess.room) return null;
    return sess.role === 'display' ? sess.room.phone : sess.role === 'phone' ? sess.room.display : null;
  }

  /** Detach a socket from its room (the room itself lives on until it expires). */
  private leave(s: Sock, sess: Session): void {
    const room = sess.room;
    if (room) {
      if (room.display === s) {
        room.display = null;
        if (room.phone) this.send(room.phone, { k: 'peer', up: false });
      }
      if (room.phone === s) {
        room.phone = null;
        if (room.display) this.send(room.display, { k: 'peer', up: false });
      }
      room.lastActive = this.now();
    }
    sess.room = null;
    sess.role = null;
  }

  private drop(s: Sock, e: 'replaced' | 'room-not-found'): void {
    this.send(s, { k: 'err', e });
    const sess = this.sessions.get(s);
    if (sess) {
      sess.room = null;
      sess.role = null;
    }
  }

  private send(s: Sock, m: ServerMsg): void {
    try {
      s.send(JSON.stringify(m));
    } catch {
      /* socket closing */
    }
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_ALPHABET[Math.floor(this.random() * ROOM_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private validCode(c: string): boolean {
    return c.length === ROOM_CODE_LENGTH && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
  }

  private newToken(): string {
    return globalThis.crypto.randomUUID();
  }
}
