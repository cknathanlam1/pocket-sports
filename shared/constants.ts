export const DEV_SERVER_PORT = 8787;
export const DEV_CLIENT_PORT = 5173;
export const WS_PATH = '/ws';

/** Room codes: 4 letters, no ambiguous characters (I, L, O). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_IDLE_EXPIRY_MS = 10 * 60 * 1000;

/** Matches the controller route /p/:room. */
export const CONTROLLER_PATH_RE = /^\/p\/[A-Za-z]{4}\/?$/;
