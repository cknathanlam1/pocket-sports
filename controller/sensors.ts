// Browser sensor plumbing for the phone: permission, orientation stream, wake lock, portrait lock.
// All platform differences (iOS permission prompts, event availability) are handled here.
import type { Quat } from '../shared/protocol.ts';
import { eulerToQuat } from './orientation.ts';

export type Platform = 'ios' | 'android' | 'other';

export const platform: Platform = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? 'ios'
  : /Android/.test(navigator.userAgent)
    ? 'android'
    : 'other';

type PermissionFn = () => Promise<'granted' | 'denied'>;
const motionCtor = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : undefined) as unknown as { requestPermission?: PermissionFn } | undefined;
const orientCtor = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as unknown as { requestPermission?: PermissionFn } | undefined;

export const motionSupported = (): boolean => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';
export const needsPermission = (): boolean => typeof orientCtor?.requestPermission === 'function';

export type PermissionResult = 'granted' | 'denied' | 'unsupported' | 'insecure';

/** Must be called from a user gesture (iOS shows its prompt then). */
export async function requestMotion(): Promise<PermissionResult> {
  if (!window.isSecureContext) return 'insecure';
  if (!motionSupported()) return 'unsupported';
  try {
    // Call both in the same gesture, before any await, so iOS keeps the activation.
    const p1 = motionCtor?.requestPermission?.();
    const p2 = orientCtor?.requestPermission?.();
    const results = await Promise.all([p1, p2]);
    return results.every((r) => r === undefined || r === 'granted') ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Stream device orientation as quaternions. Resolves `false` if no events arrive within 1.5 s
 * (sensor blocked or absent, e.g. desktop browsers).
 */
export function watchOrientation(cb: (q: Quat, t: number) => void): { stop: () => void; firstEvent: Promise<boolean> } {
  let got = false;
  let resolveFirst: (v: boolean) => void = () => {};
  const firstEvent = new Promise<boolean>((r) => (resolveFirst = r));
  const onEvent = (e: DeviceOrientationEvent) => {
    if (e.alpha === null && e.beta === null && e.gamma === null) return;
    if (!got) {
      got = true;
      resolveFirst(true);
    }
    cb(eulerToQuat(e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0), e.timeStamp || performance.now());
  };
  window.addEventListener('deviceorientation', onEvent);
  const t = setTimeout(() => resolveFirst(got), 1500);
  return {
    stop: () => {
      clearTimeout(t);
      window.removeEventListener('deviceorientation', onEvent);
    },
    firstEvent,
  };
}

/** Keep the screen on. Re-acquires after the page becomes visible again. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  const acquire = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
    } catch {
      /* not supported / denied: fine */
    }
  };
  const onVis = () => void (document.visibilityState === 'visible' && acquire());
  document.addEventListener('visibilitychange', onVis);
  void acquire();
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release().catch(() => {});
  };
}

/** Best effort: Android can lock orientation (sometimes only in fullscreen); iOS can't (overlay instead). */
export async function tryLockPortrait(): Promise<void> {
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try {
    await so.lock?.('portrait');
  } catch {
    /* unsupported: the rotate-to-portrait overlay covers it */
  }
}

export function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS Safari has no web vibration */
  }
}
