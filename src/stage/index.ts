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
import { createDebug } from './debug';
import { PARAMS, createParticles, type Particles } from './particles';
import { createScroll } from './scroll';
import { createFpsMeter, dprCap, initialTier, isMobile, lowerTier, saveTier } from './tiers';

const MIN_FPS = 45;
const CHECK_MS = 2000;
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
  const info = { webgl2: false, tex: 'none', tier: 0, dpr: 1, tReady: -1 };
  const report = (fps = 0, p = 0, sec = 0) =>
    debug?.(
      `tier ${info.tier} (${info.tier * info.tier} pts)\ndpr ${info.dpr.toFixed(2)}\nfps ${fps.toFixed(1)}\n` +
        `webgl2 ${info.webgl2}\ntex ${info.tex}\nreduced-motion ${reduced}\n` +
        `--p ${p.toFixed(3)}  --sec ${sec.toFixed(3)}\nt_ready ${info.tReady < 0 ? '-' : `${Math.round(info.tReady)} ms`}`,
    );
  // 첫 프레임이 그려졌다: 캔버스를 드러내고 이름 등장을 시작시킨다(Stage.astro 인라인 스크립트가 듣는다)
  const markReady = () => {
    info.tReady = performance.now(); // 페이지 로드(time origin) → 첫 프레임
    root.classList.add('stage-ready');
    dispatchEvent(new Event('stage:ready'));
  };
  const fail = () => {
    root.classList.remove('stage-ready');
    root.classList.add('no-webgl');
    report();
  };

  let renderer: WebGLRenderer;
  try {
    // three는 WebGL2 전용이라 컨텍스트를 못 만들면 여기서 throw한다
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch {
    fail();
    return;
  }
  info.webgl2 = true;

  const mobile = isMobile();
  const touch = matchMedia('(pointer: coarse)').matches;
  const cap = dprCap(mobile);
  let tier = initialTier(mobile);
  const css = getComputedStyle(root);
  const colors = { a: css.getPropertyValue('--text').trim(), b: css.getPropertyValue('--accent').trim() };

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
  renderer.setClearColor(css.getPropertyValue('--bg').trim());

  const scene = new Scene();
  scene.add(particles.points);
  const camera = new PerspectiveCamera(PARAMS.fov, 1, 0.1, 100);
  const tanHalf = Math.tan((PARAMS.fov * Math.PI) / 360);
  let baseZ = PARAMS.cameraZ;
  const scroll = createScroll(); // reduced-motion에서는 update를 부르지 않아 0에 머문다

  // 포인터 상태는 전부 미리 만들어 두고 프레임에서 재사용한다
  const ndc = { x: 0, y: 0, tx: 0, ty: 0 };
  const ray = new Vector3();
  const pointer = new Vector3(0, 0, 1e3); // 멀리 두면 반발력 0
  let pointerOn = false;

  const aim = () => {
    camera.position.set(ndc.x * PARAMS.gaze, ndc.y * PARAMS.gaze, baseZ - scroll.p * PARAMS.scrollZoom);
    camera.lookAt(0, 0, 0);
  };

  const resize = () => {
    info.dpr = Math.min(devicePixelRatio, cap);
    renderer.setPixelRatio(info.dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    // 세로 화면에서도 링 전체가 들어오게 카메라를 뒤로 뺀다
    baseZ = Math.max(PARAMS.cameraZ, (PARAMS.ringRadius * PARAMS.fitMargin) / (tanHalf * camera.aspect));
    particles.setScale(canvas.height / (2 * tanHalf));
    scroll.measure();
    if (reduced) {
      aim();
      renderer.render(scene, camera);
    }
  };

  const meter = createFpsMeter();
  let warmup = WARMUP;
  let nextCheck = 0;
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
    warmup = WARMUP;
  };

  let raf = 0;
  let last = 0;
  let time = 0;
  let ready = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    const dt = Math.min(raw, 1 / 30);
    time += dt;

    scroll.update(dt);
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

    particles.step(dt, time, scroll.morph, pointer);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      markReady();
    }

    if (warmup > 0) warmup--;
    else meter.push(raw);
    if (meter.count >= 60 && now >= nextCheck) {
      nextCheck = now + CHECK_MS;
      if (meter.fps < MIN_FPS) downshift();
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
    for (let i = 0; i < STATIC_STEPS; i++) particles.step(1 / 30, t0 + i / 30, 0, pointer);
    renderer.render(scene, camera);
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
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()), { signal });
  if (!document.hidden) start();
  return destroy;
}
