import {
  AmbientLight,
  Box3,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Shape,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
  type ToneMapping,
} from 'three';
import { arrange, blurRect, cardCanvas, drawCover, isTodo, LAYOUT, panelCanvas, paperMaps, sheetAtlas, shapeShadow, studioEnv, texture, trace, type BookData, type Placement } from './covers';
import { DEBUG, debugLine } from './debug';
import { PARAMS } from './params';

// 프로젝트 섹션(S5)의 3D 파일철 무한 캐러셀(내부 이름은 예전 그대로 books). 파티클과 같은 렌더러에 두 번째 pass로 그린다(index.ts).
// 실제 프로젝트 파일철(클릭 가능) + 장식용 빈 파일철이 고리처럼 돈다. HTML 링크 목록(#projects)이 접근성과 폴백을 맡는다.
// 폴더 하나 = Group(크림색 뒤판·앞판 얇은 판 + 아래 접힌 선 + 서류 6장(휨) + 앞 카드 + 접촉 그림자 면 + 보이지 않는 피킹 상자).
// 치수와 배치는 coverArt.ts LAYOUT/arrange. 텍스처는 서류 아틀라스·판·결 맵을 모든 폴더가 함께 쓰고, 카드만 프로젝트마다 다르다.
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
const PEEK = 5; // 호버: 종이가 솟고 위쪽이 살짝 기운다(0..1)
const CH = 6;
const TILT = -0.05; // 호버 때 위쪽이 카메라 쪽으로 기우는 각도(rad)
const PANEL = 0.006; // 앞판·뒤판 두께
const SHEET = 0.003; // 서류 두께
const CARD = 0.005; // 카드 두께
const SHADOW_M = 0.04; // 그림자 텍스처 가장자리 흐림 비율
const EXPOSURE = 1.15; // 책 pass 톤매핑 노출
const DRAG_PX = 6; // 이만큼 넘게 움직이면 드래그(클릭 전환 안 함)
// 모바일 탭: click에 기대지 않고 pointerup으로 판정한다(iOS는 클릭 불가 요소의 탭에 click을 안 보낼 수 있다)
const TAP_PX = 16; // 터치 이동 허용치(CSS px, 가로·세로 합친 거리). 이 이하면 탭, 넘으면 캐러셀 드래그
const TAP_MS = 500; // 이보다 오래 누르면 탭이 아니다
const TAP_NEAR_PX = 24; // 레이캐스트가 빗나가도 실제 책 화면 사각형에서 이 거리 안이면 가장 가까운 책

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
  scene.add(new AmbientLight(0xffffff, 0.3));
  const key = new DirectionalLight(0xfff8ee, 2.2);
  key.position.set(-3, 4, 6);
  const rim = new DirectionalLight(opts.accent, 0.8);
  rim.position.set(4, 2, -5);
  scene.add(key, rim);

  const t0 = performance.now();
  const geometries: BufferGeometry[] = [];
  const disposables: (Material | Texture)[] = [];
  let texPixels = 0; // 텍스처 메모리 추정(debug)
  const tex = (canvas: HTMLCanvasElement, o?: Parameters<typeof texture>[1]) => {
    texPixels += canvas.width * canvas.height;
    const t = texture(canvas, o);
    disposables.push(t);
    return t;
  };
  const geo = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);
  const keep = <M extends Material>(m: M) => (disposables.push(m), m);
  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) => keep(new MeshStandardMaterial(p));

  // 환경광(코드로 만든 스튜디오 equirect, three가 PMREM으로 변환)과 톤매핑. 렌더러는 점 구름과 같아서 이 scene을 그리는 동안만 바꾼다
  const env = studioEnv();
  disposables.push(env);
  texPixels += 512 * 256 * 2; // equirect + PMREM 대략
  scene.environment = env;
  scene.environmentIntensity = 1;
  let prevTone: ToneMapping = NeutralToneMapping;
  let prevExposure = 1;
  let firstAt = 0;
  let upMs = -1; // 첫 렌더(텍스처 업로드 + 셰이더 컴파일) 시간
  let calls = 0;
  scene.onBeforeRender = (r) => {
    prevTone = r.toneMapping;
    prevExposure = r.toneMappingExposure;
    r.toneMapping = NeutralToneMapping;
    r.toneMappingExposure = EXPOSURE;
    if (upMs < 0) firstAt = performance.now();
  };
  scene.onAfterRender = (r) => {
    r.toneMapping = prevTone;
    r.toneMappingExposure = prevExposure;
    if (upMs < 0) upMs = performance.now() - firstAt;
    calls = r.info.render.calls;
  };

  // 공유 텍스처: 서류 아틀라스, 판 2장, 종이 결 법선·거칠기(반복), 그림자
  const atlas = sheetAtlas();
  const fiber = paperMaps('fiber');
  const grain = paperMaps('grain');
  const atlasUnits = atlas.canvas.width / LAYOUT.sheetU; // 아틀라스 UV 1이 몇 단위인지
  const sheetMat = std({
    map: tex(atlas.canvas),
    normalMap: tex(fiber.normal, { linear: true, repeat: Math.round(atlasUnits / 0.22) }),
    normalScale: new Vector2(0.35, 0.35),
    roughnessMap: tex(fiber.rough, { linear: true, repeat: Math.round(atlasUnits / 0.22) }),
  });
  const grainN = tex(grain.normal, { linear: true, repeat: 4 });
  const grainR = tex(grain.rough, { linear: true, repeat: 4 });
  const panelMat = (which: 'back' | 'front') => std({ map: tex(panelCanvas(which)), normalMap: grainN, normalScale: new Vector2(0.3, 0.3), roughnessMap: grainR });
  const backMat = panelMat('back');
  const frontMat = panelMat('front');
  const panelEdge = std({ color: '#f1ebe1', roughness: 0.9 });
  const foldMat = std({ color: '#ddd4c5', roughness: 0.85, side: DoubleSide });
  const sheetEdges = LAYOUT.sheets.map((s) => std({ color: s.edge, roughness: 0.9 }));
  const cardEdge = std({ color: '#f6f3ec', roughness: 0.6 });
  const shade = (map: Texture, opacity: number) => keep(new MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity }));
  const rectShadow = tex(blurRect(SHADOW_M, 512));
  const sheetShadow = shade(rectShadow, 0.32);
  const cardShadow = shade(rectShadow, 0.5);
  const FM = 0.04; // 앞판 그림자 여백(단위)
  const frontShadow = shade(tex(shapeShadow(LAYOUT.front, LAYOUT.frontRect, FM, 0.018)), 0.42);
  const proxyMat = keep(new MeshBasicMaterial({ visible: false }));

  // 판: 윤곽(탭·계단)을 PANEL 두께로 밀어낸다. UV는 판 사각형 기준(앞뒷면 = 그룹 0, 단면 = 그룹 1)
  const panelGeo = (pts: typeof LAYOUT.back, r: typeof LAYOUT.backRect) => {
    const shape = new Shape();
    trace(shape, pts);
    const g = geo(new ExtrudeGeometry(shape, { depth: PANEL, bevelEnabled: false, curveSegments: 3 }));
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - r.x0) / (r.x1 - r.x0), (pos.getY(i) - r.y0) / (r.y1 - r.y0));
    return g;
  };
  const backGeo = panelGeo(LAYOUT.back, LAYOUT.backRect);
  const frontGeo = panelGeo(LAYOUT.front, LAYOUT.frontRect);
  // 아래 접힌 선: 반지름 1의 아래쪽 반원 관(x 방향). 폴더마다 scale로 반지름을 맞춘다
  const foldX0 = LAYOUT.front[LAYOUT.front.length - 1][0];
  const foldGeo = geo(new CylinderGeometry(1, 1, 0.5 - foldX0, 16, 1, true, 0, Math.PI)).rotateZ(-Math.PI / 2);
  const F = LAYOUT.frontRect;
  const frontShadowGeo = geo(new PlaneGeometry(F.x1 - F.x0 + 2 * FM, F.y1 - F.y0 + 2 * FM));
  const K = LAYOUT.card;
  const cardGeo = geo(new BoxGeometry(K.w, K.h, CARD));
  cardGeo.groups = [
    { start: 0, count: 24, materialIndex: 0 }, // 옆 4면 → 단면
    { start: 24, count: 12, materialIndex: 1 }, // 앞뒤 → 그림
  ];
  const cardShadowGeo = geo(new PlaneGeometry(K.w / (1 - 2 * SHADOW_M), K.h / (1 - 2 * SHADOW_M)));
  const proxyGeo = geo(new BoxGeometry(P.size[0], P.size[1], 1)); // 피킹·화면 사각형용(깊이는 폴더마다 scale.z)

  /** 앞판 밖으로 드러난 부분(위·왼쪽)만 앞으로 살짝 휜다. 폴더마다 seed 하나를 6장이 함께 써서 서류끼리 뚫지 않는다 */
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const curlOf = (seed: number) => {
    const top = 0.008 + seed * 0.008;
    const side = 0.007 + ((seed * 7.3) % 1) * 0.008;
    const corner = ((seed * 3.1) % 1) * 0.006;
    const phase = seed * 6.28;
    return (X: number, Y: number) => {
      const f = Math.max(0, Y - LAYOUT.frontRect.y1) / 0.2;
      const edgeX = -0.37 + 0.07 * smooth(-0.25, -0.15, Y); // 앞판 왼쪽 끝(계단 아래는 더 바깥)보다 바깥만
      const g = Math.max(0, edgeX - X) / 0.15;
      return top * f * f * (1 + 0.3 * Math.sin(X * 7 + phase)) + side * g * g + corner * f * g;
    };
  };
  /** 배치(회전·가운데) 기준 지역 좌표의 정점을 휜다 */
  const bend = (g: BufferGeometry, p: Placement, curl: (X: number, Y: number) => number, k: number) => {
    const pos = g.attributes.position;
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + k * curl(p.cx + x * c - y * s, p.cy + x * s + y * c));
    }
    g.computeVertexNormals();
    return g;
  };
  const sheetGeo = (j: number, p: Placement, curl: (X: number, Y: number) => number, k: number) => {
    const g = geo(new BoxGeometry(p.w, p.h, SHEET, 16, 24, 1));
    // 면 그룹 6개 → 2개: 옆 4면은 단면색, 앞뒤는 아틀라스(뒷면은 보이지 않는다)
    const [a, b, c2, d, front, back] = g.groups;
    g.groups = [
      { start: a.start, count: a.count + b.count + c2.count + d.count, materialIndex: 0 },
      { start: front.start, count: front.count + back.count, materialIndex: 1 },
    ];
    const cell = atlas.cells[j];
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, cell.x0 + (pos.getX(i) / p.w + 0.5) * (cell.x1 - cell.x0), cell.y0 + (pos.getY(i) / p.h + 0.5) * (cell.y1 - cell.y0));
    }
    return bend(g, p, curl, k);
  };
  const shadowGeo = (p: Placement, curl: (X: number, Y: number) => number, k: number) =>
    bend(geo(new PlaneGeometry(p.w / (1 - 2 * SHADOW_M), p.h / (1 - 2 * SHADOW_M), 8, 12)), p, curl, k);

  // 스프링 상태(폴더 n개 × CH개 값)와 폴더별 고정 값. 모두 미리 만든 타입 배열이라 프레임당 할당이 없다
  const cur = new Float32Array(n * CH);
  const vel = new Float32Array(n * CH);
  const height = new Float32Array(n); // 폴더마다 높이(±3%)와 두께가 조금씩 다르다
  const baseX = new Float32Array(n); // 이번 프레임의 캐러셀 위치(스프링을 거치지 않는다)

  const groups: Group[] = [];
  const sheetMeshes: Mesh[][] = []; // 폴더마다 서류 6장(호버 때 위·왼쪽으로 솟는다)
  const sheetBase: Placement[][] = [];
  const cards: (Mesh | null)[] = [];
  const cardZ = new Float32Array(n);
  const real: Mesh[] = []; // 레이캐스트 대상(실제 폴더의 보이지 않는 피킹 상자)
  const realIndex: number[] = []; // real[k]의 고리 안 위치
  const box = new Box3();
  let out = 0; // 폴더 아래·왼쪽 밖으로 나간 서류 수(debug, 0이어야 한다)
  for (let i = 0; i < n; i++) {
    const a = Math.abs(Math.sin(i * 12.9898 + 1.3) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(i * 78.233 + 4.1) * 12543.917) % 1;
    height[i] = 1 + (a - 0.5) * 2 * P.heightJitter;
    const T = P.thickness[0] + b * (P.thickness[1] - P.thickness[0]); // 앞판~뒤판 간격
    cur[i * CH + Y] = P.y - P.rise;
    cur[i * CH + YAW] = restYaw;
    cur[i * CH + SCALE] = 1;

    const k = i - left;
    const book = k >= 0 ? items[k] : undefined;
    const seed = book ? book.slug : `decor-${i}`;
    const place = arrange(seed);
    const rs = Math.abs(Math.sin((i + 1) * 91.7) * 4375.85) % 1;
    const curl = curlOf(rs);
    const g = new Group();
    const back = new Mesh(backGeo, [backMat, panelEdge]);
    back.position.z = -T / 2 - PANEL;
    const front = new Mesh(frontGeo, [frontMat, panelEdge]);
    front.position.z = T / 2;
    const fold = new Mesh(foldGeo, foldMat);
    fold.position.set((foldX0 + 0.5) / 2, LAYOUT.box.y0, 0);
    fold.scale.set(1, T / 2 + PANEL, T / 2 + PANEL);
    const fs = new Mesh(frontShadowGeo, frontShadow);
    fs.position.set((F.x0 + F.x1) / 2, (F.y0 + F.y1) / 2, T / 2 - 0.001);
    g.add(back, front, fold, fs);
    const meshes = place.map((p, j) => {
      const z = -T / 2 + ((j + 1) * T) / (place.length + 1);
      const kj = 1 + 0.1 * ((Math.sin((i + 3) * (j + 1) * 17.3) + 1) / 2 - 0.5); // 장마다 휨 차이(간격의 절반 이하)
      const m = new Mesh(sheetGeo(j, p, curl, kj), [sheetEdges[j], sheetMat]);
      m.position.set(p.cx, p.cy, z);
      m.rotation.z = p.angle;
      const sh = new Mesh(shadowGeo(p, curl, kj), sheetShadow);
      sh.position.z = -SHEET / 2 - 0.0012;
      m.add(sh);
      g.add(m);
      return m;
    });
    sheetMeshes.push(meshes);
    sheetBase.push(place);
    let card: Mesh | null = null;
    cardZ[i] = T / 2 + PANEL + 0.0015 + CARD / 2;
    if (book) {
      card = new Mesh(cardGeo, [cardEdge, keep(new MeshPhysicalMaterial({ map: tex(cardCanvas(book)), roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }))]);
      card.position.set(K.cx, K.cy, cardZ[i]);
      card.rotation.z = K.angle;
      const cs = new Mesh(cardShadowGeo, cardShadow);
      cs.position.set(K.cx + 0.004, K.cy - 0.008, T / 2 + PANEL + 0.0006);
      cs.rotation.z = K.angle;
      g.add(card, cs);
      // 뒤판 바깥부터 카드 앞까지 감싸는 보이지 않는 상자(실루엣 1 × 1.3)
      const proxy = new Mesh(proxyGeo, proxyMat);
      proxy.scale.z = T + 2 * PANEL + 0.004 + CARD;
      proxy.position.z = (0.004 + CARD) / 2;
      g.add(proxy);
      real.push(proxy);
      realIndex.push(i);
    }
    cards.push(card);
    // 서류 아래 끝 검사(휨 포함, 그룹 좌표계 = 아직 변환 전)
    g.updateMatrixWorld(true);
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); // 자식(그림자 면)은 빼고 서류만
      if (box.min.y < LAYOUT.box.y0 || box.min.x < LAYOUT.box.x0) out++;
    }
    groups.push(g);
    scene.add(g);
  }
  const texMs = performance.now() - t0;
  const texMB = (texPixels * 4 * 4) / 3 / 1048576; // RGBA × mipmap(4/3)

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
  let rise = P.rise; // 등장 전 숨는 깊이. 세로 화면은 카메라가 멀어 resize에서 더 깊게 잡는다
  let active = false; // S5에 거의 다 들어왔을 때만 입력을 받는다
  let hover = -1; // 포인터가 올라간 실제 책(real 인덱스)
  let focus = -1; // 키보드 포커스가 간 링크에 대응하는 책
  let picked = -1; // 클릭 전환 중인 책
  let shown = -2;
  let pointerX = 0; // 책 평면에서의 포인터 x
  let pointerOn = false;
  let tipX = -1;
  let tipY = -1;
  let navLeft = -1; // 섹션 점 영역의 왼쪽 끝(툴팁이 그 위로 넘어가지 않게). resize에서 다시 잰다
  let reportIn = 0;
  let tapId = -1; // 모바일 탭: 누른 pointerId, 위치, 시각
  let tapX = 0;
  let tapY = 0;
  let tapT = 0;
  let touchState = '-'; // debug 표시: 마지막 이벤트, 이동량, 판정
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

  /** 실제 파일철 k의 화면 사각형(CSS px, 피킹 상자 8모서리 투영). 숨어 있으면 null */
  const rect = new Float32Array(4);
  const screenRect = (k: number): Float32Array | null => {
    const proxy = real[k];
    const g = proxy?.parent;
    if (!proxy || !g || !g.visible) return null;
    g.updateMatrixWorld();
    rect[0] = rect[1] = Infinity;
    rect[2] = rect[3] = -Infinity;
    for (let c = 0; c < 8; c++) {
      v.set(((c & 1 ? 1 : -1) * P.size[0]) / 2, ((c & 2 ? 1 : -1) * P.size[1]) / 2, (c & 4 ? 1 : -1) * 0.5)
        .applyMatrix4(proxy.matrixWorld)
        .project(camera);
      const px = (v.x * 0.5 + 0.5) * innerWidth;
      const py = (0.5 - v.y * 0.5) * innerHeight;
      rect[0] = Math.min(rect[0], px);
      rect[1] = Math.min(rect[1], py);
      rect[2] = Math.max(rect[2], px);
      rect[3] = Math.max(rect[3], py);
    }
    return rect;
  };

  /** 모바일 탭 판정: 레이캐스트 → 빗나가면 화면 사각형까지 거리가 TAP_NEAR_PX 이내인 가장 가까운 실제 책(장식 책은 real에 없다) */
  const pickNear = (x: number, y: number) => {
    const hit = pick(x, y);
    if (hit >= 0) return hit;
    let best = -1;
    let bestD = TAP_NEAR_PX;
    for (let k = 0; k < real.length; k++) {
      const r = screenRect(k);
      if (!r) continue;
      const d = Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - y, 0, y - r[3]));
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
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
  /** art: 클릭 순간에 그린 2D 합성(drawCover, 상세 표지와 같은 그림·같은 2:3 틀) */
  const showOverlay = (k: number, art: HTMLCanvasElement | null) => {
    removeOverlay();
    const proxy = real[k];
    if (!canMorph || !art || !proxy) return;
    proxy.parent?.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // 상세 표지와 같은 1 × 1.5 틀(폴더 실루엣 1 × 1.3이 가운데)을 피킹 상자 앞면(카드 앞) 깊이에서 화면 좌표로
      v.set((sx * LAYOUT.frame.w) / 2, (sy * LAYOUT.frame.h) / 2, 0.5).applyMatrix4(proxy.matrixWorld).project(camera);
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
        const lim = opts.mobile && e.pointerType !== 'mouse' ? TAP_PX : DRAG_PX; // 터치는 탭 허용치를 넘어야 드래그
        if (mode !== 'drag' && Math.abs(dx) > lim) {
          mode = 'drag'; // 허용치를 넘으면 드래그: 놓은 뒤의 클릭은 전환하지 않는다
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
      if (suppressClick || opts.mobile) {
        suppressClick = false; // 모바일 이동은 아래 #s5의 pointerup 탭 판정이 맡는다
        return;
      }
      if (!active || picked >= 0 || ignoreTarget(e.target)) return;
      const k = pick(e.clientX, e.clientY);
      const book = items[k];
      if (!book) return;
      picked = k;
      hover = -1;
      showTip(-1);
      let art: HTMLCanvasElement | null = null;
      try {
        if (canMorph) art = drawCover(book); // 전환 대기(pickMs) 동안 미리 그린다
      } catch {
        art = null;
      }
      window.setTimeout(() => {
        showOverlay(k, art);
        location.href = book.href;
      }, P.pickMs);
    },
    { signal },
  );
  // 모바일 탭: #s5에 직접 건다. down 위치/시각 → up에서 이동량 ≤ 허용치, 누른 시간 ≤ TAP_MS, 드래그 아님이면 전환 없이 바로 이동.
  // pointercancel(세로 스크롤을 브라우저가 가져감)은 탭이 아니다. 리스너가 window보다 먼저 불려 드래그 여부(mode)를 그대로 읽는다
  if (opts.mobile && section) {
    section.addEventListener(
      'pointerdown',
      (e) => {
        if (!active || picked >= 0 || ignoreTarget(e.target)) return;
        tapId = e.pointerId;
        tapX = e.clientX;
        tapY = e.clientY;
        tapT = performance.now();
        touchState = 'down d0';
      },
      { signal },
    );
    section.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId !== tapId) return;
        tapId = -1;
        const d = Math.hypot(e.clientX - tapX, e.clientY - tapY);
        let res = 'miss';
        if (mode === 'drag' || d > (e.pointerType === 'mouse' ? DRAG_PX : TAP_PX)) res = 'drag';
        else if (performance.now() - tapT > TAP_MS) res = 'long';
        else if (active) {
          const book = items[pickNear(e.clientX, e.clientY)];
          if (book) {
            res = book.href.split('/').filter(Boolean).pop() ?? book.href;
            location.href = book.href; // 모바일은 전환 없이 바로 이동
          }
        }
        touchState = `up d${Math.round(d)} ${res}`;
      },
      { signal },
    );
    section.addEventListener(
      'pointercancel',
      (e) => {
        if (e.pointerId !== tapId) return;
        tapId = -1;
        touchState = 'cancel';
      },
      { signal },
    );
  }
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
      navLeft = -1;
      // 데스크톱은 고리 전체가, 모바일은 책 몇 권이 화면 폭에 들어오는 거리
      const width = opts.mobile ? P.mobileVisible * spacing : (n - 1) * spacing + P.size[0] * 1.3;
      const tan = Math.tan((P.fov * Math.PI) / 360);
      const d = Math.max(P.distance, (width * P.fitMargin) / (2 * tan * aspect));
      camera.aspect = aspect;
      camera.position.set(0, P.cameraY * (d / P.distance), d);
      camera.lookAt(0, P.y, 0);
      camera.updateProjectionMatrix();
      worldPerPx = (2 * tan * camera.position.length()) / innerHeight;
      // 숨은 책(가장 큰 높이, 가운데 z) 윗면이 화면 아래 가장자리보다 0.3 아래에 오게 한다(데스크톱은 P.rise 그대로)
      const bottom = camera.position.y - (d - zCenter) * Math.tan(Math.atan2(camera.position.y - P.y, d) + (P.fov * Math.PI) / 360);
      rise = Math.max(P.rise, P.y + P.size[1] * (1 + P.heightJitter) * 0.5 - bottom + 0.3);
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
        const hiddenY = P.y - rise - (1 - height[i]) * P.size[1] * 0.5; // 등장 전 이 책의 숨은 높이
        let ty = hiddenY + t * rise + wave * P.waveLift;
        let tz = zCenter * mid;
        let tyaw = restYaw * (1 - P.centerTurn * mid) - wave * P.waveYaw;
        let ts = 1;
        let tpeek = 0;
        if (pickedRow >= 0) {
          if (i === pickedRow) {
            tshift = -sx; // 선택한 책만 화면 중앙으로
            ty = P.y + 0.1;
            tz = P.pickPush;
            tyaw = 0;
            ts = P.pickScale;
          } else ty = hiddenY;
        } else if (i === litRow) {
          ty += P.hoverLift;
          tz = zHover;
          tyaw = P.hoverYaw;
          tpeek = 1; // 종이가 조금 솟고 위쪽이 살짝 기운다
        }
        // 스프링 적분 (값 CH개)
        for (let c = 0; c < CH; c++) {
          const target = c === SHIFT ? tshift : c === Y ? ty : c === Z ? tz : c === YAW ? tyaw : c === PEEK ? tpeek : ts;
          vel[o + c] += ((target - cur[o + c]) * P.spring - vel[o + c] * P.damping) * dt;
          cur[o + c] += vel[o + c] * dt;
        }
        // 고리 끝: 스프링 밖에서 곱한다. 래핑은 항상 크기 0인 순간에 일어나서 튀지 않는다
        const edge = i === pickedRow ? 1 : ease(clamp01((fadeEnd - Math.abs(bx)) / fadeLen));
        const s = cur[o + SCALE] * edge;
        const g = groups[i];
        g.visible = s > 0.001;
        g.position.set(sx + cur[o + SHIFT], cur[o + Y] - (1 - edge) * P.edgeSink, cur[o + Z]);
        g.rotation.set(TILT * cur[o + PEEK], cur[o + YAW], 0, 'YXZ'); // 돌린 뒤 제자리에서 앞으로 기운다
        g.scale.set(s, s * height[i], s);
        const peek = cur[o + PEEK];
        for (let j = 0; j < LAYOUT.sheets.length; j++) {
          const [dx, dy] = LAYOUT.sheets[j].peek; // 위·왼쪽으로만(뒤쪽일수록 많이)
          const b = sheetBase[i][j];
          sheetMeshes[i][j].position.x = b.cx + dx * peek;
          sheetMeshes[i][j].position.y = b.cy + dy * peek;
        }
        cards[i]?.position.setZ(cardZ[i] + 0.01 * peek);
        // 파일철마다 자기 숨은 높이 기준(키 큰 것은 숨은 자리가 기준보다 높아 p = 0에서도 pass 2가 켜지던 문제)
        if (g.visible && cur[o + Y] > hiddenY + 0.05) visible = true;
      }

      // 툴팁은 호버한 책의 오른쪽 위에 붙인다 (값이 바뀔 때만 스타일을 쓴다)
      if (tip && !tip.hidden && litRow >= 0) {
        const o = litRow * CH;
        v.set(baseX[litRow] + cur[o + SHIFT] + P.size[0] * 0.62, cur[o + Y] + P.size[1] * 0.25, cur[o + Z]).project(camera);
        if (navLeft < 0) {
          const r = document.querySelector('.section-nav')?.getBoundingClientRect();
          navLeft = r && r.width > 0 ? r.left : innerWidth; // 없거나 숨김(폭 0)이면 화면 오른쪽 끝 기준
        }
        const x = Math.round(Math.min(navLeft - tip.offsetWidth - 12, (v.x * 0.5 + 0.5) * innerWidth));
        // 아래쪽을 먼저, 위쪽을 나중에 막는다: 창보다 키가 커도 제목이 보이게
        const y = Math.round(Math.max(12, Math.min(innerHeight - tip.offsetHeight - 12, (0.5 - v.y * 0.5) * innerHeight)));
        if (x !== tipX || y !== tipY) {
          tipX = x;
          tipY = y;
          tip.style.transform = `translate(${x}px, ${y}px)`;
        }
      }
      if (DEBUG && (reportIn -= dt) <= 0) {
        reportIn = 0.25;
        // 확인 스크립트용: 실제 책의 화면 사각형과 slug(?debug에서만)
        Object.assign(window, { __bookRects: real.map((_, k) => ({ href: items[k].href, r: screenRect(k) ? [...rect].map(Math.round) : null })) });
        // 가장 높이 올라온 책 윗면의 화면 y(px, 위에서부터). innerHeight보다 크면 화면 밖
        let top = Infinity;
        for (let i = 0; i < n; i++) {
          if (!groups[i].visible) continue;
          const o = i * CH;
          v.set(baseX[i] + cur[o + SHIFT], cur[o + Y] + P.size[1] * height[i] * 0.5 * cur[o + SCALE], cur[o + Z]).project(camera);
          top = Math.min(top, (0.5 - v.y * 0.5) * innerHeight);
        }
        debugLine('books', `books ${n} (real ${real.length})  p ${p.toFixed(2)}  draw ${visible ? 'on' : 'off'}  touch ${touchState}  top ${Math.round(top)}/${innerHeight}  ${mode}  offset ${offset.toFixed(2)}  hover ${lit}${picked >= 0 ? `  picked ${picked}` : ''}  tex ${Math.round(texMs)}ms up ${Math.round(upMs)}ms ~${Math.round(texMB)}MB calls ${calls} out ${out}`);
      }
      return visible;
    },
    dispose() {
      removeOverlay();
      document.documentElement.style.cursor = '';
      if (tip) tip.hidden = true;
      for (const g of geometries) g.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
