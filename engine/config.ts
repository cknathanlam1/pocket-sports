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
    peakDropRatio: 0.8, // emit once |ω| falls below peak × this
    maxDurationMs: 400,
    rollAxis: 'z' as 'y' | 'z', // body axis for sidespin; y = long axis (spec), z = screen normal (default, see CLAUDE.md)
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
  // Beach volleyball (engine/volley). Court 16 × 8 m, net at z = 0. Rally scoring: every rally scores.
  volley: {
    gameSpeed: 0.8, // sim runs slower than real time so there's time to react
    gravity: 9.81,
    dragK: 0.018, // 1/m, a = −k·|v|·v (light ball, big cross-section)
    ballR: 0.105, // m
    halfL: 8, // m, half court length
    halfW: 4, // m, half court width
    netHeight: 2.35, // m (between the men's 2.43 and women's 2.24)
    netHalfW: 4.5, // m, antennas just outside the sidelines
    digHeight: 0.8, // m: ideal dig contact on the ball's way down
    setHeight: 2.4, // m: setter's hands
    attackHeight: 3.0, // m: top of the jump
    serveContact: 2.9, // m: jump-serve contact on the way down
    passApex: 4.3, // m above the sand
    setApex: 4.8,
    tossApex: 4.0,
    setterGap: 1.1, // m from the net where passes go
    attackGap: 1.4, // m from the net where sets go
    attackLane: 2.2, // m from the centre line (the attacker's side)
    spikeMin: 11, // m/s at the slowest swing
    spikeMax: 26, // m/s at the fastest
    tipSpeed: 8, // upward-brush swing = soft shot over the block
    serveMin: 9,
    serveMax: 19,
    windowScale: 1.5, // timing windows are the assist window × this (bigger, slower ball)
    lateralRange: 2.8, // m of aim from early/late timing
    depthNear: 2.6, // m past the net, closed face
    depthFar: 7.2, // m past the net, open face
    passErrorM: 1.4, // m: borderline dig lands this far off target
    humanSpeed: 7, // m/s auto-movement
    mateSpeed: 6.5,
    pointsToWin: 21,
    decidingSetPoints: 15,
    cpuServeDelayMs: 1400,
    cpu: {
      easy: { digRate: 0.6, attackSpeed: 14, aimErrorM: 1.2, errorRate: 0.14 },
      normal: { digRate: 0.72, attackSpeed: 18, aimErrorM: 0.8, errorRate: 0.08 },
      hard: { digRate: 0.84, attackSpeed: 22, aimErrorM: 0.5, errorRate: 0.04 },
    } satisfies Record<CpuLevel, { digRate: number; attackSpeed: number; aimErrorM: number; errorRate: number }>,
  },
  net: {
    p2pTimeoutMs: 3000,
    clockSyncIntervalMs: 10_000,
    clockSyncSamples: 10,
    orientationHz: 60,
  },
  render: {
    trailMinSpeed: 12, // m/s
    // Adaptive resolution (display only): start at min(devicePixelRatio, maxPixelRatio); if frames average
    // over slowFrameMs for ~2 s, step the pixel ratio down by 0.25 (never below minPixelRatio). One-way per session:
    // the frame interval can't show headroom at the display's refresh cap, so stepping back up would oscillate.
    maxPixelRatio: 2,
    minPixelRatio: 1,
    slowFrameMs: 19,
  },
};

export type Config = typeof defaultConfig;
