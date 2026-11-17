import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
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
import { bookColor, isTodo, makeCover, makeSpine, type BookData } from './covers';
import { DEBUG, debugLine } from './debug';
import { PARAMS } from './params';

// 프로젝트 섹션(S5)의 3D 책 줄. 파티클과 같은 렌더러에 두 번째 pass로 그린다(index.ts).
// 실제 프로젝트 책(가운데, 클릭 가능) + 장식용 빈 책(양옆). HTML 링크 목록(#projects)이 접근성과 폴백을 맡는다.
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
// 책마다 스프링으로 움직이는 값
const X = 0;
const Y = 1;
const Z = 2;
const YAW = 3;
const SCALE = 4;
const CH = 5;

export async function createBooks(opts: { mobile: boolean; accent: string; signal: AbortSignal }): Promise<Books | null> {
  const P = PARAMS.books;
  const dataEl = document.getElementById('books-data');
  const tip = document.getElementById('book-tip');
  const list = document.querySelector('.project-list');
  let items: BookData[];
  try {
    items = JSON.parse(dataEl?.textContent ?? '[]');
  } catch {
    return null;
  }
  if (!items.length) return null;

  // 표지 글자는 display/mono 폰트가 로드된 뒤에 그린다
  const css = getComputedStyle(document.documentElement);
  const fonts = { display: css.getPropertyValue('--font-display').trim(), mono: css.getPropertyValue('--font-mono').trim() };
  const sample = items.map((b) => b.title).join(' ');
  await Promise.all([document.fonts.load(`500 68px ${fonts.display}`, sample), document.fonts.load(`400 30px ${fonts.mono}`, '0123456789')]).catch(() => {});
  if (opts.signal.aborted) return null;

  const blanks = opts.mobile ? 0 : PARAMS.blankBooks;
  const left = Math.floor(blanks / 2);
  const n = items.length + blanks;
  const spacing = opts.mobile ? P.spacingMobile : P.spacing;
  const restYaw = opts.mobile ? P.yawMobile : P.yaw;

  const scene = new Scene();
  const camera = new PerspectiveCamera(P.fov, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 4, 6);
  const rim = new DirectionalLight(opts.accent, 2);
  rim.position.set(4, 2, -5);
  scene.add(key, rim);

  const geometry = new BoxGeometry(P.size[0], P.size[1], P.size[2]);
  const disposables: (Material | Texture)[] = [];
  const mat = (color: string, map?: Texture) => {
    const m = new MeshStandardMaterial({ color, roughness: 0.78 });
    if (map) m.map = map;
    disposables.push(m);
    if (map) disposables.push(map);
    return m;
  };
  const paper = mat('#e9e4d8');
  const blank = mat('#2b2b31');

  const meshes: Mesh[] = [];
  const real: Mesh[] = []; // 레이캐스트 대상(실제 책만)
  const realIndex: number[] = []; // real[k]의 줄 안 위치
  for (let i = 0; i < n; i++) {
    const k = i - left;
    const book = items[k];
    let mesh: Mesh;
    if (k >= 0 && book) {
      // BoxGeometry 면 순서: +x(책배) −x(책등) +y −y +z(앞표지) −z(뒷표지)
      mesh = new Mesh(geometry, [paper, mat('#ffffff', makeSpine(book, fonts)), paper, paper, mat('#ffffff', makeCover(book, fonts)), mat(bookColor(book.hue, 12))]);
      real.push(mesh);
      realIndex.push(i);
    } else {
      mesh = new Mesh(geometry, blank);
    }
    meshes.push(mesh);
    scene.add(mesh);
  }

  // 스프링 상태: 현재값, 속도, 목표값 (책 n개 × CH개 값)
  const cur = new Float32Array(n * CH);
  const vel = new Float32Array(n * CH);
  const baseX = new Float32Array(n);
  const height = new Float32Array(n); // 빈 책은 키가 조금씩 다르다
  for (let i = 0; i < n; i++) {
    baseX[i] = (i - (n - 1) / 2) * spacing;
    const isReal = realIndex.includes(i);
    height[i] = isReal ? 1 : 0.84 + 0.2 * Math.abs(Math.sin(i * 12.9898));
    cur[i * CH + X] = baseX[i];
    cur[i * CH + Y] = P.y - P.rise;
    cur[i * CH + YAW] = restYaw;
    cur[i * CH + SCALE] = 1;
  }

  let aspect = 1;
  let active = false; // S5에 거의 다 들어왔을 때만 입력을 받는다
  let hover = -1; // 포인터가 올라간 실제 책(real 인덱스)
  let focus = -1; // 키보드 포커스가 간 링크에 대응하는 책
  let picked = -1; // 클릭 전환 중인 책
  let shown = -2;
  let pointerX = 0; // 책 평면(z = 0)에서의 포인터 x
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

  const { signal } = opts;
  addEventListener(
    'pointermove',
    (e) => {
      if (!active || picked >= 0) return;
      pointerOn = true;
      hover = pick(e.clientX, e.clientY); // 레이캐스트는 포인터가 움직일 때만
    },
    { signal, passive: true },
  );
  addEventListener(
    'click',
    (e) => {
      if (!active || picked >= 0) return;
      if (e.target instanceof Element && e.target.closest('a, button')) return; // 실제 링크/버튼 클릭은 그대로 둔다
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
      window.setTimeout(() => (location.href = book.href), P.pickMs);
    },
    { signal },
  );
  // 숨긴 링크에 키보드 포커스가 가면 대응하는 책을 호버와 같은 상태로 보여 준다
  list?.addEventListener(
    'focusin',
    (e) => {
      const href = e.target instanceof HTMLAnchorElement ? e.target.getAttribute('href') : null;
      focus = items.findIndex((b) => b.href === href);
    },
    { signal },
  );
  list?.addEventListener('focusout', () => (focus = -1), { signal });
  // 뒤로 가기로 돌아왔을 때 전환 상태를 되돌린다
  addEventListener('pageshow', () => (picked = -1), { signal });

  return {
    scene,
    camera,
    resize(a) {
      aspect = a;
      // 줄 전체가 화면 폭에 들어오도록 카메라 거리를 정한다
      const width = (n - 1) * spacing + P.size[0] * 1.3;
      const tan = Math.tan((P.fov * Math.PI) / 360);
      const d = Math.max(P.distance, (width * P.fitMargin) / (2 * tan * aspect));
      camera.aspect = aspect;
      camera.position.set(0, P.cameraY * (d / P.distance), d);
      camera.lookAt(0, P.y, 0);
      camera.updateProjectionMatrix();
    },
    update(dt, sec) {
      const p = clamp01((sec - P.appear[0]) / (P.appear[1] - P.appear[0]));
      active = p > 0.85;
      if (!active && picked < 0) {
        hover = -1;
        pointerOn = false;
      }
      const lit = focus >= 0 ? focus : hover;
      showTip(picked >= 0 ? -1 : lit);
      const litRow = lit >= 0 ? realIndex[lit] : -1;
      const pickedRow = picked >= 0 ? realIndex[picked] : -1;

      let visible = false;
      for (let i = 0; i < n; i++) {
        const o = i * CH;
        // 목표값: 등장(아래에서 순서대로) + 포인터 파도 + 호버/선택
        const t = ease(clamp01(p * (1 + P.stagger) - (P.stagger * i) / Math.max(1, n - 1)));
        const wave = pointerOn && picked < 0 ? Math.exp(-((baseX[i] - pointerX) ** 2) / (P.waveRadius * P.waveRadius)) : 0;
        let tx = baseX[i];
        let ty = P.y - (1 - t) * P.rise + wave * P.waveLift - (1 - height[i]) * P.size[1] * 0.5;
        let tz = 0;
        let tyaw = restYaw - wave * P.waveYaw;
        let ts = 1;
        if (pickedRow >= 0) {
          if (i === pickedRow) {
            tx = 0;
            ty = P.y + 0.1;
            tz = P.pickPush;
            tyaw = 0;
            ts = P.pickScale;
          } else ty = P.y - P.rise;
        } else if (i === litRow) {
          ty += P.hoverLift;
          tz = P.hoverPush;
          tyaw = P.hoverYaw;
        }
        // 스프링 적분 (값 5개)
        for (let c = 0; c < CH; c++) {
          const target = c === X ? tx : c === Y ? ty : c === Z ? tz : c === YAW ? tyaw : ts;
          vel[o + c] += ((target - cur[o + c]) * P.spring - vel[o + c] * P.damping) * dt;
          cur[o + c] += vel[o + c] * dt;
        }
        const mesh = meshes[i];
        mesh.position.set(cur[o + X], cur[o + Y], cur[o + Z]);
        mesh.rotation.y = cur[o + YAW];
        mesh.scale.set(cur[o + SCALE], cur[o + SCALE] * height[i], cur[o + SCALE]);
        if (cur[o + Y] > P.y - P.rise + 0.05) visible = true;
      }

      // 툴팁은 호버한 책의 오른쪽 위에 붙인다 (값이 바뀔 때만 스타일을 쓴다)
      if (tip && !tip.hidden && litRow >= 0) {
        const o = litRow * CH;
        v.set(cur[o + X] + P.size[0] * 0.62, cur[o + Y] + P.size[1] * 0.25, cur[o + Z]).project(camera);
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
        debugLine('books', `books ${n} (real ${real.length})  p ${p.toFixed(2)}  hover ${lit}${picked >= 0 ? `  picked ${picked}` : ''}`);
      }
      return visible;
    },
    dispose() {
      document.documentElement.style.cursor = '';
      if (tip) tip.hidden = true;
      geometry.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
