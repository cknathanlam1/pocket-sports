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
