import { DEBUG, debugLine } from './debug';

// 히어로 잉크: 포인터 궤적을 붓 획(ribbon)으로 그린다. 캔버스는 #s0 배경 위, h1 아래에 있어 글자를 덮지 않는다.
// 궤적 점을 큐에 두고 매 프레임 지운 뒤 곡선으로 이어 그린다. 획은 오래된 끝에서부터 가늘어지며 사라진다.
const PALETTE = ['#ff4d8d', '#ff9f1c', '#ffe14d', '#3ddc97', '#4cc9f0', '#a78bfa']; // 검정 글자가 읽히는 밝은 색
const LUT = 96; // 팔레트를 보간해 미리 만들어 두는 색 단계 수
const MAX_POINTS = 120;
const SPACING = 12; // 궤적 점 사이 최소 거리(px)
const WIDTH_PX = 70; // 획 최대 폭: min(WIDTH_PX, WIDTH_VW × 화면 폭)
const WIDTH_VW = 0.05;
const SLOW_WIDTH = 0.55; // 느리게 움직일 때의 폭 비율(빠르면 1까지)
const SPEED_MAX = 1400; // px/s: 이 속도에서 최대 폭
const LIFE = 2; // 궤적 점 수명(초)
const HOLD = 0.4; // 수명의 이 비율까지는 폭을 유지하고 그 뒤 가늘어진다
const AREA_CAP = 0.25; // 잉크가 덮을 수 있는 화면 비율 상한(경로 길이로 제한)
const COLOR_LEN = 1600; // 이 거리(px)를 움직이면 팔레트를 한 바퀴 돈다
const IDLE_MS = 2500; // 포인터 입력이 이만큼 없으면 자동 스윕 가능
const SWEEP_GAP_MS = 14000;
const SWEEP_MS = 1100;
const FIRST_SWEEP_MS = 1200; // 이름 등장 연출이 끝나는 시점
const DPR_CAP = 1.5;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => x * x * (3 - 2 * x);

/** 팔레트를 고리로 보간한 색 문자열 표. toward는 흰색 쪽으로 섞는 비율(하이라이트용) */
function makeColors(toward: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < LUT; i++) {
    const f = (i / LUT) * PALETTE.length;
    const a = hex(PALETTE[Math.floor(f) % PALETTE.length]);
    const b = hex(PALETTE[(Math.floor(f) + 1) % PALETTE.length]);
    const rgb = a.map((v, j) => {
      const c = v + (b[j] - v) * (f % 1);
      return Math.round(c + (255 - c) * toward);
    });
    out.push(`rgb(${rgb.join(',')})`);
  }
  return out;
}

interface Pen {
  has: boolean;
  x: number;
  y: number;
  t: number;
  speed: number;
}
const newPen = (): Pen => ({ has: false, x: 0, y: 0, t: 0, speed: 0 });

