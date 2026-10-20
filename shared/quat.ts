// Quaternion helpers on the wire format [x, y, z, w]. Shared by controller (sensor fusion) and display.
import type { Quat } from './protocol.ts';

export const IDENTITY: Quat = [0, 0, 0, 1];

export function fromAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

/** a · b (apply b first, then a). */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Inverse of a unit quaternion. */
export const invert = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/**
 * Paddle orientation relative to the calibration pose, in the calibrated device frame:
 *   paddle = q0⁻¹ · q
 * Calibration pose = phone upright in portrait, screen toward the player, back toward the laptop.
 * In that pose the device axes line up with the near player's paddle frame (x right, y up,
 * −z toward the opponent), so the result can be applied to the on-screen paddle directly.
 */
export function relativeTo(q0: Quat, q: Quat): Quat {
  return normalize(multiply(invert(q0), q));
}

export function normalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // Keep w ≥ 0 so consecutive samples don't flip sign (q and −q are the same rotation).
  const s = q[3] < 0 ? -1 / l : 1 / l;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

/** Rotate vector v by unit quaternion q. */
export function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
