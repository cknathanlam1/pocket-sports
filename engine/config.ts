// All tuning values live here. Starting points from the build spec; the dev panel (M3)
// exposes every numeric field as a slider and persists overrides to localStorage.
// Pure data: no DOM or Three.js imports anywhere under /engine.

export type Assist = 'easy' | 'normal' | 'pro';
export type CpuLevel = 'easy' | 'normal' | 'hard';

export const ITTF = {
  ballDiameter: 0.04, // m
  ballMass: 0.0027, // kg
  tableLength: 2.74, // m
  tableWidth: 1.525, // m
  tableHeight: 0.76, // m
  netHeight: 0.1525, // m
} as const;

export const defaultConfig = {
  physics: {
    stepHz: 240,
    gravity: 9.81, // m/s²
    dragK: 0.126, // 1/m — a = −k·|v|·v
    magnusK: 0.0056, // a = k·(ω × v)
    magnusMaxSpinRatio: 0.5, // linear Magnus up to r|ω|/|v| = this, then saturates
    restitution: Math.sqrt(23 / 30), // ≈ 0.88
    tableFriction: 0.25,
    maxSpin: 300, // rad/s
    gameSpeed: 0.85,
  },
  swing: {
    onsetDegPerSec: 300,
    refractoryMs: 250,
  },
  hit: {
    reachRadius: 0.6, // m
    ringBufferMs: 500,
  },
  shot: {
    speedCurve: { minDegPerSec: 300, minSpeed: 6, maxDegPerSec: 1500, maxSpeed: 18 },
    solverIterations: 8,
    scatter: 0.05, // m std dev at target
    faceFullDeg: 45, // paddle pitch that counts as fully open/closed
    depthBase: 0.85, // m past the net for a neutral face
    depthFaceRange: 0.35, // ± m of depth from face angle
    openSlowdown: 0.25, // fraction of pace lost with a fully open face
    lateralRange: 0.55, // m from centre for a full early/late offset
    pathFullDegPerSec: 600, // pitch rate that gives full top/backspin
    rollFullDegPerSec: 600, // roll rate that gives full sidespin
    topspinMax: 220, // rad/s
    sidespinMax: 120, // rad/s
    borderlineFactor: 1.6, // swings within window×this are borderline (may net or go long)
    minNetClear: 0.045, // m, ball centre above tape
  },
  assist: {
    easy: { timingWindowMs: 150, outPullBack: 0.7 },
    normal: { timingWindowMs: 100, outPullBack: 0.4 },
    pro: { timingWindowMs: 60, outPullBack: 0 },
  } satisfies Record<Assist, { timingWindowMs: number; outPullBack: number }>,
  cpu: {
    easy: { reactionMs: 300, aimErrorM: 0.35, maxShotSpeed: 10, spinUse: 0.1, errorRate: 0.15 },
    normal: { reactionMs: 180, aimErrorM: 0.2, maxShotSpeed: 14, spinUse: 0.4, errorRate: 0.08 },
    hard: { reactionMs: 100, aimErrorM: 0.1, maxShotSpeed: 18, spinUse: 0.8, errorRate: 0.03 },
  } satisfies Record<CpuLevel, { reactionMs: number; aimErrorM: number; maxShotSpeed: number; spinUse: number; errorRate: number }>,
  serve: {
    tossHeight: 0.3, // m
    contactAboveTable: 0.2, // m: ideal contact height on the way down
    minSpeed: 3, // m/s horizontal
    maxSpeed: 7,
    firstBounceDepth: 0.85, // m from the net on the server's half
    cpuDelayMs: 1200,
  },
  movement: {
    humanSpeed: 6, // m/s, auto-movement
    cpuSpeed: 3.5,
    contactPastBaseline: 0.3, // m: ideal contact is the apex after the bounce, or this far past the end line
  },
  match: {
    pointPauseMs: 1600,
  },
  net: {
    p2pTimeoutMs: 3000,
    clockSyncIntervalMs: 10_000,
    clockSyncSamples: 10,
    orientationHz: 60,
  },
  render: {
    trailMinSpeed: 12, // m/s
  },
};

export type Config = typeof defaultConfig;
