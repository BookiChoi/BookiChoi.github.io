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
