const IDS = ['s0', 's1', 's2', 's3', 's4'];
const VARS = ['--p', ...IDS.map((id) => `--p-${id}`)];
const SMOOTH = 8; // 클수록 스크롤을 빨리 따라간다 (1/s)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 네이티브 스크롤을 rAF에서 읽어 부드럽게 한 진행도.
 * --p: 문서 전체 0..1. --p-sN: 섹션 N의 위쪽이 뷰포트 위쪽에 닿을 때 0, 섹션이 끝날 때 1.
 * (위쪽이 뷰포트 위에 닿을 수 없는 짧은 마지막 섹션은 화면에 들어올 때 0, 문서 끝에서 1.)
 */
export function createScroll() {
  const root = document.documentElement;
  const els = IDS.map((id) => document.getElementById(id));
  const n = VARS.length;
  const start = new Float32Array(n);
  const span = new Float32Array(n).fill(1);
  const value = new Float32Array(n);
  const written = new Float32Array(n).fill(-1);

  const state = {
    p: 0,
    /** 링→구체 morph 0..1: S0을 지나 S1에 닿는 동안 */
    morph: 0,
    measure() {
      const y = window.scrollY;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      span[0] = max;
      els.forEach((el, i) => {
        if (!el) return;
        const top = el.getBoundingClientRect().top + y;
        const reachable = Math.min(el.offsetHeight, max - top);
        start[i + 1] = reachable > 0 ? top : top - window.innerHeight;
        span[i + 1] = Math.max(1, reachable > 0 ? reachable : max - start[i + 1]);
      });
    },
    update(dt: number) {
      const y = window.scrollY;
      const k = 1 - Math.exp(-dt * SMOOTH);
      for (let i = 0; i < n; i++) {
        const target = clamp01((y - start[i]) / span[i]);
        const v = value[i] + (target - value[i]) * k;
        value[i] = Math.abs(target - v) < 0.0005 ? target : v; // 끝값(0, 1)에 정확히 닿게 스냅
        // 값이 변했을 때만 스타일을 쓴다(정지 상태에서는 문자열 생성 없음)
        if (value[i] !== written[i]) {
          written[i] = value[i];
          root.style.setProperty(VARS[i], value[i].toFixed(4));
        }
      }
      state.p = value[0];
      const m = value[1];
      state.morph = m * m * (3 - 2 * m);
    },
  };
  state.measure();
  return state;
}
