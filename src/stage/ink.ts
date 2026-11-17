import { DEBUG, debugLine } from './debug';
import { compositeFrag, fieldFrag, inkVert, MAX_STAMPS } from './inkShaders';

// 히어로 잉크 리빌(WebGL2, three 미사용, 메인 스테이지와 별개의 컨텍스트).
// 포인터 궤적을 저해상도 필드에 스탬프로 누적하고(마스크), 합성 셰이더가 그 안에만 흐르는 잉크 텍스처를 보여 준다.
// 캔버스가 S0 배경 + 잉크 + 이름 글자까지 불투명하게 그리고, 잉크 안 글자는 흰색으로 반전된다.
// DOM h1은 접근성용으로 남기고, 잉크가 켜졌을 때(html.ink-on)만 글자색을 투명하게 한다.
const PALETTE = ['#ff2d9a', '#ff9f1c', '#7b2ff7', '#1f6bff', '#22d3ee']; // 고리로 보간
const DEEP = '#0d1757'; // 깊이감용 어두운 군청(소량)
const OCTAVES = 5; // fbm 옥타브. 느리면 4 → 3
const DPR_CAP = 1.5;
const FIELD_SCALE = 0.25; // 마스크 필드 해상도(캔버스 픽셀 대비)
const RADIUS_VW = [0.04, 0.07]; // 보이는 반경: 뷰포트 폭 비율(느림 → 빠름)
const SPEED_MAX = 1600; // px/s: 이 속도에서 최대 반경
const DROP_EVERY = 70; // 이 거리(px)마다 물방울 스탬프를 떨어뜨릴 기회
const DROP_CHANCE = 0.45;
const KEEP_RATE = 0.4; // 필드 감쇠: f × e^(−KEEP_RATE·t) − SUB_RATE·t. 약 1.8초 뒤 임계 아래로
const SUB_RATE = 0.12;
const BLUR_RATE = 12; // 블러 세기(1/s)
const VIS_LIFE = 1.9; // 스탬프가 보이는 시간(초). 면적 추정용
const STOP_MS = 2400; // 마지막 스탬프 뒤 이 시간이 지나면 필드를 지우고 루프를 멈춘다(보이는 잉크는 그 전에 이미 0%)
const AREA_CAP = 0.25; // 잉크 면적 상한(화면 비율). 넘으면 스탬프 세기를 임계 아래로 줄인다
const SHADOW_PX = [7, 10]; // 그림자 오프셋(오른쪽, 아래)
const IDLE_MS = 2500; // 포인터 입력이 이만큼 없으면 자동 스윕 가능
const SWEEP_GAP_MS = 14000;
const SWEEP_MS = 1100;
const AREA_SLOTS = 256;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => x * x * (3 - 2 * x);

interface Pen {
  has: boolean;
  x: number;
  y: number;
  t: number;
  speed: number;
}
const newPen = (): Pen => ({ has: false, x: 0, y: 0, t: 0, speed: 0 });

