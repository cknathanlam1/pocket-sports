import { describe, expect, it } from 'vitest';
import { eulerToQuat } from '../controller/orientation.ts';
import { fromAxisAngle, multiply, relativeTo, rotate } from '../shared/quat.ts';
import type { Quat } from '../shared/protocol.ts';

const D = Math.PI / 180;
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
const sameRotation = (a: Quat, b: Quat) => {
  // q and −q are the same rotation: compare via rotated basis vectors.
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Array<[number, number, number]>) close(rotate(a, v), rotate(b, v));
};

describe('device orientation → quaternion', () => {
  it('zero angles is identity', () => {
    sameRotation(eulerToQuat(0, 0, 0), [0, 0, 0, 1]);
  });

  it('matches the W3C intrinsic Z·X·Y composition for arbitrary angles', () => {
    for (const [a, b, g] of [[30, 45, -20], [200, -80, 60], [359, 89, -89], [10, 90, 0], [120, -170, 30]] as const) {
      const expected = multiply(fromAxisAngle(0, 0, 1, a * D), multiply(fromAxisAngle(1, 0, 0, b * D), fromAxisAngle(0, 1, 0, g * D)));
      sameRotation(eulerToQuat(a, b, g), expected);
    }
  });

  it('phone flat on a table, screen up: device z points up (earth z)', () => {
    close(rotate(eulerToQuat(0, 0, 0), [0, 0, 1]), [0, 0, 1]);
  });

  it('phone upright (beta = 90): top edge points up, screen faces the user (−north)', () => {
    const q = eulerToQuat(0, 90, 0);
    close(rotate(q, [0, 1, 0]), [0, 0, 1]); // device y → up
    close(rotate(q, [0, 0, 1]), [0, -1, 0]); // device z (out of screen) → toward user
  });
});

describe('calibration', () => {
  it('relative orientation is identity at the calibration pose', () => {
    const q0 = eulerToQuat(37, 85, -12);
    sameRotation(relativeTo(q0, q0), [0, 0, 0, 1]);
  });

  it('tilting the phone back (opening the face) is a rotation about device x', () => {
    const q0 = eulerToQuat(37, 88, 4);
    // Apply a 30° rotation about the device's own x axis (body frame): q = q0 · rx(30°)
    const q = multiply(q0, fromAxisAngle(1, 0, 0, 30 * D));
    sameRotation(relativeTo(q0, q), fromAxisAngle(1, 0, 0, 30 * D));
  });

  it('is independent of the compass heading at calibration (yaw drift cancels)', () => {
    const body = fromAxisAngle(0, 0, 1, 20 * D); // roll the phone about its long axis... in body frame
    for (const heading of [0, 90, 213]) {
      const q0 = eulerToQuat(heading, 80, 0);
      sameRotation(relativeTo(q0, multiply(q0, body)), body);
    }
  });
});
