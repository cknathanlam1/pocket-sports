// Pure orientation math for the phone. No Euler angles leave this file: everything downstream
// uses quaternions. (DOM-free so it is unit-testable.)
import type { Quat } from '../shared/protocol.ts';

const DEG = Math.PI / 180;

/**
 * W3C DeviceOrientationEvent (alpha, beta, gamma in degrees; intrinsic Z-X'-Y'') → quaternion that
 * rotates device coordinates into the earth frame (x east, y north, z up).
 * Device frame (portrait): x right, y toward the top edge, z out of the screen.
 */
export function eulerToQuat(alpha: number, beta: number, gamma: number): Quat {
  const x = (beta || 0) * DEG;
  const y = (gamma || 0) * DEG;
  const z = (alpha || 0) * DEG;
  const cX = Math.cos(x / 2);
  const cY = Math.cos(y / 2);
  const cZ = Math.cos(z / 2);
  const sX = Math.sin(x / 2);
  const sY = Math.sin(y / 2);
  const sZ = Math.sin(z / 2);
  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
}
