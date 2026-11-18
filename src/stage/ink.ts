import { DEBUG, debugLine } from './debug';
import { compositeFrag, fieldFrag, inkVert, MAX_LETTERS, MAX_STAMPS } from './inkShaders';

// 히어로 잉크 리빌(WebGL2, three 미사용, 메인 스테이지와 별개의 컨텍스트).
// 포인터 궤적을 저해상도 필드에 스탬프로 누적하고(마스크), 합성 셰이더가 그 안에만 흐르는 잉크 텍스처를 보여 준다.
// 캔버스가 S0 배경 + 잉크 + 이름 글자까지 불투명하게 그린다. 마스크 안쪽은 ?ink= 로 고른다:
//   name(기본): 어두운 바닥 위에 이름이 스타일 글자로(은빛 풍선 → 파스텔 풍선 → 네온, 잉크 세션마다 다음 스타일)
//   smoke: 3색 + 군청의 부드러운 구름, 잉크 안 글자는 흰색으로 반전
// DOM h1은 접근성용으로 남기고, 잉크가 켜졌을 때(html.ink-on)만 글자색을 투명하게 한다.
const SMOKE = ['#5b3df5', '#ff3d8b', '#ff9a3c', '#141a4d']; // 인디고, 마젠타, 오렌지, 깊이용 군청(소량)
const STYLES = 3; // name 모드 스타일 수
const EMPTY_MS = 2000; // 마지막 스탬프 뒤 이만큼 지나면(보이는 잉크 0%) 다음 입력은 새 세션 → 다음 스타일
const SESSION_MS = 8000; // 한 세션이 이보다 길면 다음 스타일로 크로스페이드
const FADE_MS = 400;
const BLUR_EM = [0.035, 0.07]; // 글자 높이 지도 흐림 반경(글자 크기 비율): 작은 것(R, 윤곽 ≈ 0.5), 큰 것(G)
const DPR_CAP = 1.5;
const FIELD_SCALE = 0.25; // 마스크 필드 해상도(캔버스 픽셀 대비)
const RADIUS_VW = 0.07; // 보이는 반경(붓 굵기의 절반): 뷰포트 폭 비율. 속도와 무관하게 고정
const SPEED_MAX = 1200; // px/s: 이 속도에서 튄 물감 최대
const SPLAT_EVERY = 45; // 최대 속도에서 이 거리(px)마다 튄 물방울 1개. 느릴수록 속도 비율만큼 줄어든다
const SPLAT_MAX = 6; // 이동 1번당 물방울 상한
const SPLAT_SIZE = [0.05, 0.6]; // 물방울 반경: 메인 반경 비율(작은 쪽이 많다)
const SPLAT_GAP = 1.2; // 물방울 중심과 궤적 중심선의 최소 거리 = SPLAT_GAP × 반경 + 물방울 반경
const KEEP_RATE = 0.4; // 필드 감쇠: f × e^(−KEEP_RATE·t) − SUB_RATE·t. 약 1.8초 뒤 임계 아래로
const SUB_RATE = 0.12;
const BLUR_RATE = 12; // 블러 세기(1/s)
const VIS_LIFE = 1.9; // 스탬프가 보이는 시간(초). 면적 추정용
const STOP_MS = 2400; // 마지막 스탬프 뒤 이 시간이 지나면 필드를 지우고 루프를 멈춘다(보이는 잉크는 그 전에 이미 0%)
const AREA_CAP = 0.35; // 잉크 면적 상한(화면 비율). 굵기·세기는 깎지 않고 소멸 속도로만 제어한다
const DECAY_BOOST = 2.5; // 추정 면적이 상한에 닿았을 때의 감쇠 배율(상한의 60%부터 선형으로 1 → 2.5)
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
  const letters = [...title.querySelectorAll<HTMLElement>('.word span')].slice(0, MAX_LETTERS);
  const mode = new URLSearchParams(location.search).get('ink') === 'smoke' ? 1 : 0; // 없거나 잘못된 값은 name

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
  const compProg = compile(inkVert, compositeFrag);
  if (!fieldProg || !compProg) return;
  const locs = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const uf = locs(fieldProg, ['uPrev', 'uTexel', 'uSize', 'uBlur', 'uKeep', 'uSub', 'uCount', 'uSeg', 'uRS']);
  const uc = locs(compProg, ['uField', 'uText', 'uSize', 'uTexel', 'uFieldTexel', 'uShadowOff', 'uFlow', 'uTime', 'uBg', 'uFg', 'uShadow', 'uMode', 'uStyleA', 'uStyleB', 'uStyleMix', 'uLetters', 'uLetterCount', 'uSmoke']);

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
  const smokeColors = new Float32Array(SMOKE.flatMap((c) => rgb(c, c)));
  gl.useProgram(compProg);
  gl.uniform3fv(uc.uBg, bg);
  gl.uniform3fv(uc.uFg, fg);
  gl.uniform3fv(uc.uShadow, shadow);
  gl.uniform3fv(uc.uSmoke, smokeColors);
  gl.uniform1i(uc.uMode, mode);
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
  let overflow = 0; // 칸이 모자라 이어 붙인 스탬프 수(debug 표시용)
  // 면적 추정: 최근 스탬프가 새로 덮은 넓이(px²)와 시각
  const areaBorn = new Float64Array(AREA_SLOTS).fill(-Infinity);
  const areaPx = new Float32Array(AREA_SLOTS);
  let areaHead = 0;
  let areaEst = 0;
  let decayClock = 0; // 감쇠 시계(초): 프레임마다 dt × 감쇠 배율만큼 간다
  let decayK = 1; // 이번 프레임 감쇠 배율
  const pointer = newPen();
  const sweepPen = newPen();
  // name 모드 스타일: 새 세션마다 다음 스타일(시작 −1 → 첫 자동 스윕은 0), 긴 세션은 크로스페이드
  let styleA = -1;
  let styleB = 0;
  let styleMix = 0;
  let sessionStart = 0;
  let fadeStart = -1;
  const letterRects = new Float32Array(MAX_LETTERS * 4);
  const label = () => (mode ? 'smoke' : `name style ${Math.max(0, styleA)}${fadeStart >= 0 ? `→${styleB}` : ''}`);
  function newSession(now: number) {
    if (fadeStart >= 0) styleA = styleB; // 크로스페이드 중이면 끝낸 상태에서 넘긴다
    styleA = (styleA + 1) % STYLES;
    styleMix = 0;
    fadeStart = -1;
    sessionStart = now;
    if (DEBUG) debugLine('ink', `ink run  ${label()}  new session`);
  }
  const stepStyle = (now: number) => {
    if (mode || styleA < 0) return;
    if (fadeStart < 0 && now - sessionStart > SESSION_MS) {
      fadeStart = now;
      styleB = (styleA + 1) % STYLES;
    }
    if (fadeStart >= 0) {
      styleMix = smooth(clamp01((now - fadeStart) / FADE_MS));
      if (styleMix >= 1) {
        styleA = styleB;
        styleMix = 0;
        fadeStart = -1;
        sessionStart = now;
      }
    }
  };

  // 나이는 감쇠 시계(실제 시간 × 감쇠 배율)로 잰다: 감쇠가 빨라진 만큼 추정도 빨리 줄어든다
  const estimate = () => {
    let sum = 0;
    for (let i = 0; i < AREA_SLOTS; i++) {
      const age = (decayClock - areaBorn[i]) / VIS_LIFE;
      if (age < 1) sum += areaPx[i] * (1 - age);
    }
    return sum / (w * h);
  };
  const addArea = (px: number) => {
    areaBorn[areaHead] = decayClock;
    areaPx[areaHead] = px;
    areaHead = (areaHead + 1) % AREA_SLOTS;
  };
  // 면적 상한: 굵기와 세기는 그대로 두고, 추정 면적이 상한의 60%를 넘으면 필드 감쇠를 최대 DECAY_BOOST배까지 빠르게 한다
  const decayRate = () => 1 + (DECAY_BOOST - 1) * clamp01((areaEst / AREA_CAP - 0.6) / 0.4);

  /** 스탬프 1개(선분 a→b, 보이는 반경 vis, 세기 1). 한 프레임에 MAX_STAMPS를 넘으면 마지막 선분을 늘린다 */
  const stamp = (x0: number, y0: number, x1: number, y1: number, vis: number, now: number, dot: boolean) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    addArea(len * 2 * vis + (dot ? Math.PI * vis * vis : 0));
    if (now - lastStamp > EMPTY_MS) newSession(now);
    lastStamp = now;
    let k = stamps;
    if (k === MAX_STAMPS) {
      overflow++;
      if (dot) return; // 물방울은 칸이 없으면 버린다(이어 붙이면 엉뚱한 선분이 된다)
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
    rs[k * 2 + 1] = 1;
  };

  /** 펜을 (x, y)로 옮기며 스탬프를 찍는다. 반경은 속도와 무관하게 고정. fixedSpeed는 튄 물감 양에만 쓴다 */
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
    const vis = w * RADIUS_VW;
    stamp(first ? x : pen.x, first ? y : pen.y, x, y, vis, now, first);
    // 튄 물감: 속도에 비례한 개수를 진행 방향 앞·옆으로 던진다. 제자리에 찍히고 필드 감쇠로 사라진다
    if (dist > 0) dropAcc = Math.min(SPLAT_MAX, dropAcc + (dist / SPLAT_EVERY) * clamp01(speed / SPEED_MAX));
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    for (; dropAcc >= 1; dropAcc--) {
      const u = Math.random();
      const r = vis * (SPLAT_SIZE[0] + (SPLAT_SIZE[1] - SPLAT_SIZE[0]) * u * u);
      const far = 1 - u * u * 0.6; // 작은 방울일수록 멀리
      const ahead = vis * (0.2 + 1.6 * Math.random()) * far;
      // 궤적 가장자리(vis)에 붙어 돌기가 되지 않게: 중심선에서 SPLAT_GAP × vis + r 이상 떨어뜨린다
      const side = (Math.random() < 0.5 ? -1 : 1) * (SPLAT_GAP * vis + r + vis * 1.1 * Math.random() * far);
      const ox = x + ux * ahead - uy * side;
      const oy = y + uy * ahead + ux * side;
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
    gl.uniform1f(uf.uKeep, Math.exp(-KEEP_RATE * dt * decayK));
    gl.uniform1f(uf.uSub, SUB_RATE * dt * decayK);
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
    gl.uniform2f(uc.uFieldTexel, 1 / fw, 1 / fh);
    gl.uniform2f(uc.uShadowOff, SHADOW_PX[0] / w, -SHADOW_PX[1] / h);
    gl.uniform2f(uc.uFlow, flowX, flowY);
    gl.uniform1f(uc.uTime, time);
    gl.uniform1i(uc.uStyleA, styleA);
    gl.uniform1i(uc.uStyleB, styleB);
    gl.uniform1f(uc.uStyleMix, styleMix);
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
  /** 이름 글자를 DOM과 같은 위치·폰트로 오프스크린 캔버스에 그려 텍스처로 올린다.
   *  채널: R 작은 흐림, G 큰 흐림(name 모드 높이 지도와 네온 글로우), B 선명한 글자. 불투명 검정 위에 'lighter'로 더해 채널이 섞이지 않는다 */
  const buildText = () => {
    const c = canvas.getBoundingClientRect();
    textCanvas.width = canvas.width;
    textCanvas.height = canvas.height;
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-over';
    tx.fillStyle = '#000';
    tx.fillRect(0, 0, textCanvas.width, textCanvas.height);
    tx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tx.globalCompositeOperation = 'lighter';
    tx.textBaseline = 'alphabetic';
    const glyphs = letters.map((el, k) => {
      const s = getComputedStyle(el);
      const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      tx.font = font;
      const ch = el.textContent ?? '';
      const r = el.getBoundingClientRect();
      const m = tx.measureText(ch);
      letterRects.set([(r.left - c.left) / w, 1 - (r.bottom - c.top) / h, (r.right - c.left) / w, 1 - (r.top - c.top) / h], k * 4);
      // inline-block 글자 상자 안의 기준선: CSS half-leading과 같은 계산
      return { ch, font, size: parseFloat(s.fontSize), x: r.left - c.left, y: r.top - c.top + (r.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent };
    });
    // 흐림: 글자를 캔버스 밖에 그리고 그림자만 제자리로 떨어뜨린다(shadowBlur·shadowOffset은 변환 행렬과 무관한 픽셀 단위)
    const away = w + 1000;
    for (const [color, em] of [['#ff0000', BLUR_EM[0]], ['#00ff00', BLUR_EM[1]]] as const) {
      tx.shadowColor = color;
      tx.shadowOffsetX = -away * dpr;
      for (const g of glyphs) {
        tx.font = g.font;
        tx.shadowBlur = em * g.size * dpr * 2; // shadowBlur는 시그마의 약 2배
        tx.fillText(g.ch, g.x + away, g.y);
      }
    }
    tx.shadowColor = 'transparent';
    tx.shadowBlur = 0;
    tx.shadowOffsetX = 0;
    tx.fillStyle = '#0000ff';
    for (const g of glyphs) {
      tx.font = g.font;
      tx.fillText(g.ch, g.x, g.y);
    }
    tx.globalCompositeOperation = 'source-over';
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.useProgram(compProg);
    gl.uniform2f(uc.uTexel, 1 / textCanvas.width, 1 / textCanvas.height);
    gl.uniform4fv(uc.uLetters, letterRects);
    gl.uniform1i(uc.uLetterCount, glyphs.length);
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
    decayK = decayRate();
    decayClock += dt * decayK;
    areaEst = estimate();
    stepStyle(now);
    fieldPass(dt);
    composite();

    if (DEBUG && now >= nextReport) {
      nextReport = now + 250;
      debugLine('ink', `ink run  ${label()}  area~${Math.round(areaEst * 100)}%  decay ×${decayK.toFixed(2)}  full ${overflow}  ${useHalf ? 'R16F' : 'RGBA8'}`);
    }
    if (sweepStart < 0 && now - lastStamp > STOP_MS) {
      // 필드는 이미 임계 아래다. 0으로 지우고 깨끗한 프레임(배경 + 검정 글자)을 남긴 뒤 멈춘다
      clearField();
      composite();
      stop();
      debugLine('ink', `ink idle  ${label()}  ${useHalf ? 'R16F' : 'RGBA8'}`);
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
    debugLine('ink', `ink idle  ${label()}  ${useHalf ? 'R16F' : 'RGBA8'}`);
    trySweep(); // 이름 등장 직후 첫 스윕
  })();
}
