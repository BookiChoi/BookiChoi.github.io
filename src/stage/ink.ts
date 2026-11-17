import { DEBUG, debugLine } from './debug';

// 히어로 잉크: S0 전체를 덮는 투명 2D 캔버스에 광택 있는 페인트 블롭을 그린다(글자와 배경 위에 normal 합성).
// 블롭이 용해되면 아래의 배경과 글자가 그대로 드러난다. 글자는 DOM 그대로이고 캔버스에는 그리지 않는다.
const PALETTE = ['#ff2d75', '#ff9f1c', '#ffe14d', '#3ddc97', '#3a86ff', '#8338ec']; // 히어로에만 쓴다
const STEPS = 4; // 팔레트 이웃 색 사이 중간색 개수 → 스프라이트 6 × 4 = 24종
const MAX_BLOBS = 400;
const SPACING = 26; // 이동 px당 블롭 1개
const R_MIN = 50;
const R_MAX = 140;
const SPEED_MAX = 1800; // px/s: 이 속도에서 반지름 최대
const LIFE_MIN = 3;
const LIFE_MAX = 4;
const COLOR_STEP = 90; // 이 거리(px)를 움직일 때마다 다음 색으로
const CORE_ALPHA = 0.92; // 1보다 조금 낮아 겹친 블롭이 섞여 보인다
const IDLE_MS = 2500; // 포인터 입력이 이만큼 없으면 자동 스윕 가능
const SWEEP_GAP_MS = 6000;
const SWEEP_MS = 1800;
const FIRST_SWEEP_MS = 1200; // 이름 등장 연출이 끝나는 시점
const DPR_CAP = 1.5;
const SPRITE = 256;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 광택 있는 페인트 방울: 불투명에 가까운 코어, 가장자리의 어두운 테두리, 왼쪽 위 하이라이트 */
function makeSprites(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const c = SPRITE / 2;
  for (let i = 0; i < PALETTE.length; i++) {
    const a = hex(PALETTE[i]);
    const b = hex(PALETTE[(i + 1) % PALETTE.length]);
    for (let k = 0; k < STEPS; k++) {
      const [r, g, bl] = a.map((v, j) => Math.round(v + (b[j] - v) * (k / STEPS)));
      const rgba = (mul: number, alpha: number) => `rgba(${Math.round(r * mul)},${Math.round(g * mul)},${Math.round(bl * mul)},${alpha})`;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SPRITE;
      const x = canvas.getContext('2d');
      if (!x) continue;
      const body = x.createRadialGradient(c, c, 0, c, c, c);
      body.addColorStop(0, rgba(1, CORE_ALPHA));
      body.addColorStop(0.74, rgba(1, CORE_ALPHA));
      body.addColorStop(0.9, rgba(0.68, CORE_ALPHA)); // 어두운 테두리
      body.addColorStop(0.96, rgba(0.6, CORE_ALPHA * 0.8));
      body.addColorStop(1, rgba(0.6, 0));
      x.fillStyle = body;
      x.fillRect(0, 0, SPRITE, SPRITE);
      // 하이라이트는 방울이 있는 곳에만 얹는다
      x.globalCompositeOperation = 'source-atop';
      const shine = x.createRadialGradient(c * 0.68, c * 0.62, 0, c * 0.68, c * 0.62, c * 0.5);
      shine.addColorStop(0, 'rgba(255,255,255,0.6)');
      shine.addColorStop(0.5, 'rgba(255,255,255,0.14)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = shine;
      x.fillRect(0, 0, SPRITE, SPRITE);
      out.push(canvas);
    }
  }
  return out;
}

interface Trail {
  has: boolean;
  x: number;
  y: number;
  acc: number;
  speed: number;
  t: number;
}
const newTrail = (): Trail => ({ has: false, x: 0, y: 0, acc: 0, speed: 0, t: 0 });

/** canvas는 섹션(S0)을 꽉 채우는 잉크 캔버스. reduced-motion이면 아무것도 하지 않는다. */
export function initInk(canvas: HTMLCanvasElement): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const sprites = makeSprites();
  if (!ctx || !sprites.length) return;

  // 블롭 풀: 미리 만든 타입 배열. 죽은 블롭은 마지막 것과 자리를 바꿔 빼서 프레임당 할당이 없다.
  const bx = new Float32Array(MAX_BLOBS);
  const by = new Float32Array(MAX_BLOBS);
  const br = new Float32Array(MAX_BLOBS);
  const age = new Float32Array(MAX_BLOBS);
  const life = new Float32Array(MAX_BLOBS);
  const col = new Uint8Array(MAX_BLOBS);
  let count = 0;

  let w = 1;
  let h = 1;
  let visible = true;
  let raf = 0;
  let last = 0;
  let time = 0;
  let travel = 0; // 누적 이동 거리: 색 순환에 쓴다
  let lastInput = -Infinity;
  let sweeps = 0;
  const sweep = { on: false, t: 0 };
  const pointer = newTrail();
  const sweepTrail = newTrail();
  let sweepTimer = 0;
  let nextReport = 0;

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const u = age[i] / life[i];
      // 빠르게 나타나 0.6까지 유지하다가 서서히 용해
      const a = u < 0.05 ? u / 0.05 : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      if (a <= 0) continue;
      const r = br[i] * (1 + 0.25 * u);
      ctx.globalAlpha = a * a * (3 - 2 * a);
      ctx.drawImage(sprites[col[i]], bx[i] - r, by[i] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  };
  const resize = () => {
    w = Math.max(1, canvas.clientWidth);
    h = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(devicePixelRatio, DPR_CAP);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  const spawn = (x: number, y: number, speed: number) => {
    if (count >= MAX_BLOBS) return;
    const i = count++;
    bx[i] = x;
    by[i] = y;
    br[i] = R_MIN + (R_MAX - R_MIN) * clamp01(speed / SPEED_MAX);
    age[i] = 0;
    life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    col[i] = Math.floor(travel / COLOR_STEP) % sprites.length; // 이동에 따라 팔레트를 천천히 순환
  };

  /** 직전 위치에서 (x, y)까지 선을 따라 SPACING마다 블롭 생성. fixedSpeed를 주면 반지름을 그 속도 기준으로 정한다 */
  const emitAlong = (tr: Trail, x: number, y: number, now: number, fixedSpeed = -1) => {
    if (!tr.has) {
      tr.has = true;
      tr.x = x;
      tr.y = y;
      tr.acc = 0;
      tr.speed = 0;
      tr.t = now;
      return;
    }
    const dx = x - tr.x;
    const dy = y - tr.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    tr.speed += ((dist / Math.max(1, now - tr.t)) * 1000 - tr.speed) * 0.4;
    tr.t = now;
    tr.acc += dist;
    travel += dist;
    for (let n = 0; tr.acc >= SPACING && n < 12; n++) {
      tr.acc -= SPACING;
      const f = 1 - tr.acc / dist;
      spawn(tr.x + dx * f, tr.y + dy * f, fixedSpeed < 0 ? tr.speed : fixedSpeed);
    }
    tr.x = x;
    tr.y = y;
    ensureLoop();
  };

  // 낮은 주파수 swirl 흐름장으로 천천히 떠다닌다
  const update = (i: number, dt: number) => {
    age[i] += dt;
    bx[i] += Math.sin(by[i] * 0.008 + time * 0.6) * 22 * dt;
    by[i] += Math.cos(bx[i] * 0.007 + time * 0.5) * 22 * dt;
  };
  const remove = (i: number) => {
    const j = --count;
    bx[i] = bx[j];
    by[i] = by[j];
    br[i] = br[j];
    age[i] = age[j];
    life[i] = life[j];
    col[i] = col[j];
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 30);
    last = now;
    time += dt;

    if (sweep.on) {
      // 가상 커서가 화면 폭 전체를 부드러운 곡선으로 한 번 지나간다. 첫 스윕은 가장 굵게
      sweep.t += dt * 1000;
      const u = clamp01(sweep.t / SWEEP_MS);
      const e = u * u * (3 - 2 * u);
      const p = sweeps % 2 ? e : 1 - e;
      emitAlong(sweepTrail, w * (1.1 * p - 0.05), h * (0.5 + 0.17 * Math.sin(e * 5.5 + sweeps)), now, sweeps === 1 ? SPEED_MAX : SPEED_MAX * 0.45);
      if (u >= 1) {
        sweep.on = false;
        sweepTrail.has = false;
      }
    }

    for (let i = 0; i < count; ) {
      if (age[i] >= life[i]) remove(i); // 빈 자리에 온 블롭을 같은 인덱스에서 다시 본다
      else update(i++, dt);
    }
    draw();

    if (DEBUG && now >= nextReport) {
      nextReport = now + 250;
      debugLine('ink', `ink ${count}`);
    }
    if (count === 0 && !sweep.on) {
      stop(); // 그릴 것이 없으면 루프 정지(캔버스는 비어 있다)
      debugLine('ink', 'ink 0');
    }
  };

  function ensureLoop() {
    if (raf || !visible || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  const resume = () => {
    if (count > 0 || sweep.on) ensureLoop();
  };

  // 자동 스윕: 입력이 IDLE_MS 동안 없으면(터치 기기는 항상) 한 번 지나가고, 약 6초 뒤 다시 확인한다
  const scheduleSweep = (ms: number) => {
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(trySweep, ms);
  };
  function trySweep() {
    if (!visible || document.hidden || sweep.on) return scheduleSweep(1000);
    const idle = performance.now() - lastInput;
    if (idle < IDLE_MS) return scheduleSweep(IDLE_MS - idle + 50);
    sweep.on = true;
    sweep.t = 0;
    sweeps++;
    sweepTrail.has = false;
    ensureLoop();
    scheduleSweep(SWEEP_MS + SWEEP_GAP_MS);
  }

  // 입력: S0 위에서만 생성. 터치도 같은 이벤트이고 preventDefault를 부르지 않아 스크롤을 막지 않는다
  addEventListener(
    'pointermove',
    (e) => {
      const r = canvas.getBoundingClientRect();
      if (!visible || e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) {
        pointer.has = false;
        return;
      }
      lastInput = performance.now();
      emitAlong(pointer, e.clientX - r.left, e.clientY - r.top, lastInput);
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
        debugLine('ink', `ink ${count} (paused)`);
      }
    },
    { threshold: [0, 0.2, 1] },
  ).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : resume()));
  new ResizeObserver(resize).observe(canvas);

  resize();
  debugLine('ink', 'ink 0');
  scheduleSweep(FIRST_SWEEP_MS);
}
