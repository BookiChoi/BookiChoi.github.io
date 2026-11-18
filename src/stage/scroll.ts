import { PARAMS } from './params';

const IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6'];
const LAST = IDS.length - 1;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// 목표에 충분히 가까우면 스냅해서 끝값에 정확히 닿게 한다(정지 후에는 스타일 쓰기도 멈춘다)
const follow = (v: number, target: number, k: number) => (Math.abs(target - v) < 0.0005 ? target : v + (target - v) * k);

/**
 * 네이티브 스크롤(스냅 포함)을 rAF에서 읽어 부드럽게 한 진행도.
 * --sec: 연속 섹션 인덱스 0..6. 섹션 i의 top에서 i, 다음 섹션 top까지 선형. 마지막 섹션(s6 소개) 안에서는 6.
 * --p: 문서 전체 0..1.
 * --p-sN: 섹션 N의 가시 정도 = clamp(1 - |sec - N|). 화면에 딱 맞으면 1, 한 섹션 떨어지면 0.
 * 스테이지 루프가 돌 때만 갱신된다(reduced-motion / no-webgl에서는 값이 없다).
 */
export function createScroll() {
  const root = document.documentElement;
  const els = IDS.map((id) => document.getElementById(id));
  const tops = new Float32Array(IDS.length);
  const vis = new Float32Array(IDS.length).fill(-1); // 마지막으로 쓴 --p-sN
  let max = 1;
  let wroteSec = -1;
  let wroteP = -1;

  const state = {
    p: 0,
    sec: 0,
    measure() {
      const y = window.scrollY;
      max = Math.max(1, root.scrollHeight - window.innerHeight);
      els.forEach((el, i) => {
        if (el) tops[i] = el.getBoundingClientRect().top + y;
      });
    },
    update(dt: number) {
      const y = window.scrollY;
      let target = LAST;
      for (let i = 0; i < LAST; i++) {
        if (y < tops[i + 1]) {
          target = i + (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]);
          break;
        }
      }
      const k = 1 - Math.exp(-dt * PARAMS.secSmooth);
      const sec = (state.sec = follow(state.sec, Math.max(0, target), k));
      const p = (state.p = follow(state.p, clamp01(y / max), k));

      // 값이 변했을 때만 스타일을 쓴다(정지 상태에서는 문자열 생성 없음)
      if (p !== wroteP) root.style.setProperty('--p', (wroteP = p).toFixed(4));
      if (sec !== wroteSec) {
        root.style.setProperty('--sec', (wroteSec = sec).toFixed(4));
        for (let i = 0; i <= LAST; i++) {
          const v = clamp01(1 - Math.abs(sec - i));
          if (v !== vis[i]) {
            vis[i] = v;
            root.style.setProperty(`--p-${IDS[i]}`, v.toFixed(4));
          }
        }
      }
    },
  };
  state.measure();
  return state;
}
