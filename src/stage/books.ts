import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { isTodo, makeCover, makeSpine, shortName, themeOf, type BookData } from './covers';
import { DEBUG, debugLine } from './debug';
import { PARAMS } from './params';

// 프로젝트 섹션(S5)의 3D 책 무한 캐러셀. 파티클과 같은 렌더러에 두 번째 pass로 그린다(index.ts).
// 실제 프로젝트 책(클릭 가능) + 장식용 빈 책이 고리처럼 돈다. HTML 링크 목록(#projects)이 접근성과 폴백을 맡는다.
export interface Books {
  scene: Scene;
  camera: PerspectiveCamera;
  /** 스프링과 등장 진행을 갱신한다. 이번 프레임에 그릴 것이 있으면 true */
  update(dt: number, sec: number): boolean;
  resize(aspect: number): void;
  dispose(): void;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => x * x * (3 - 2 * x);
// 책마다 스프링으로 움직이는 값. SHIFT는 캐러셀 위치에 더하는 가로 보정(클릭 전환 때 화면 중앙으로)
const SHIFT = 0;
const Y = 1;
const Z = 2;
const YAW = 3;
const SCALE = 4;
const CH = 5;
const DRAG_PX = 6; // 이만큼 넘게 움직이면 드래그(클릭 전환 안 함)

type Mode = 'rest' | 'drag' | 'inertia' | 'snap' | 'wheel';

export async function createBooks(opts: { mobile: boolean; accent: string; signal: AbortSignal }): Promise<Books | null> {
  const P = PARAMS.books;
  const dataEl = document.getElementById('books-data');
  const tip = document.getElementById('book-tip');
  const list = document.querySelector('.project-list');
  const section = document.getElementById('s5');
  let items: BookData[];
  try {
    items = JSON.parse(dataEl?.textContent ?? '[]');
  } catch {
    return null;
  }
  if (!items.length) return null;

  // 책등 글자는 display/mono 폰트가 로드된 뒤에 그린다
  const css = getComputedStyle(document.documentElement);
  const fonts = { display: css.getPropertyValue('--font-display').trim(), mono: css.getPropertyValue('--font-mono').trim() };
  const sample = items.map((b) => shortName(b.title)).join(' ');
  await Promise.all([document.fonts.load(`500 46px ${fonts.display}`, sample), document.fonts.load(`400 26px ${fonts.mono}`, '0123456789')]).catch(() => {});
  if (opts.signal.aborted) return null;

  // 고리 순서: 장식 책 절반 → 실제 책(order 순) → 나머지 장식 책. 모바일은 루프가 보이도록 장식 책을 최대 4권
  const blanks = opts.mobile ? Math.min(P.blankMobile, PARAMS.blankBooks) : PARAMS.blankBooks;
  const left = Math.floor(blanks / 2);
  const n = items.length + blanks;
  const spacing = opts.mobile ? P.spacingMobile : P.spacing;
  const restYaw = opts.mobile ? P.yawMobile : P.yaw;
  const spread = opts.mobile ? P.spreadMobile : P.spread;
  // 정면으로 도는 책의 z 하한: 책 두께 + 이웃 두께. 실제 값은 params(교차 검사로 정한 값)와 하한 중 큰 쪽
  const zCenter = Math.max(P.centerPush, 2 * P.thickness[1]);
  const zHover = Math.max(P.hoverPush, zCenter + 2 * P.thickness[1]);
  const ring = n * spacing; // 고리 한 바퀴 길이 L
  const half = ring / 2;
  const fadeLen = spacing * P.edgeFade; // 고리 끝에서 이 거리 동안 작아지며 가라앉는다
  const fadeEnd = half - spacing * 0.25; // 래핑 지점보다 조금 앞에서 크기가 정확히 0이 된다(빠르게 끌어도 보이지 않게)
  const phase = (((n - 1) / 2) % 1) * spacing; // 이 값만큼 밀어야 책 하나가 가운데 슬롯에 온다
  const snapOf = (o: number) => Math.round((o - phase) / spacing) * spacing + phase;
  const wrap = (v: number) => ((((v + half) % ring) + ring) % ring) - half;

  const scene = new Scene();
  const camera = new PerspectiveCamera(P.fov, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 4, 6);
  const rim = new DirectionalLight(opts.accent, 2);
  rim.position.set(4, 2, -5);
  scene.add(key, rim);

  // 모서리를 약간 둥글게. 면 그룹 6개(머티리얼 배열 순서)와 앞표지/책등 UV 방향은 BoxGeometry와 같다
  const geometry = new RoundedBoxGeometry(P.size[0], P.size[1], P.size[2], 2, P.radius);
  const disposables: (Material | Texture)[] = [];
  const mat = (color: string, map?: Texture) => {
    const m = new MeshStandardMaterial({ color, roughness: 0.78 });
    if (map) m.map = map;
    disposables.push(m);
    if (map) disposables.push(map);
    return m;
  };
  const paper = mat('#d8d0bf'); // 책배와 위아래 면: 밝은 종이색(너무 하얗게 빛나지 않게 약간 낮춘 톤)
  // 장식 책: 텍스처 없는 반투명 면 + 윤곽선(일반 상자의 12변 + 앞표지 책등 쪽 경첩선 1개). 뒤의 점 구름이 비친다
  const G = PARAMS.ghost;
  const ghost = new MeshStandardMaterial({ color: G.color, roughness: 0.5, transparent: true, opacity: G.opacity, depthWrite: false });
  const lineMat = new LineBasicMaterial({ color: G.color, transparent: true, opacity: G.line, depthWrite: false });
  const box = new BoxGeometry(P.size[0], P.size[1], P.size[2]);
  const boxEdges = new EdgesGeometry(box); // 둥근 상자는 베벨마다 선이 생겨 일반 상자로 만든다
  const [hw, hh, hd] = [P.size[0] / 2, P.size[1] / 2, P.size[2] / 2];
  const edges = new BufferGeometry();
  edges.setAttribute('position', new Float32BufferAttribute([...boxEdges.getAttribute('position').array, -hw + G.hinge, -hh, hd, -hw + G.hinge, hh, hd], 3));
  box.dispose();
  boxEdges.dispose();
  disposables.push(ghost, lineMat);

  const meshes: Mesh[] = [];
  const real: Mesh[] = []; // 레이캐스트 대상(실제 책만)
  const coverArt: HTMLCanvasElement[] = []; // real[k]의 앞표지 그림(상세 전환 오버레이에 복사)
  const realIndex: number[] = []; // real[k]의 고리 안 위치
  for (let i = 0; i < n; i++) {
    const k = i - left;
    const book = items[k];
    let mesh: Mesh;
    if (k >= 0 && book) {
      // 면 순서: +x(책배) −x(책등) +y −y +z(앞표지) −z(뒷표지)
      const cover = makeCover(book, fonts);
      coverArt.push(cover.image as HTMLCanvasElement);
      mesh = new Mesh(geometry, [paper, mat('#ffffff', makeSpine(book, fonts)), paper, paper, mat('#ffffff', cover), mat(themeOf(book).back)]);
      real.push(mesh);
      realIndex.push(i);
    } else {
      mesh = new Mesh(geometry, ghost);
      const outline = new LineSegments(edges, lineMat);
      mesh.renderOrder = 1; // 투명 면 → 선 순서로 고정(깜빡임 방지)
      outline.renderOrder = 2;
      mesh.add(outline);
    }
    meshes.push(mesh);
    scene.add(mesh);
  }

  // 스프링 상태(책 n개 × CH개 값)와 책별 고정 값. 모두 미리 만든 타입 배열이라 프레임당 할당이 없다
  const cur = new Float32Array(n * CH);
  const vel = new Float32Array(n * CH);
  const height = new Float32Array(n); // 책마다 높이(±8%)와 두께가 조금씩 다르다
  const thick = new Float32Array(n);
  const baseX = new Float32Array(n); // 이번 프레임의 캐러셀 위치(스프링을 거치지 않는다)
  for (let i = 0; i < n; i++) {
    const a = Math.abs(Math.sin(i * 12.9898 + 1.3) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(i * 78.233 + 4.1) * 12543.917) % 1;
    height[i] = 1 + (a - 0.5) * 2 * P.heightJitter;
    thick[i] = (P.thickness[0] + b * (P.thickness[1] - P.thickness[0])) / P.size[2];
    cur[i * CH + Y] = P.y - P.rise;
    cur[i * CH + YAW] = restYaw;
    cur[i * CH + SCALE] = 1;
  }

  // 캐러셀 오프셋: x_i = wrap(i × spacing − 가운데 + offset)
  let offset = phase;
  let offVel = 0;
  let snapTarget = phase;
  let mode: Mode = 'rest';
  let lastInput = -Infinity;
  let lastWheel = 0;
  // 드래그
  let down = false;
  let downX = 0;
  let downOffset = 0;
  let lastMoveT = 0;
  let suppressClick = false;

  let worldPerPx = 0.01; // 책 평면(z = 0)에서 화면 1px의 월드 길이
  let active = false; // S5에 거의 다 들어왔을 때만 입력을 받는다
  let hover = -1; // 포인터가 올라간 실제 책(real 인덱스)
  let focus = -1; // 키보드 포커스가 간 링크에 대응하는 책
  let picked = -1; // 클릭 전환 중인 책
  let shown = -2;
  let pointerX = 0; // 책 평면에서의 포인터 x
  let pointerOn = false;
  let tipX = -1;
  let tipY = -1;
  let reportIn = 0;
  const ndc = new Vector2();
  const v = new Vector3();
  const raycaster = new Raycaster();

  const pick = (clientX: number, clientY: number) => {
    ndc.set((clientX / innerWidth) * 2 - 1, 1 - (clientY / innerHeight) * 2);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(real, false)[0];
    // 책 평면에서의 포인터 위치(파도용)
    v.copy(raycaster.ray.direction).multiplyScalar(-raycaster.ray.origin.z / raycaster.ray.direction.z).add(raycaster.ray.origin);
    pointerX = v.x;
    return hit ? real.indexOf(hit.object as Mesh) : -1;
  };

  const showTip = (k: number) => {
    if (k === shown) return;
    shown = k;
    document.documentElement.style.cursor = hover >= 0 && picked < 0 ? 'pointer' : '';
    if (!tip) return;
    const book = items[k];
    if (!book || opts.mobile || picked >= 0) {
      tip.hidden = true;
      return;
    }
    const [title, summary] = [tip.querySelector('strong'), tip.querySelector('p')];
    if (title) title.textContent = isTodo(book.title) ? '' : book.title;
    if (summary) {
      summary.textContent = isTodo(book.summary) ? '' : book.summary;
      summary.hidden = isTodo(book.summary);
    }
    tipX = tipY = -1;
    tip.hidden = false;
  };

  /** 오프셋을 한 칸(dir = ±1) 옮긴다: 버튼, 방향키 */
  const nudge = (dir: number) => {
    if (picked >= 0) return;
    lastInput = performance.now();
    snapTarget = snapOf(mode === 'snap' ? snapTarget : offset) - dir * spacing;
    mode = 'snap';
  };
  /** 실제 책 k를 가운데 슬롯으로 보낸다(현재 오프셋에서 가장 가까운 바퀴로) */
  const center = (k: number) => {
    const row = realIndex[k];
    if (row === undefined) return;
    const target = -(row - (n - 1) / 2) * spacing;
    snapTarget = target + ring * Math.round((offset - target) / ring);
    mode = 'snap';
  };
  const ignoreTarget = (t: EventTarget | null) => t instanceof Element && !!t.closest('a, button');
  const release = () => {
    if (!down) return;
    down = false;
    if (mode === 'drag') {
      if (performance.now() - lastMoveT > 80) offVel = 0; // 멈춘 채로 놓았으면 관성 없음
      mode = 'inertia';
      lastInput = performance.now();
    }
  };

  // 책 → 상세 전환: 같은 문서 간 View Transitions를 지원하고 reduced-motion이 아니면, 이동 직전에 선택한 책 앞표지 자리에
  // 표지 그림 오버레이(HTML)를 띄우고 상세 표지와 같은 이름(book-cover)을 붙인다. 브라우저가 두 자리 사이를 보간한다.
  // 미지원 브라우저와 모바일(탭 즉시 이동, 표지가 정면이 아님)은 오버레이 없이 그대로 이동한다
  const canMorph = 'onpageswap' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let overlay: HTMLCanvasElement | null = null;
  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
  };
  const showOverlay = (k: number) => {
    removeOverlay();
    const art = coverArt[k];
    const mesh = real[k];
    if (!canMorph || !art || !mesh) return;
    mesh.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // 앞표지(+z 면)의 네 모서리를 화면 좌표로
      v.set((sx * P.size[0]) / 2, (sy * P.size[1]) / 2, P.size[2] / 2).applyMatrix4(mesh.matrixWorld).project(camera);
      const px = (v.x * 0.5 + 0.5) * innerWidth;
      const py = (0.5 - v.y * 0.5) * innerHeight;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    overlay = document.createElement('canvas');
    overlay.className = 'book-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.width = art.width;
    overlay.height = art.height;
    overlay.getContext('2d')?.drawImage(art, 0, 0);
    Object.assign(overlay.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    document.body.append(overlay);
  };

  const { signal } = opts;
  addEventListener(
    'pointerdown',
    (e) => {
      if (!active || picked >= 0 || ignoreTarget(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      down = true;
      downX = e.clientX;
      downOffset = offset;
      lastMoveT = performance.now();
      offVel = 0;
      suppressClick = false;
    },
    { signal },
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (!active || picked >= 0) return;
      const now = performance.now();
      if (down) {
        const dx = e.clientX - downX;
        if (mode !== 'drag' && Math.abs(dx) > DRAG_PX) {
          mode = 'drag'; // 6px를 넘으면 드래그: 놓은 뒤의 클릭은 전환하지 않는다
          suppressClick = true;
          hover = -1;
          pointerOn = false;
        }
        if (mode === 'drag') {
          const prev = offset;
          offset = downOffset + dx * worldPerPx;
          offVel += ((offset - prev) / (Math.max(1, now - lastMoveT) / 1000) - offVel) * 0.5;
          lastMoveT = lastInput = now;
          return;
        }
      }
      pointerOn = true;
      hover = pick(e.clientX, e.clientY); // 레이캐스트는 포인터가 움직일 때만
      if (hover >= 0) lastInput = now;
    },
    { signal, passive: true },
  );
  addEventListener('pointerup', release, { signal });
  addEventListener('pointercancel', release, { signal }); // 세로 스크롤이 시작되면 브라우저가 포인터를 가져간다
  addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (!active || picked >= 0 || ignoreTarget(e.target)) return;
      const k = pick(e.clientX, e.clientY);
      const book = items[k];
      if (!book) return;
      if (opts.mobile) {
        location.href = book.href; // 모바일은 전환 없이 바로 이동
        return;
      }
      picked = k;
      hover = -1;
      showTip(-1);
      window.setTimeout(() => {
        showOverlay(k);
        location.href = book.href;
      }, P.pickMs);
    },
    { signal },
  );
  // 가로 휠·트랙패드·shift+휠: 가로 성분이 클 때만 가로채고, 세로 휠은 그대로 섹션 스크롤에 둔다
  addEventListener(
    'wheel',
    (e) => {
      if (!active || picked >= 0) return;
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      offset -= dx * worldPerPx * (e.deltaMode === 1 ? 16 : 1);
      offVel = 0;
      mode = 'wheel';
      lastWheel = lastInput = performance.now();
    },
    { signal, passive: false },
  );
  addEventListener(
    'keydown',
    (e) => {
      if (!active || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      nudge(e.key === 'ArrowLeft' ? -1 : 1);
    },
    { signal },
  );
  section?.querySelector('.book-prev')?.addEventListener('click', () => nudge(-1), { signal });
  section?.querySelector('.book-next')?.addEventListener('click', () => nudge(1), { signal });
  // 숨긴 링크에 키보드 포커스가 가면 그 책을 가운데로 보내고 호버와 같은 상태로 보여 준다
  list?.addEventListener(
    'focusin',
    (e) => {
      const href = e.target instanceof HTMLAnchorElement ? e.target.getAttribute('href') : null;
      focus = items.findIndex((b) => b.href === href);
      if (focus >= 0) center(focus);
      lastInput = performance.now();
    },
    { signal },
  );
  list?.addEventListener('focusout', () => (focus = -1), { signal });
  // 뒤로 가기로 돌아왔을 때 전환 상태를 되돌린다
  addEventListener(
    'pageshow',
    () => {
      removeOverlay();
      picked = -1;
      down = false;
      mode = 'snap';
      snapTarget = snapOf(offset);
    },
    { signal },
  );
  addEventListener('pagereveal', removeOverlay, { signal }); // bfcache 복원 직후 첫 프레임 전에도 지운다

  return {
    scene,
    camera,
    resize(aspect) {
      // 데스크톱은 고리 전체가, 모바일은 책 몇 권이 화면 폭에 들어오는 거리
      const width = opts.mobile ? P.mobileVisible * spacing : (n - 1) * spacing + P.size[0] * 1.3;
      const tan = Math.tan((P.fov * Math.PI) / 360);
      const d = Math.max(P.distance, (width * P.fitMargin) / (2 * tan * aspect));
      camera.aspect = aspect;
      camera.position.set(0, P.cameraY * (d / P.distance), d);
      camera.lookAt(0, P.y, 0);
      camera.updateProjectionMatrix();
      worldPerPx = (2 * tan * camera.position.length()) / innerHeight;
    },
    update(dt, sec) {
      const now = performance.now();
      const p = clamp01((sec - P.appear[0]) / (P.appear[1] - P.appear[0]));
      const wasActive = active;
      active = p > 0.85;
      if (active && !wasActive) lastInput = now; // S5에 도착한 뒤부터 드리프트 대기 시간을 센다
      if (!active && picked < 0) {
        hover = -1;
        pointerOn = false;
        release();
      }

      // 오프셋 움직임: 드래그 → 관성 → 슬롯 정렬, 휠 → 멈추면 정렬, 쉬는 동안 느린 자동 드리프트
      if (picked >= 0 || mode === 'drag') {
        // 전환 중에는 고정, 드래그 중에는 이벤트가 오프셋을 정한다
      } else if (mode === 'inertia') {
        offset += offVel * dt;
        offVel *= Math.exp(-P.friction * dt);
        if (Math.abs(offVel) < P.inertiaStop) {
          mode = 'snap';
          snapTarget = snapOf(offset);
        }
      } else if (mode === 'wheel') {
        if (now - lastWheel > 160) {
          mode = 'snap';
          snapTarget = snapOf(offset);
        }
      } else if (mode === 'snap') {
        offVel += ((snapTarget - offset) * P.snapSpring - offVel * 2 * Math.sqrt(P.snapSpring)) * dt;
        offset += offVel * dt;
        if (Math.abs(snapTarget - offset) < 1e-4 && Math.abs(offVel) < 1e-3) {
          offset = snapTarget;
          offVel = 0;
          mode = 'rest';
        }
      } else if (active && hover < 0 && focus < 0 && !down && now - lastInput > P.driftDelay) {
        offset -= P.drift * dt; // 자동 드리프트(호버·포커스·드래그·전환 중에는 멈춘다)
      }
      if (Math.abs(offset) > ring * 8) {
        // 오래 돌아도 값이 커지지 않게 바퀴 수를 덜어 낸다(위치는 같다)
        const turns = Math.round(offset / ring) * ring;
        offset -= turns;
        snapTarget -= turns;
        downOffset -= turns;
      }

      const lit = focus >= 0 ? focus : mode === 'drag' ? -1 : hover;
      showTip(picked >= 0 ? -1 : lit);
      const litRow = lit >= 0 ? realIndex[lit] : -1;
      const pickedRow = picked >= 0 ? realIndex[picked] : -1;

      let visible = false;
      for (let i = 0; i < n; i++) {
        const o = i * CH;
        const bx = wrap((i - (n - 1) / 2) * spacing + offset);
        const sx = (baseX[i] = bx + spread * Math.tanh(bx / spacing)); // 화면 x: 가운데 주변을 벌린다
        // 목표값: 등장(아래에서 순서대로) + 포인터 파도 + 가운데 책 정면 + 호버/선택
        const t = ease(clamp01(p * (1 + P.stagger) - (P.stagger * i) / Math.max(1, n - 1)));
        const wave = pointerOn && picked < 0 ? Math.exp(-((sx + cur[o + SHIFT] - pointerX) ** 2) / (P.waveRadius * P.waveRadius)) : 0;
        const mid = Math.exp(-((bx / (spacing * 0.9)) ** 2)); // 가운데 슬롯에 가까울수록 1
        let tshift = 0;
        let ty = P.y - (1 - t) * P.rise + wave * P.waveLift - (1 - height[i]) * P.size[1] * 0.5;
        let tz = zCenter * mid;
        let tyaw = restYaw * (1 - P.centerTurn * mid) - wave * P.waveYaw;
        let ts = 1;
        if (pickedRow >= 0) {
          if (i === pickedRow) {
            tshift = -sx; // 선택한 책만 화면 중앙으로
            ty = P.y + 0.1;
            tz = P.pickPush;
            tyaw = 0;
            ts = P.pickScale;
          } else ty = P.y - P.rise;
        } else if (i === litRow) {
          ty += P.hoverLift;
          tz = zHover;
          tyaw = P.hoverYaw;
        }
        // 스프링 적분 (값 5개)
        for (let c = 0; c < CH; c++) {
          const target = c === SHIFT ? tshift : c === Y ? ty : c === Z ? tz : c === YAW ? tyaw : ts;
          vel[o + c] += ((target - cur[o + c]) * P.spring - vel[o + c] * P.damping) * dt;
          cur[o + c] += vel[o + c] * dt;
        }
        // 고리 끝: 스프링 밖에서 곱한다. 래핑은 항상 크기 0인 순간에 일어나서 튀지 않는다
        const edge = i === pickedRow ? 1 : ease(clamp01((fadeEnd - Math.abs(bx)) / fadeLen));
        const s = cur[o + SCALE] * edge;
        const mesh = meshes[i];
        mesh.visible = s > 0.001;
        mesh.position.set(sx + cur[o + SHIFT], cur[o + Y] - (1 - edge) * P.edgeSink, cur[o + Z]);
        mesh.rotation.y = cur[o + YAW];
        mesh.scale.set(s, s * height[i], s * thick[i]);
        if (mesh.visible && cur[o + Y] > P.y - P.rise + 0.05) visible = true;
      }

      // 툴팁은 호버한 책의 오른쪽 위에 붙인다 (값이 바뀔 때만 스타일을 쓴다)
      if (tip && !tip.hidden && litRow >= 0) {
        const o = litRow * CH;
        v.set(baseX[litRow] + cur[o + SHIFT] + P.size[0] * 0.62, cur[o + Y] + P.size[1] * 0.25, cur[o + Z]).project(camera);
        const x = Math.round(Math.min(innerWidth - tip.offsetWidth - 12, (v.x * 0.5 + 0.5) * innerWidth));
        const y = Math.round(Math.max(12, (0.5 - v.y * 0.5) * innerHeight));
        if (x !== tipX || y !== tipY) {
          tipX = x;
          tipY = y;
          tip.style.transform = `translate(${x}px, ${y}px)`;
        }
      }
      if (DEBUG && (reportIn -= dt) <= 0) {
        reportIn = 0.25;
        debugLine('books', `books ${n} (real ${real.length})  p ${p.toFixed(2)}  ${mode}  offset ${offset.toFixed(2)}  hover ${lit}${picked >= 0 ? `  picked ${picked}` : ''}`);
      }
      return visible;
    },
    dispose() {
      removeOverlay();
      document.documentElement.style.cursor = '';
      if (tip) tip.hidden = true;
      geometry.dispose();
      edges.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
