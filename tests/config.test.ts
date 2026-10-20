import { describe, expect, it } from 'vitest';
import { defaultConfig, ITTF } from '../engine/config.ts';

describe('config', () => {
  it('derives drag and Magnus coefficients from ITTF ball constants', () => {
    const rho = 1.2;
    const area = Math.PI * (ITTF.ballDiameter / 2) ** 2;
    const kd = (0.5 * rho * 0.45 * area) / ITTF.ballMass;
    const km = (0.5 * rho * area * (ITTF.ballDiameter / 2)) / ITTF.ballMass;
    expect(defaultConfig.physics.dragK).toBeCloseTo(kd, 2);
    expect(defaultConfig.physics.magnusK).toBeCloseTo(km, 3);
  });

  it('restitution matches a 30 cm → 23 cm drop', () => {
    expect(0.3 * defaultConfig.physics.restitution ** 2).toBeCloseTo(0.23, 5);
  });

  it('a 240 Hz step at 20 m/s moves more than one ball diameter (swept collision required)', () => {
    expect(20 / defaultConfig.physics.stepHz).toBeGreaterThan(ITTF.ballDiameter);
  });
});
