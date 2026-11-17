import {
  FloatType,
  HalfFloatType,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type TextureDataType,
} from 'three';
import { createBooks, type Books } from './books';
import { createDebug } from './debug';
import { PARAMS } from './params';
import { createParticles, type Blend, type Particles } from './particles';
import { createScroll } from './scroll';
import { createDownshiftGate, createFpsMeter, dprCap, initialTier, isMobile, lowerTier, saveTier } from './tiers';

const WARMUP = 10; // 셰이더 컴파일이 끼는 첫 프레임들은 FPS 평균에서 뺀다
const STATIC_STEPS = 30; // reduced-motion에서 정적 한 장을 만들 시뮬 스텝 수

/** 렌더 가능한 부동소수점 타깃 타입. Float → HalfFloat 순으로 실제 프레임버퍼를 만들어 확인한다. */
function pickFloatType(renderer: WebGLRenderer): TextureDataType | null {
  const gl = renderer.getContext();
  for (const type of [FloatType, HalfFloatType]) {
    const rt = new WebGLRenderTarget(1, 1, { type, depthBuffer: false });
    renderer.setRenderTarget(rt);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(null);
    rt.dispose();
    if (ok) return type;
  }
  return null;
}

/** 스테이지를 시작한다. 실패하면 <html class="no-webgl">로 전환한다. 반환값은 정리 함수. */
export function initStage(canvas: HTMLCanvasElement): (() => void) | undefined {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debug = createDebug();
  const info = { webgl2: false, tex: 'none', tier: 0, dpr: 1, tReady: -1, shapeA: 0, shapeB: 0, mix: 0 };
  const report = (fps = 0, p = 0, sec = 0) =>
    debug?.(
      `tier ${info.tier} (${info.tier * info.tier} pts)\ndpr ${info.dpr.toFixed(2)}\nfps ${fps.toFixed(1)}\n` +
        `webgl2 ${info.webgl2}\ntex ${info.tex}\nreduced-motion ${reduced}\n` +
        `--p ${p.toFixed(3)}  --sec ${sec.toFixed(3)}\nshape ${info.shapeA}→${info.shapeB}  uMix ${info.mix.toFixed(2)}\nt_ready ${info.tReady < 0 ? '-' : `${Math.round(info.tReady)} ms`}`,
    );
  // 첫 프레임이 그려졌다: 캔버스를 드러내고 이름 등장을 시작시킨다(Stage.astro 인라인 스크립트가 듣는다)
  const markReady = () => {
    info.tReady = performance.now(); // 페이지 로드(time origin) → 첫 프레임
    root.classList.add('stage-ready');
    dispatchEvent(new Event('stage:ready'));
  };
  const fail = () => {
    root.classList.remove('stage-ready', 'books-on'); // books-on이 빠지면 프로젝트 링크 목록이 다시 보인다
    root.classList.add('no-webgl');
    report();
  };

  const mobile = isMobile();
  let renderer: WebGLRenderer;
  try {
    // three는 WebGL2 전용이라 컨텍스트를 못 만들면 여기서 throw한다.
    // 안티에일리어싱은 책 모서리용. 모바일은 DPR이 높아 계단이 덜 보이므로 끈다
    renderer = new WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  } catch {
    fail();
    return;
  }
  info.webgl2 = true;

  const touch = matchMedia('(pointer: coarse)').matches;
  const cap = dprCap(mobile);
  let tier = initialTier(mobile);
  const css = getComputedStyle(root);
  const color = (name: string) => css.getPropertyValue(name).trim();
  const colors = { a: color('--text'), b: color('--accent'), c: color('--insight') };

  const type = pickFloatType(renderer);
  if (!type) {
    renderer.dispose();
    fail();
    return;
  }
  let particles: Particles;
  try {
    particles = createParticles(renderer, tier, type, colors, reduced ? 0 : 1);
  } catch {
    renderer.dispose();
    fail();
    return;
  }
  info.tex = type === FloatType ? 'Float' : 'HalfFloat';
  info.tier = tier;
  renderer.setClearColor(color('--bg'));
  renderer.autoClear = false; // pass 2개(점 → 책)를 직접 지우고 그린다

  const scene = new Scene();
  scene.add(particles.points);
  const camera = new PerspectiveCamera(PARAMS.fov, 1, 0.1, 100);
  let books: Books | null = null;
  // pass 1: 점 구름. pass 2: 책(깊이만 지우고 그 위에). 책이 화면에 없으면 pass 2는 건너뛴다
  const draw = (withBooks: boolean) => {
    renderer.clear();
    renderer.render(scene, camera);
    if (books && withBooks) {
      renderer.clearDepth();
      renderer.render(books.scene, books.camera);
    }
  };
  const tanHalf = Math.tan((PARAMS.fov * Math.PI) / 360);
  const keys = PARAMS.cameraKeys;
  const shapes = PARAMS.sectionShapes;
  const lastPair = keys.length - 2; // 마지막 보간 구간의 시작 섹션
  let fit = 1; // 좁은 화면에서 카메라를 뒤로 빼는 배율
  let wide = 1; // 가로가 넓을수록 1: 도형을 오른쪽으로 옮기는 정도
  let time = 0;
  const scroll = createScroll(); // reduced-motion에서는 update를 부르지 않아 0에 머문다
  // 현재 섹션 쌍과 보간값: shape와 카메라가 같은 값을 쓴다
  const blend: Blend & { i: number } = { i: 0, a: shapes[0], b: shapes[1], mix: 0, dim: 1, insight: 0, noise: 1 };
  const setBlend = (sec: number) => {
    const i = Math.min(Math.floor(sec), lastPair);
    const f = Math.min(1, Math.max(0, sec - i));
    blend.i = i;
    blend.a = info.shapeA = shapes[i];
    blend.b = info.shapeB = shapes[i + 1];
    blend.mix = info.mix = f * f * (3 - 2 * f);
    blend.dim = 1 + (PARAMS.dimAtProjects - 1) * Math.min(1, Math.max(0, sec - lastPair));
    blend.insight = Math.max(0, 1 - Math.abs(sec - PARAMS.insightSection));
    const n = PARAMS.sectionNoise;
    blend.noise = n[i] + (n[i + 1] - n[i]) * blend.mix;
  };
  setBlend(0);

  // 포인터 상태는 전부 미리 만들어 두고 프레임에서 재사용한다
  const ndc = { x: 0, y: 0, tx: 0, ty: 0 };
  const ray = new Vector3();
  const pointer = new Vector3(0, 0, 1e3); // 멀리 두면 반발력 0
  let pointerOn = false;

  const aim = () => {
    const a = keys[blend.i];
    const b = keys[blend.i + 1];
    const m = blend.mix;
    // 카메라와 시선을 같이 왼쪽으로 옮기면 도형이 화면 오른쪽에 온다
    const shift = (a.shift + (b.shift - a.shift) * m) * wide;
    const drift = (a.drift + (b.drift - a.drift) * m) * Math.sin(time * PARAMS.driftSpeed);
    camera.position.set(
      (a.pos[0] + (b.pos[0] - a.pos[0]) * m) * fit - shift + drift + ndc.x * PARAMS.gaze,
      (a.pos[1] + (b.pos[1] - a.pos[1]) * m) * fit + ndc.y * PARAMS.gaze,
      (a.pos[2] + (b.pos[2] - a.pos[2]) * m) * fit,
    );
    camera.lookAt(
      a.look[0] + (b.look[0] - a.look[0]) * m - shift,
      a.look[1] + (b.look[1] - a.look[1]) * m,
      a.look[2] + (b.look[2] - a.look[2]) * m,
    );
  };

  const resize = () => {
    info.dpr = Math.min(devicePixelRatio, cap);
    renderer.setPixelRatio(info.dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    // 세로 화면에서도 도형 전체가 들어오게 카메라를 뒤로 뺀다
    fit = Math.max(1, (PARAMS.ring.radius * PARAMS.fitMargin) / (tanHalf * camera.aspect) / PARAMS.fitDistance);
    wide = Math.min(1, Math.max(0, (camera.aspect - 1) / 0.6));
    particles.setScale(canvas.height / (2 * tanHalf));
    books?.resize(camera.aspect);
    scroll.measure();
    if (reduced) {
      aim();
      draw(false);
    }
  };

  const meter = createFpsMeter(); // 디버그 표시용 이동평균
  const gate = createDownshiftGate(); // tier 하향 판정
  let warmup = WARMUP;
  let nextReport = 0;

  const downshift = () => {
    const next = lowerTier(tier);
    if (!next) return;
    const old = particles;
    try {
      particles = createParticles(renderer, next, type, colors, 0, old);
    } catch {
      return; // 새 tier 생성 실패: 현재 tier 유지
    }
    scene.remove(old.points);
    old.dispose();
    scene.add(particles.points);
    particles.setScale(canvas.height / (2 * tanHalf));
    tier = info.tier = next;
    saveTier(next);
    meter.reset();
    gate.restart();
    warmup = WARMUP;
  };

  let raf = 0;
  let last = 0;
  let ready = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    const dt = Math.min(raw, 1 / 30);
    time += dt;

    scroll.update(dt);
    setBlend(scroll.sec);
    if (touch) {
      // 터치 기기: 포인터 대신 느린 자동 시선 이동만
      ndc.tx = Math.sin(time * 0.25) * 0.6;
      ndc.ty = Math.cos(time * 0.2) * 0.4;
    }
    const k = 1 - Math.exp(-dt * 4);
    ndc.x += (ndc.tx - ndc.x) * k;
    ndc.y += (ndc.ty - ndc.y) * k;
    aim();

    if (pointerOn) {
      // 포인터를 z=0 평면의 월드 좌표로 투영
      camera.updateMatrixWorld();
      ray.set(ndc.tx, ndc.ty, 0.5).unproject(camera).sub(camera.position);
      pointer.copy(camera.position).addScaledVector(ray, -camera.position.z / ray.z);
    } else {
      pointer.set(0, 0, 1e3);
    }

    particles.step(dt, time, pointer, blend);
    draw(books ? books.update(dt, scroll.sec) : false);
    if (!ready) {
      ready = true;
      markReady();
    }

    if (warmup > 0) warmup--;
    else {
      meter.push(raw);
      if (gate.frame(raw * 1000)) downshift();
    }
    if (debug && now >= nextReport) {
      nextReport = now + 250;
      report(meter.fps, scroll.p, scroll.sec);
    }
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const start = () => {
    if (raf) return;
    last = 0; // 숨겨져 있던 시간을 dt와 FPS에 넣지 않는다
    raf = requestAnimationFrame(frame);
  };

  const ac = new AbortController();
  const { signal } = ac;
  const destroy = () => {
    stop();
    ac.abort();
    books?.dispose();
    particles.dispose();
    renderer.dispose();
  };

  let resizeTimer = 0;
  addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      clearTimeout(resizeTimer);
      destroy();
      fail();
    },
    { signal },
  );

  resize();

  if (reduced) {
    // 정적 한 장: origin에서 시작해 몇 스텝만 돌리고 멈춘다. 스크롤/포인터/루프 없음.
    // 시간은 입장 구간 뒤로 넘겨 평소 스프링 값으로 돌린다
    const t0 = PARAMS.introDuration + 1;
    for (let i = 0; i < STATIC_STEPS; i++) particles.step(1 / 30, t0 + i / 30, pointer, blend);
    draw(false);
    markReady();
    report();
    return destroy;
  }

  if (!touch) {
    addEventListener(
      'pointermove',
      (e) => {
        ndc.tx = (e.clientX / innerWidth) * 2 - 1;
        ndc.ty = 1 - (e.clientY / innerHeight) * 2;
        pointerOn = true;
      },
      { signal, passive: true },
    );
    root.addEventListener('pointerleave', () => (pointerOn = false), { signal });
  }
  const ro = new ResizeObserver(() => scroll.measure()); // 폰트 로드 등으로 높이가 바뀔 때
  ro.observe(document.body);
  signal.addEventListener('abort', () => ro.disconnect());
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) return stop();
      gate.restart(); // 복귀 직후 첫 윈도우는 tier 판정에서 뺀다
      start();
    },
    { signal },
  );
  if (!document.hidden) start();

  // 3D 책: 책등 폰트가 로드된 뒤 준비된다. 준비되면 books-on으로 HTML 목록을 시각적으로만 숨기고 캐러셀 버튼을 보인다
  createBooks({ mobile: mobile || touch, accent: colors.b, signal })
    .then((created) => {
      if (!created) return;
      if (signal.aborted) return created.dispose();
      books = created;
      books.resize(camera.aspect);
      root.classList.add('books-on');
    })
    .catch(() => {}); // 책 생성 실패: 목록이 그대로 보인다
  return destroy;
}
