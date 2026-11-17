export const TIERS = [512, 256, 128] as const;
export type Tier = (typeof TIERS)[number];

const KEY = 'stage-tier';

export const isMobile = () => matchMedia('(pointer: coarse)').matches || innerWidth <= 760;
export const dprCap = (mobile: boolean) => (mobile ? 1.5 : 2);

/** 기기 기본 tier와 이 세션에서 이미 낮춰 둔 tier 중 낮은 쪽. */
export function initialTier(mobile: boolean): Tier {
  const base: Tier = mobile ? 128 : 512;
  let saved: number = base;
  try {
    saved = Number(sessionStorage.getItem(KEY));
  } catch {
    // 저장소 접근 불가: 기본값 사용
  }
  return TIERS.find((t) => t === saved && t < base) ?? base;
}

export function saveTier(tier: Tier): void {
  try {
    sessionStorage.setItem(KEY, String(tier));
  } catch {
    // 저장 실패는 무시 (다음 로드에서 다시 측정)
  }
}

export const lowerTier = (tier: Tier): Tier | undefined => TIERS[TIERS.indexOf(tier) + 1];

/** 최근 n프레임 dt(초)의 이동평균 FPS. push에서 할당 없음. */
export function createFpsMeter(n = 60) {
  const buf = new Float32Array(n);
  let i = 0;
  let count = 0;
  let sum = 0;
  return {
    push(dt: number) {
      const old = buf[i];
      buf[i] = dt;
      sum += buf[i] - old; // 저장된(Float32) 값끼리 더하고 빼서 오차가 쌓이지 않게 한다
      i = (i + 1) % n;
      if (count < n) count++;
    },
    get fps() {
      return sum > 0 ? count / sum : 0;
    },
    get count() {
      return count;
    },
    reset() {
      buf.fill(0);
      i = count = sum = 0;
    },
  };
}

/**
 * tier 하향 판정. windowMs마다 평균 FPS를 내고, minFps 미만인 윈도우가 연속 `needed`번이면 true를 돌려준다.
 * 일시적 끊김 한 번(나쁜 윈도우 1개)으로는 내려가지 않는다.
 */
export function createDownshiftGate(minFps = 45, windowMs = 2000, needed = 2) {
  let frames = 0;
  let elapsed = 0;
  let strikes = 0;
  let ignore = false;
  return {
    /** 프레임마다 직전 프레임 간격(ms)을 넘긴다. 지금 한 단계 낮춰야 하면 true. */
    frame(dtMs: number): boolean {
      frames++;
      elapsed += dtMs;
      if (elapsed < windowMs) return false;
      const fps = (frames * 1000) / elapsed;
      frames = 0;
      elapsed = 0;
      if (ignore) {
        ignore = false;
        return false;
      }
      strikes = fps < minFps ? strikes + 1 : 0;
      if (strikes < needed) return false;
      strikes = 0;
      return true;
    },
    /** 탭 복귀나 tier 교체 직후: 누적을 버리고, 새로 시작하는 첫 윈도우는 판정하지 않는다. */
    restart() {
      frames = 0;
      elapsed = 0;
      strikes = 0;
      ignore = true;
    },
  };
}
