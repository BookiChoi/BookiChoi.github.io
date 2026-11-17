import { setInkDebug } from './debug';

// 이름 잉크: 2D 캔버스에 기본 글자색을 깔고 컬러 블롭을 그린다. 위에 겹친 h1(검정 바탕 + 흰 글자, multiply)이
// 글자 안쪽만 남기므로 캔버스에는 글자를 그리지 않는다. 합성 구조는 stage.css의 "이름 잉크" 참고.
const PALETTE = ['#7c9cff', '#b48cff', '#ff8fb8', '#6ee7ff', '#ffd76a']; // 히어로 이름에만 쓴다
const STEPS = 4; // 팔레트 이웃 색 사이 중간색 개수 → 스프라이트 5 × 4 = 20종
const MAX_BLOBS = 400;
const SPACING = 10; // 이동 px당 블롭 1개
const R_MIN = 28;
const R_MAX = 70;
const SPEED_MAX = 1500; // px/s: 이 속도에서 반지름 최대
const LIFE_MIN = 1.6;
const LIFE_MAX = 3.2;
const PAD = 120; // 이름 영역 밖 입력 허용 폭(px)
const IDLE_MS = 2500; // 포인터 입력이 이만큼 없으면 자동 스윕 가능
const SWEEP_GAP_MS = 6000;
const SWEEP_MS = 1600;
const FIRST_SWEEP_MS = 1200; // 이름 등장 연출이 끝나는 시점
const DPR_CAP = 1.5;
const SPRITE = 192;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 가장자리가 또렷한 페인트 방울: 코어는 거의 불투명, 끝에서 짧게 떨어진다 */
function makeSprites(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < PALETTE.length; i++) {
    const a = hex(PALETTE[i]!);
    const b = hex(PALETTE[(i + 1) % PALETTE.length]!);
    for (let k = 0; k < STEPS; k++) {
      const [r, g, bl] = a.map((v, j) => Math.round(v + (b[j]! - v) * (k / STEPS)));
      const c = document.createElement('canvas');
      c.width = c.height = SPRITE;
      const x = c.getContext('2d')!;
      const grad = x.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
      grad.addColorStop(0, `rgba(${r},${g},${bl},1)`);
      grad.addColorStop(0.82, `rgba(${r},${g},${bl},0.96)`);
      grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, SPRITE, SPRITE);
      out.push(c);
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

export function initInk(wrap: HTMLElement): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const found = wrap.querySelector('canvas');
  const c2d = found?.getContext('2d');
  if (!found || !c2d) return;
  const canvas: HTMLCanvasElement = found;
  const ctx: CanvasRenderingContext2D = c2d;

  const title = wrap.querySelector('h1') ?? wrap;
  const root = document.documentElement;
  const base = getComputedStyle(root).getPropertyValue('--text').trim() || '#ededf0';
  const sprites = makeSprites();

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
  let dpr = 1;
  let visible = true;
  let raf = 0;
  let last = 0;
  let time = 0;
  let lastInput = -Infinity;
  let sweepFlip = false;
  const sweep = { on: false, t: 0 };
  const pointer = newTrail();
  const sweepTrail = newTrail();
  let sweepTimer = 0;
  let nextReport = 0;

  const fill = () => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  };
  const resize = () => {
    w = Math.max(1, title.offsetWidth); // 패딩을 포함한 h1 상자 = 캔버스 상자
    h = Math.max(1, title.offsetHeight);
    dpr = Math.min(devicePixelRatio, DPR_CAP);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fill();
    draw();
  };

  const spawn = (x: number, y: number, speed: number, now: number) => {
    if (count >= MAX_BLOBS) return;
    const i = count++;
    bx[i] = x;
    by[i] = y;
    br[i] = R_MIN + (R_MAX - R_MIN) * clamp01(speed / SPEED_MAX);
    age[i] = 0;
    life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    // 이동 거리와 시간에 따라 팔레트를 천천히 순환
    col[i] = Math.floor(now * 0.0015 + (x + y) / 160) % sprites.length;
  };

  /** (x0,y0)→(x1,y1) 선을 따라 SPACING마다 블롭 생성 */
  const emitAlong = (tr: Trail, x: number, y: number, now: number) => {
    if (!tr.has) {
      tr.has = true;
      tr.x = x;
      tr.y = y;
      tr.acc = 0;
      tr.t = now;
      return;
    }
    const dx = x - tr.x;
    const dy = y - tr.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const inst = (dist / Math.max(1, now - tr.t)) * 1000;
    tr.speed += (inst - tr.speed) * 0.4;
    tr.t = now;
    let n = 0;
    tr.acc += dist;
    while (tr.acc >= SPACING && n++ < 12) {
      tr.acc -= SPACING;
      const f = 1 - tr.acc / dist;
      spawn(tr.x + dx * f, tr.y + dy * f, tr.speed, now);
    }
    tr.x = x;
    tr.y = y;
    ensureLoop();
  };

  function draw() {
    fill();
    for (let i = 0; i < count; i++) {
      const u = age[i]! / life[i]!;
      // 빠르게 나타나 0.55까지 유지하다가 기본색으로 서서히 용해
      const a = u < 0.06 ? u / 0.06 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      if (a <= 0) continue;
      const r = br[i]! * (1 + 0.3 * u);
      ctx.globalAlpha = a * a * (3 - 2 * a); // smoothstep으로 부드럽게
      ctx.drawImage(sprites[col[i]!]!, bx[i]! - r, by[i]! - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 30);
    last = now;
    time += dt;

    if (sweep.on) {
      sweep.t += dt * 1000;
      const u = clamp01(sweep.t / SWEEP_MS);
      const e = u * u * (3 - 2 * u);
      const p = sweepFlip ? 1 - e : e;
      emitAlong(sweepTrail, w * (0.03 + 0.94 * p), h * 0.5 + Math.sin(e * 5.5 + (sweepFlip ? 1 : 0)) * h * 0.22, now);
      if (u >= 1) {
        sweep.on = false;
        sweepTrail.has = false;
      }
    }

    for (let i = 0; i < count; ) {
      age[i]! < life[i]! ? update(i, dt) : remove(i);
      if (i < count && age[i]! < life[i]!) i++;
    }
    draw();

    if (now >= nextReport && document.getElementById('stage-debug')) {
      nextReport = now + 250;
      setInkDebug(`ink ${count}`);
    }
    if (count === 0 && !sweep.on) {
      stop();
      setInkDebug('ink 0'); // 기본색 한 장을 남기고 루프 정지
    }
  };
  // 낮은 주파수 swirl 흐름장으로 천천히 떠다닌다
  const update = (i: number, dt: number) => {
    age[i]! += dt;
    bx[i]! += Math.sin(by[i]! * 0.013 + time * 0.6) * 24 * dt;
    by[i]! += Math.cos(bx[i]! * 0.011 + time * 0.5) * 24 * dt;
  };
  const remove = (i: number) => {
    const j = --count;
    bx[i] = bx[j]!;
    by[i] = by[j]!;
    br[i] = br[j]!;
    age[i] = age[j]!;
    life[i] = life[j]!;
    col[i] = col[j]!;
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

  // 자동 스윕: 입력이 2.5초 없으면 가상 커서가 이름 위를 한 번 훑고, 약 6초 뒤 다시 확인한다
  const scheduleSweep = (ms: number) => {
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(trySweep, ms);
  };
  function trySweep() {
    const now = performance.now();
    if (!visible || document.hidden || sweep.on) return scheduleSweep(1000);
    const idle = now - lastInput;
    if (idle < IDLE_MS) return scheduleSweep(IDLE_MS - idle + 50);
    sweep.on = true;
    sweep.t = 0;
    sweepFlip = !sweepFlip;
    sweepTrail.has = false;
    ensureLoop();
    scheduleSweep(SWEEP_MS + SWEEP_GAP_MS);
  }

  // 입력: 이름 영역 + PAD 안에서만 생성. 터치도 같은 이벤트, preventDefault는 부르지 않아 스크롤을 막지 않는다
  addEventListener(
    'pointermove',
    (e) => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left - PAD && e.clientX <= r.right + PAD && e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD;
      if (!inside || !visible) {
        pointer.has = false;
        return;
      }
      lastInput = performance.now();
      emitAlong(pointer, e.clientX - r.left, e.clientY - r.top, lastInput);
    },
    { passive: true },
  );

  // S0가 20% 미만으로 보이거나 탭이 hidden이면 루프 중지
  const s0 = wrap.closest('section') ?? wrap;
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1]!.intersectionRatio >= 0.2;
      if (visible) {
        if (count > 0 || sweep.on) ensureLoop();
      } else stop();
    },
    { threshold: [0, 0.2, 1] },
  ).observe(s0);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : count > 0 || sweep.on ? ensureLoop() : 0));
  new ResizeObserver(resize).observe(title, { box: 'border-box' });

  resize();
  root.classList.add('ink-on'); // 첫 장을 그린 뒤에만 켠다
  resize(); // ink-on으로 h1 패딩이 생긴 크기에 맞춘다
  setInkDebug('ink 0');
  scheduleSweep(FIRST_SWEEP_MS);
}