/** canvas는 S0를 꽉 채우는 잉크 캔버스. reduced-motion, WebGL2 없음, 셰이더 실패면 아무것도 하지 않는다(DOM 이름이 그대로 보인다). */
export function initInk(canvas: HTMLCanvasElement): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  const title = canvas.parentElement?.querySelector('h1');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  const textCanvas = document.createElement('canvas');
  const tx = textCanvas.getContext('2d');
  if (!gl || !tx || !title) return;
  const letters = [...title.querySelectorAll<HTMLElement>('.word span')];

  // --- 프로그램 ---
  const compile = (vs: string, fs: string) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  };
  const fieldProg = compile(inkVert, fieldFrag);
  const compProg = compile(inkVert, compositeFrag(OCTAVES));
  if (!fieldProg || !compProg) return;
  const locs = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const uf = locs(fieldProg, ['uPrev', 'uTexel', 'uSize', 'uBlur', 'uKeep', 'uSub', 'uCount', 'uSeg', 'uRS']);
  const uc = locs(compProg, ['uField', 'uText', 'uSize', 'uShadowOff', 'uFlow', 'uTime', 'uBg', 'uFg', 'uShadow', 'uPal', 'uDeep']);

  // --- 색: CSS 변수(--hero-bg, --hero-fg)를 2D 캔버스로 정규화해서 읽는다 ---
  const rgb = (css: string, fallback: string) => {
    tx.fillStyle = fallback;
    tx.fillStyle = css.trim() || fallback;
    const h = String(tx.fillStyle);
    return /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) : [0.94, 0.93, 0.92];
  };
  const css = getComputedStyle(root);
  const bg = rgb(css.getPropertyValue('--hero-bg'), '#efeeea');
  const fg = rgb(css.getPropertyValue('--hero-fg'), '#0a0a0a');
  const shadow = bg.map((v) => v * 0.86);
  const pal = new Float32Array(PALETTE.flatMap((c) => rgb(c, c)));
  const deep = rgb(DEEP, DEEP);
  gl.useProgram(compProg);
  gl.uniform3fv(uc.uBg, bg);
  gl.uniform3fv(uc.uFg, fg);
  gl.uniform3fv(uc.uShadow, shadow);
  gl.uniform3fv(uc.uPal, pal);
  gl.uniform3fv(uc.uDeep, deep);
  gl.uniform1i(uc.uField, 0);
  gl.uniform1i(uc.uText, 1);
  gl.useProgram(fieldProg);
  gl.uniform1i(uf.uPrev, 0);

  // --- 필드 텍스처: half float 렌더가 되면 R16F, 아니면 RGBA8 ---
  const halfOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  let useHalf = halfOk;
  type Target = { tex: WebGLTexture; fb: WebGLFramebuffer };
  let targets: Target[] = [];
  let cur = 0;
  const makeTarget = (w: number, h: number): Target | null => {
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useHalf) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!ok) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fb);
      return null;
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb };
  };
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // --- 상태 ---
  let w = 1;
  let h = 1;
  let dpr = 1;
  let fw = 1;
  let fh = 1;
  let ready = false; // 글자 텍스처가 준비되고 ink-on이 붙었는지
  let dead = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let time = 0;
  let lastInput = -Infinity;
  let lastStamp = -Infinity;
  let sweeps = 0;
  let sweepStart = -1;
  let sweepTimer = 0;
  let nextReport = 0;
  let dropAcc = 0;
  let flowX = 0;
  let flowY = 0;
  let flowVX = 0;
  let flowVY = 0;
  // 이번 프레임의 스탬프(선분). 미리 만든 배열이라 프레임당 할당이 없다
  const seg = new Float32Array(MAX_STAMPS * 4);
  const rs = new Float32Array(MAX_STAMPS * 2);
  let stamps = 0;
  // 면적 추정: 최근 스탬프가 새로 덮은 넓이(px²)와 시각
  const areaBorn = new Float64Array(AREA_SLOTS).fill(-Infinity);
  const areaPx = new Float32Array(AREA_SLOTS);
  let areaHead = 0;
  let areaEst = 0;
  const pointer = newPen();
  const sweepPen = newPen();

  const estimate = (now: number) => {
    let sum = 0;
    for (let i = 0; i < AREA_SLOTS; i++) {
      const age = (now - areaBorn[i]) / 1000 / VIS_LIFE;
      if (age < 1) sum += areaPx[i] * (1 - age);
    }
    return sum / (w * h);
  };
  const addArea = (px: number, now: number) => {
    areaBorn[areaHead] = now;
    areaPx[areaHead] = px;
    areaHead = (areaHead + 1) % AREA_SLOTS;
  };

  /** 스탬프 1개(선분 a→b, 보이는 반경 vis). 한 프레임에 MAX_STAMPS를 넘으면 마지막 선분을 늘린다 */
  const stamp = (x0: number, y0: number, x1: number, y1: number, vis: number, now: number, dot: boolean) => {
    // 면적 상한: 추정 면적이 상한의 80%를 넘으면 세기를 줄이고, 상한에서는 임계(0.46) − 노이즈 아래로 내린다
    const s = 1 - 0.75 * clamp01((areaEst / AREA_CAP - 0.8) / 0.2);
    const shown = clamp01((s - 0.3) / 0.7);
    const len = Math.hypot(x1 - x0, y1 - y0);
    addArea((len * 2 * vis + (dot ? Math.PI * vis * vis : 0)) * shown, now);
    if (shown > 0) lastStamp = now;
    let k = stamps;
    if (k === MAX_STAMPS) {
      k = MAX_STAMPS - 1;
      x0 = seg[k * 4];
      y0 = seg[k * 4 + 1];
      vis = Math.max(vis, rs[k * 2] / 2);
    } else stamps++;
    seg[k * 4] = x0;
    seg[k * 4 + 1] = y0;
    seg[k * 4 + 2] = x1;
    seg[k * 4 + 3] = y1;
    rs[k * 2] = vis * 2; // 커널 반경: 값이 반경의 절반에서 0.5(임계)
    rs[k * 2 + 1] = s;
  };

  /** 펜을 (x, y)로 옮기며 스탬프를 찍는다. fixedSpeed를 주면 속도와 무관한 반경 */
  const moveTo = (pen: Pen, x: number, y: number, now: number, fixedSpeed = -1) => {
    if (!ready || dead) return;
    const first = !pen.has;
    const dx = first ? 0 : x - pen.x;
    const dy = first ? 0 : y - pen.y;
    const dist = Math.hypot(dx, dy);
    if (!first) {
      const dtp = Math.max(1, now - pen.t) / 1000;
      pen.speed += (dist / dtp - pen.speed) * 0.35;
      flowVX += (dx / dtp / Math.min(w, h) - flowVX) * 0.2;
      flowVY += (dy / dtp / Math.min(w, h) - flowVY) * 0.2;
    }
    const speed = fixedSpeed >= 0 ? fixedSpeed : pen.speed;
    const vis = w * (RADIUS_VW[0] + (RADIUS_VW[1] - RADIUS_VW[0]) * clamp01(speed / SPEED_MAX));
    stamp(first ? x : pen.x, first ? y : pen.y, x, y, vis, now, first);
    // 물방울: 궤적 옆에 작은 원
    dropAcc += dist;
    while (dropAcc > DROP_EVERY && dist > 0) {
      dropAcc -= DROP_EVERY;
      if (Math.random() > DROP_CHANCE) continue;
      const side = (Math.random() < 0.5 ? -1 : 1) * vis * (1.1 + Math.random() * 0.5);
      const r = vis * (0.25 + Math.random() * 0.2);
      const ox = x - (dx / dist) * Math.random() * dist - (dy / dist) * side;
      const oy = y - (dy / dist) * Math.random() * dist + (dx / dist) * side;
      stamp(ox, oy, ox, oy, r, now, true);
    }
    pen.has = true;
    pen.x = x;
    pen.y = y;
    pen.t = now;
    ensureLoop();
  };

  // --- 그리기 ---
  const fieldPass = (dt: number) => {
    const [a, b] = [targets[cur], targets[1 - cur]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(fieldProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.uniform2f(uf.uTexel, 1 / fw, 1 / fh);
    gl.uniform2f(uf.uSize, w, h);
    gl.uniform1f(uf.uBlur, 1 - Math.exp(-BLUR_RATE * dt));
    gl.uniform1f(uf.uKeep, Math.exp(-KEEP_RATE * dt));
    gl.uniform1f(uf.uSub, SUB_RATE * dt);
    gl.uniform1i(uf.uCount, stamps);
    gl.uniform4fv(uf.uSeg, seg);
    gl.uniform2fv(uf.uRS, rs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
    stamps = 0;
  };
  const composite = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.uniform2f(uc.uSize, w, h);
    gl.uniform2f(uc.uShadowOff, SHADOW_PX[0] / w, -SHADOW_PX[1] / h);
    gl.uniform2f(uc.uFlow, flowX, flowY);
    gl.uniform1f(uc.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const clearField = () => {
    for (const t of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };

  /** 이름 글자를 오프스크린 캔버스에 DOM과 같은 위치·폰트로 그려 텍스처로 올린다 */
  const buildText = () => {
    const c = canvas.getBoundingClientRect();
    textCanvas.width = canvas.width;
    textCanvas.height = canvas.height;
    tx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tx.clearRect(0, 0, w, h);
    tx.fillStyle = '#fff';
    tx.textBaseline = 'alphabetic';
    for (const el of letters) {
      const ch = el.textContent ?? '';
      const s = getComputedStyle(el);
      tx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const r = el.getBoundingClientRect();
      const m = tx.measureText(ch);
      // inline-block 글자 상자 안의 기준선: CSS half-leading과 같은 계산
      const base = r.top - c.top + (r.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
      tx.fillText(ch, r.left - c.left, base);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  const resize = () => {
    if (dead) return;
    w = Math.max(1, canvas.clientWidth);
    h = Math.max(1, canvas.clientHeight);
    dpr = Math.min(devicePixelRatio, DPR_CAP);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    fw = Math.max(1, Math.round(canvas.width * FIELD_SCALE));
    fh = Math.max(1, Math.round(canvas.height * FIELD_SCALE));
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    let a = makeTarget(fw, fh);
    if (!a && useHalf) {
      useHalf = false; // half float 렌더 타깃이 안 되면 8비트로
      a = makeTarget(fw, fh);
    }
    const b = a && makeTarget(fw, fh);
    if (!a || !b) return fail();
    targets = [a, b];
    cur = 0;
    if (ready) {
      buildText();
      composite();
    }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    time += dt;
    if (sweepStart >= 0) {
      // 자동 스윕: 이름 가로 폭을 지나는 S자 궤적 하나
      const u = clamp01((now - sweepStart) / SWEEP_MS);
      const p = sweeps % 2 ? smooth(u) : 1 - smooth(u);
      const r = title.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      moveTo(sweepPen, r.left - c.left + r.width * (1.08 * p - 0.04), r.top - c.top + r.height * (0.5 - 0.34 * Math.sin(p * Math.PI * 2)), now, SPEED_MAX * 0.5);
      if (u >= 1) {
        sweepStart = -1;
        sweepPen.has = false;
      }
    }
    // 흐름: 포인터 이동 방향으로 잉크 무늬가 끌려간다(uv는 y가 위)
    flowX -= flowVX * dt * 0.12;
    flowY += flowVY * dt * 0.12;
    flowVX *= Math.exp(-2 * dt);
    flowVY *= Math.exp(-2 * dt);
    areaEst = estimate(now);
    fieldPass(dt);
    composite();

    if (DEBUG && now >= nextReport) {
      nextReport = now + 250;
      debugLine('ink', `ink run  area~${Math.round(areaEst * 100)}%  ${useHalf ? 'R16F' : 'RGBA8'}`);
    }
    if (sweepStart < 0 && now - lastStamp > STOP_MS) {
      // 필드는 이미 임계 아래다. 0으로 지우고 깨끗한 프레임(배경 + 검정 글자)을 남긴 뒤 멈춘다
      clearField();
      composite();
      stop();
      debugLine('ink', `ink idle  ${useHalf ? 'R16F' : 'RGBA8'}`);
    }
  };

  function ensureLoop() {
    if (raf || dead || !ready || !visible || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function fail() {
    dead = true;
    stop();
    clearTimeout(sweepTimer);
    root.classList.remove('ink-on'); // DOM 검정 이름으로 돌아간다
    debugLine('ink', 'ink off');
  }
  const resume = () => {
    if (sweepStart >= 0 || performance.now() - lastStamp <= STOP_MS) ensureLoop();
  };

  // 자동 스윕: 입력이 IDLE_MS 동안 없으면(터치 기기는 항상) 한 번 지나가고, SWEEP_GAP_MS 뒤 다시 확인한다
  const scheduleSweep = (ms: number) => {
    clearTimeout(sweepTimer);
    if (!dead) sweepTimer = window.setTimeout(trySweep, ms);
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
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail();
  });

  // S0가 20% 미만으로 보이거나 탭이 hidden이면 갱신하지 않는다
  new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].intersectionRatio >= 0.2;
      if (visible) resume();
      else if (raf) {
        stop();
        debugLine('ink', 'ink paused');
      }
    },
    { threshold: [0, 0.2, 1] },
  ).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : resume()));
  new ResizeObserver(resize).observe(canvas);
  document.fonts.addEventListener('loadingdone', () => ready && !dead && (buildText(), composite()));
  resize();
  if (dead) return;

  // 이름 등장 연출(intro-wait → intro-go, 글자 애니메이션)과 폰트 로드가 끝난 뒤에 글자를 굽고 잉크를 켠다
  (async () => {
    for (let i = 0; i < 50 && root.classList.contains('intro-wait'); i++) await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
    await Promise.all(title.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {});
    if (dead) return;
    ready = true;
    buildText();
    composite();
    root.classList.add('ink-on');
    debugLine('ink', `ink idle  ${useHalf ? 'R16F' : 'RGBA8'}`);
    trySweep(); // 이름 등장 직후 첫 스윕
  })();
}