/** canvas는 섹션(S0)을 꽉 채우는 잉크 캔버스. reduced-motion이면 아무것도 하지 않는다. */
export function initInk(canvas: HTMLCanvasElement): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const title = canvas.parentElement?.querySelector('h1') ?? canvas;

  const body = makeColors(0);
  const shine = makeColors(0.5);
  // 그림자: 배경색보다 살짝 어두운 불투명 색(반투명이면 겹친 곳이 진해져 무늬가 생긴다)
  ctx.fillStyle = getComputedStyle(canvas.parentElement ?? canvas).backgroundColor;
  const bg = /^#[0-9a-f]{6}$/i.test(String(ctx.fillStyle)) ? hex(String(ctx.fillStyle)) : [239, 238, 234];
  const shadow = `rgb(${bg.map((v) => Math.round(v * 0.93)).join(',')})`;

  // 궤적 점 링 버퍼: 미리 만든 타입 배열이라 프레임당 할당이 없다
  const px = new Float32Array(MAX_POINTS);
  const py = new Float32Array(MAX_POINTS);
  const born = new Float64Array(MAX_POINTS); // 생성 시각(ms)
  const fat = new Float32Array(MAX_POINTS); // 속도에 따른 폭 비율
  const hue = new Uint8Array(MAX_POINTS); // 색 표 인덱스
  const brk = new Uint8Array(MAX_POINTS); // 1이면 새 획의 시작(앞 점과 잇지 않는다)
  const wid = new Float32Array(MAX_POINTS); // 이번 프레임의 폭(px)
  let start = 0;
  let count = 0;
  const at = (i: number) => (start + i) % MAX_POINTS;

  let w = 1;
  let h = 1;
  let maxWidth = WIDTH_PX;
  let visible = true;
  let raf = 0;
  let travel = 0; // 누적 이동 거리: 색 순환에 쓴다
  let lastInput = -Infinity;
  let sweeps = 0;
  let sweepStart = -1; // 스윕 시작 시각(ms), 아니면 -1
  let sweepTimer = 0;
  let nextReport = 0;
  // 획마다(포인터, 스윕) 직전 위치를 기억한다
  const pointer = newPen();
  const sweepPen = newPen();

  /** 한 겹 그리기: 점 k마다 (앞 점과의 중점 → k → 뒤 점과의 중점) 곡선 조각을 그 점의 폭으로 긋는다.
   *  조각끼리는 중점에서 접선이 이어지므로 butt 끝으로 잇고(둥근 끝이 겹치면 색 경계가 원으로 보인다), 획의 양 끝만 원으로 막는다 */
  const pass = (colors: string[] | null, scale: number, ox: number, oy: number) => {
    for (let k = 0; k < count; k++) {
      const i = at(k);
      const lw = wid[i] * scale;
      if (lw < 0.5) continue;
      const hasPrev = k > 0 && !brk[i];
      const hasNext = k < count - 1 && !brk[at(k + 1)];
      const p = at(k - 1 + MAX_POINTS);
      const n = at(k + 1);
      const dx = ox * wid[i];
      const dy = oy * wid[i];
      ctx.lineWidth = lw;
      ctx.strokeStyle = colors ? colors[hue[i]] : shadow;
      ctx.beginPath();
      ctx.moveTo((hasPrev ? (px[p] + px[i]) / 2 : px[i]) + dx, (hasPrev ? (py[p] + py[i]) / 2 : py[i]) + dy);
      ctx.quadraticCurveTo(px[i] + dx, py[i] + dy, (hasNext ? (px[n] + px[i]) / 2 : px[i]) + dx, (hasNext ? (py[n] + py[i]) / 2 : py[i]) + dy);
      ctx.stroke();
      if (!hasPrev || !hasNext) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(px[i] + dx, py[i] + dy, lw / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, w, h);
    // 폭 = 최대 폭 × 속도 비율 × 수명 taper × 길이 taper. 길이 상한이 잉크 면적을 AREA_CAP 아래로 묶는다
    const lengthCap = (AREA_CAP * w * h) / maxWidth;
    let along = 0;
    for (let k = count - 1; k >= 0; k--) {
      const i = at(k);
      if (k < count - 1 && !brk[at(k + 1)]) along += Math.hypot(px[at(k + 1)] - px[i], py[at(k + 1)] - py[i]);
      const left = 1 - (now - born[i]) / 1000 / LIFE;
      wid[i] = maxWidth * fat[i] * smooth(clamp01(left / (1 - HOLD))) * (1 - smooth(clamp01((along / lengthCap - 0.6) / 0.4)));
    }
    pass(null, 1, 0.05, 0.1); // 아주 옅은 그림자
    pass(body, 1, 0, 0); // 본체
    pass(shine, 0.25, -0.2, -0.2); // 광택: 왼쪽 위로 치우친 얇은 밝은 선
  };

  const resize = () => {
    w = Math.max(1, canvas.clientWidth);
    h = Math.max(1, canvas.clientHeight);
    maxWidth = Math.min(WIDTH_PX, WIDTH_VW * w);
    const dpr = Math.min(devicePixelRatio, DPR_CAP);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    draw(performance.now());
  };

  /** 펜을 (x, y)로 옮긴다. 충분히 움직였으면 궤적 점을 하나 넣는다. fixedFat을 주면 속도와 무관한 폭 */
  const moveTo = (pen: Pen, x: number, y: number, now: number, fixedFat = -1) => {
    const first = !pen.has;
    const dist = first ? 0 : Math.hypot(x - pen.x, y - pen.y);
    if (!first) {
      pen.speed += ((dist / Math.max(1, now - pen.t)) * 1000 - pen.speed) * 0.35;
      // 빠를수록 점 간격을 넓혀, 수명 안에 MAX_POINTS를 넘지 않게 한다(가득 차서 꼬리가 잘리는 일 방지)
      if (dist < Math.max(SPACING, (pen.speed * LIFE) / (MAX_POINTS - 10))) return;
    }
    if (count === MAX_POINTS) {
      start = at(1);
      count--;
    }
    const i = at(count++);
    px[i] = x;
    py[i] = y;
    born[i] = now;
    fat[i] = fixedFat >= 0 ? fixedFat : SLOW_WIDTH + (1 - SLOW_WIDTH) * clamp01(pen.speed / SPEED_MAX);
    travel += dist;
    hue[i] = Math.floor((travel / COLOR_LEN) * LUT) % LUT;
    brk[i] = first ? 1 : 0;
    pen.has = true;
    pen.x = x;
    pen.y = y;
    pen.t = now;
    ensureLoop();
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (sweepStart >= 0) {
      // 자동 스윕: 이름 가로 폭을 지나는 S자 획 하나
      const u = clamp01((now - sweepStart) / SWEEP_MS);
      const p = sweeps % 2 ? smooth(u) : 1 - smooth(u);
      const r = title.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      moveTo(sweepPen, r.left - c.left + r.width * (1.08 * p - 0.04), r.top - c.top + r.height * (0.5 - 0.34 * Math.sin(p * Math.PI * 2)), now, 1);
      if (u >= 1) {
        sweepStart = -1;
        sweepPen.has = false;
      }
    }
    while (count > 0 && now - born[start] >= LIFE * 1000) {
      // 수명이 끝난 점(폭 0)을 앞에서부터 뺀다. 다음 점은 새 획의 시작이 된다
      start = at(1);
      count--;
      if (count > 0) brk[start] = 1;
    }
    draw(now);

    if (DEBUG && now >= nextReport) {
      nextReport = now + 250;
      debugLine('ink', `ink ${count} pts`);
    }
    if (count === 0 && sweepStart < 0) {
      stop(); // 그릴 것이 없으면 루프 정지(캔버스는 비어 있다)
      debugLine('ink', 'ink 0 pts');
    }
  };

  function ensureLoop() {
    if (raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  const resume = () => {
    if (count > 0 || sweepStart >= 0) ensureLoop();
  };

  // 자동 스윕: 입력이 IDLE_MS 동안 없으면(터치 기기는 항상) 한 번 지나가고, SWEEP_GAP_MS 뒤 다시 확인한다
  const scheduleSweep = (ms: number) => {
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(trySweep, ms);
  };
  function trySweep() {
    if (!visible || document.hidden || sweepStart >= 0) return scheduleSweep(1000);
    const idle = performance.now() - lastInput;
    if (idle < IDLE_MS) return scheduleSweep(IDLE_MS - idle + 50);
    sweepStart = performance.now();
    sweeps++;
    sweepPen.has = false;
    ensureLoop();
    scheduleSweep(SWEEP_MS + SWEEP_GAP_MS);
  }

  // 입력: S0 위에서만. 터치도 같은 이벤트이고 preventDefault를 부르지 않아 스크롤을 막지 않는다
  addEventListener(
    'pointermove',
    (e) => {
      const r = canvas.getBoundingClientRect();
      if (!visible || e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) {
        pointer.has = false; // 밖으로 나갔다 들어오면 새 획
        return;
      }
      lastInput = performance.now();
      moveTo(pointer, e.clientX - r.left, e.clientY - r.top, lastInput);
    },
    { passive: true },
  );

  // S0가 20% 미만으로 보이거나 탭이 hidden이면 갱신하지 않는다
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].intersectionRatio >= 0.2;
      if (visible) resume();
      else {
        stop();
        debugLine('ink', `ink ${count} pts (paused)`);
      }
    },
    { threshold: [0, 0.2, 1] },
  ).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : resume()));
  new ResizeObserver(resize).observe(canvas);

  resize();
  debugLine('ink', 'ink 0 pts');
  scheduleSweep(FIRST_SWEEP_MS);
}
