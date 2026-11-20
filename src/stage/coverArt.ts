// 프로젝트 파일 폴더 그림(순수 2D 캔버스, three를 import하지 않는다: 상세 페이지 번들에서도 쓴다). 외부 이미지는 쓰지 않는다.
// 폴더 = 크림색 뒤판(왼쪽 위 탭) + 서류 6장(위·왼쪽으로 층층이 삐져나옴) + 계단형 왼쪽 가장자리의 앞판 + 앞에 놓인 인화 사진 카드.
// 3D(books.ts)는 같은 LAYOUT과 같은 그림 함수로 판·서류·카드를 따로 만들고, drawCover는 같은 것을 2D로 겹친 그림이다
// (상세 페이지 표지, 홈 전환 오버레이). 정책: 실제 로고·상표 도형·사진 내용·글자·숫자 없음. 프로젝트 구분은 카드 마크와 색으로만.
export interface BookData {
  slug: string;
  title: string;
  summary: string;
  hue: number;
  order: number;
  href: string;
}
type Ctx = CanvasRenderingContext2D;

/** 1 월드 단위당 텍스처 픽셀(판, 카드, 2D 합성) */
export const PX = 1024;

// ---------------------------------------------------------------------------------------------
// 레이아웃: 단위는 월드(books.ts), 원점은 실루엣 가운데, y는 위로. 실루엣 1 × 1.3(PARAMS.books.size와 같다).
// 윤곽 점은 [x, y, 모서리 반경], 반시계 방향.
export type Pt = readonly [number, number, number?];
export type Rect = { x0: number; x1: number; y0: number; y1: number };
export type SheetKind = 'memo' | 'marble' | 'offwhite' | 'lightgray' | 'navy' | 'blueprint';
export interface SheetDef {
  kind: SheetKind;
  color: string;
  /** 단면색(종이보다 살짝 밝게) */
  edge: string;
  /** 회전한 뒤의 왼쪽 끝 x */
  left: number;
  w: number;
  /** 최대 각도(3°)일 때의 위 끝 y. 각도가 작으면 조금 낮아진다 */
  top: number;
  /** 호버 때 솟는 양(dx ≤ 0, dy ≥ 0: 위·왼쪽으로만) */
  peek: readonly [number, number];
}
const DEG = Math.PI / 180;
const MAX_TILT = 3 * DEG;
const MIN_TILT = 0.6 * DEG;
export const LAYOUT = {
  /** 상세 표지·전환 오버레이 틀(2:3). 폴더 실루엣은 이 틀 가운데에 들어가고 위아래는 투명 여백 */
  frame: { w: 1, h: 1.5 },
  box: { x0: -0.5, x1: 0.5, y0: -0.65, y1: 0.65 } as Rect,
  // 뒤판: 앞판보다 왼쪽으로 넓다. 왼쪽 위 탭이 솟고, 탭 아래에서 왼쪽 가장자리가 0.025 안쪽으로 단차진다
  back: [
    [0.5, -0.65, 0.006],
    [0.5, 0.47, 0.008],
    [-0.12, 0.47, 0.012],
    [-0.165, 0.65, 0.014],
    [-0.5, 0.65, 0.012],
    [-0.5, 0.3, 0.006],
    [-0.475, 0.28, 0.006],
    [-0.475, -0.65, 0.006],
  ] as Pt[],
  backRect: { x0: -0.5, x1: 0.5, y0: -0.65, y1: 0.65 } as Rect,
  // 앞판: 위쪽은 뒤판 왼쪽에서 폭의 약 20% 안쪽, 아래쪽 35%는 왼쪽으로 튀어나온 계단형
  front: [
    [0.5, -0.65, 0.006],
    [0.5, 0.43, 0.008],
    [-0.3, 0.43, 0.008],
    [-0.3, -0.25, 0.012],
    [-0.37, -0.29, 0.012],
    [-0.37, -0.65, 0.006],
  ] as Pt[],
  frontRect: { x0: -0.37, x1: 0.5, y0: -0.65, y1: 0.43 } as Rect,
  /** 서류 아래 끝 한계(폴더 아래 끝 + 0.03). 회전해도 이보다 내려가지 않는다 */
  bottomLimit: -0.62,
  // 뒤 → 앞. 왼쪽 끝은 오프화이트가 가장 바깥, 블루프린트가 가장 안쪽. 위 끝은 순서를 조금 섞고(앞판 위로 최대 0.19 = 높이의 18%),
  // 어두운 두 장(남회색, 블루프린트)은 낮게 두어 위쪽 띠가 밝은 종이 위주로 보이게 한다
  sheets: [
    { kind: 'memo', color: '#f1efe9', edge: '#fbfaf6', left: -0.435, w: 0.86, top: 0.62, peek: [-0.03, 0.08] },
    { kind: 'marble', color: '#aab0b8', edge: '#c3c8ce', left: -0.4, w: 0.82, top: 0.55, peek: [-0.025, 0.065] },
    { kind: 'offwhite', color: '#e8e6df', edge: '#f5f4ef', left: -0.45, w: 0.84, top: 0.59, peek: [-0.02, 0.05] },
    { kind: 'lightgray', color: '#cfd4da', edge: '#e2e5e9', left: -0.42, w: 0.83, top: 0.53, peek: [-0.015, 0.04] },
    { kind: 'navy', color: '#2b3342', edge: '#4a5466', left: -0.37, w: 0.8, top: 0.5, peek: [-0.01, 0.03] },
    { kind: 'blueprint', color: '#0a1c36', edge: '#2a4266', left: -0.335, w: 0.76, top: 0.475, peek: [-0.005, 0.02] },
  ] as SheetDef[],
  /** 앞 카드(인화 사진 모양): 가운데, 크기, 기울기, 테두리(옆, 위, 아래) */
  card: { cx: 0.1, cy: -0.08, w: 0.56, h: 0.66, angle: 3 * DEG, side: 0.03, topB: 0.03, bottomB: 0.1 },
  /** 서류 아틀라스: 1 단위당 픽셀, 칸 크기(3열 × 2행 = 2048²) */
  sheetU: 790,
  cell: { w: 682, h: 1024 },
};
/** 서류 하나의 고정 높이: 최대 각도에서 아래 끝이 bottomLimit, 위 끝이 top이 되게 폴더 높이에서 계산한다 */
export const sheetH = (s: SheetDef) => (s.top - LAYOUT.bottomLimit - s.w * Math.sin(MAX_TILT)) / Math.cos(MAX_TILT);

// ---------------------------------------------------------------------------------------------
// 색
const C = {
  front: '#e7dfd2',
  back: '#d9cfbf',
  memoLine: '#b9bfca',
  grid: 'rgba(120, 170, 230, 0.3)',
  gridBold: 'rgba(120, 170, 230, 0.48)',
  draft: 'rgba(170, 205, 245, 0.78)',
  cardBorder: '#f6f3ec',
  cardInner: '#1a1f27',
  markInk: '#d9dee6',
} as const;
// 프로젝트 마크 색(카드 안에서만 쓴다)
const ACCENT: Record<string, string> = {
  netflix: '#e27f78',
  'airbnb-nyc': '#e7a6bc',
  'online-retail': '#e8be72',
  'nyc-congestion-pricing': '#6fcfc3',
};
export const accentOf = (book: BookData) => ACCENT[book.slug] ?? `hsl(${book.hue} 55% 68%)`;

// ---------------------------------------------------------------------------------------------
/** 아직 확정되지 않은 값("TODO: 내 확인 필요")은 툴팁에 그리지 않는다 */
export const isTodo = (s: string) => s.trimStart().startsWith('TODO');

/** 고정 난수: 같은 seed는 매번 같은 그림 */
export function rng(seed: string | number) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}
export function canvas2d(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [canvas, ctx];
}
const roundRect = (x: Ctx, l: number, t: number, w: number, h: number, r: number | number[]) => {
  x.beginPath();
  x.roundRect(l, t, w, h, r);
  x.fill();
};

/** 둥근 모서리 윤곽을 그린다. canvas Path2D와 three Shape 둘 다 받는다(같은 윤곽) */
export interface PathLike {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): unknown;
}
export function trace(p: PathLike, pts: readonly Pt[]) {
  const n = pts.length;
  const toward = (a: Pt, b: Pt, r: number): [number, number] => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const k = Math.min(r, d / 2) / d;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const r = c[2] ?? 0;
    const a = toward(c, pts[(i + n - 1) % n], r);
    const b = toward(c, pts[(i + 1) % n], r);
    if (i) p.lineTo(a[0], a[1]);
    else p.moveTo(a[0], a[1]);
    p.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  }
}
const pathOf = (pts: readonly Pt[]) => {
  const p = new Path2D();
  trace(p, pts);
  p.closePath();
  return p;
};
/** 단위 좌표(y 위) → 픽셀(y 아래) 변환을 건다. 이후 경로는 단위로 그린다 */
const unitSpace = (x: Ctx, r: Rect, u: number) => x.setTransform(u, 0, 0, -u, -r.x0 * u, r.y1 * u);

// ---------------------------------------------------------------------------------------------
// 배치: 서류마다 각도(±0.6~3°, seed 고정)와 가운데. 높이는 고정이라 아틀라스 그림이 늘어나지 않는다.
// 회전한 직사각형의 아래 끝 = cy − (h·cosθ + w·|sinθ|)/2 = bottomLimit(정확히), 왼쪽 끝 = left
export interface Placement {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}
export function arrange(seed: string | number): Placement[] {
  const rand = rng(`arrange:${seed}`);
  return LAYOUT.sheets.map((s) => {
    const h = sheetH(s);
    const angle = (rand() < 0.5 ? -1 : 1) * (MIN_TILT + rand() * (MAX_TILT - MIN_TILT));
    const c = Math.cos(angle);
    const sn = Math.abs(Math.sin(angle));
    return { cx: s.left + (s.w * c + h * sn) / 2, cy: LAYOUT.bottomLimit + (h * c + s.w * sn) / 2, w: s.w, h, angle };
  });
}
/** 회전한 네 모서리가 실루엣 안(아래 끝은 bottomLimit 위)에 있는지 다시 센다. 위반 수를 돌려준다 */
export function checkLayout(ps: Placement[]): number {
  const B = LAYOUT.box;
  let bad = 0;
  for (const p of ps) {
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = p.cx + (sx * p.w * c) / 2 - (sy * p.h * s) / 2;
      const y = p.cy + (sx * p.w * s) / 2 + (sy * p.h * c) / 2;
      if (y < LAYOUT.bottomLimit - 1e-6 || x < B.x0 - 1e-6 || x > B.x1 + 1e-6 || y > B.y1 + 1e-6) bad++;
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// 질감: 작은 노이즈 타일(고정 seed)을 패턴으로 깐다. streak > 0이면 가로 결(카드스톡)
const tiles = new Map<string, HTMLCanvasElement>();
function noiseTile(kind: 'fiber' | 'grain'): HTMLCanvasElement {
  let t = tiles.get(kind);
  if (t) return t;
  const n = 256;
  const [c, x] = canvas2d(n, n);
  const img = x.createImageData(n, n);
  const rand = rng(kind);
  const rows = Array.from({ length: n }, () => rand());
  for (let i = 0; i < n * n; i++) {
    const row = rows[(i / n) | 0];
    const v = kind === 'grain' ? 0.3 * row + 0.7 * rand() : rand() * rand() * 1.6;
    const g = Math.round(255 * Math.min(1, v));
    img.data.set([g, g, g, 255], i * 4);
  }
  x.putImageData(img, 0, 0);
  tiles.set(kind, (t = c));
  return t;
}
/** 저주파 얼룩(옅은 색 번짐)과 고주파 결을 현재 클립 안에 얹는다 */
function texture(x: Ctx, w: number, h: number, u: number, rand: () => number, kind: 'fiber' | 'grain', dark = false) {
  x.save();
  const pat = x.createPattern(noiseTile(kind), 'repeat');
  if (pat) {
    pat.setTransform(new DOMMatrix().scale(Math.max(1, u / 900)));
    x.globalCompositeOperation = dark ? 'screen' : 'multiply';
    x.globalAlpha = dark ? 0.05 : kind === 'grain' ? 0.045 : 0.07;
    x.fillStyle = pat;
    x.fillRect(0, 0, w, h);
  }
  x.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = (0.08 + rand() * 0.25) * u;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = rand() < 0.6;
    g.addColorStop(0, warm ? (dark ? 'rgba(120,140,170,0.05)' : 'rgba(150,120,80,0.05)') : 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = 1;
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.restore();
}
/** 가장자리: 안쪽으로 살짝 어두운 띠 + 닳은 밝은 선. path는 현재 변환 기준 */
function edges(x: Ctx, path: Path2D, lw: number, dark = false) {
  x.save();
  x.clip(path);
  x.strokeStyle = dark ? 'rgba(0,0,0,0.25)' : 'rgba(90,70,40,0.12)';
  x.lineWidth = lw * 6;
  x.stroke(path);
  x.strokeStyle = dark ? 'rgba(200,215,235,0.28)' : 'rgba(255,255,255,0.55)';
  x.lineWidth = lw * 1.5;
  x.stroke(path);
  x.restore();
}

// ---------------------------------------------------------------------------------------------
// 폴더 판(모든 폴더 공통 그림 한 벌)
export function panelCanvas(which: 'back' | 'front', scale = 1): HTMLCanvasElement {
  const r = which === 'back' ? LAYOUT.backRect : LAYOUT.frontRect;
  const pts = which === 'back' ? LAYOUT.back : LAYOUT.front;
  const u = PX * scale;
  const [canvas, x] = canvas2d((r.x1 - r.x0) * u, (r.y1 - r.y0) * u);
  const path = pathOf(pts);
  unitSpace(x, r, u);
  x.fillStyle = which === 'back' ? C.back : C.front;
  x.fill(path);
  x.save();
  x.clip(path);
  x.setTransform(1, 0, 0, 1, 0, 0);
  // 위가 조금 밝고 아래가 조금 어두운 면 명암
  const g = x.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(70,50,20,0.06)');
  x.fillStyle = g;
  x.fillRect(0, 0, canvas.width, canvas.height);
  texture(x, canvas.width, canvas.height, u, rng(`panel:${which}`), 'grain');
  // 아래 접힌 선의 얇은 하이라이트
  const fold = x.createLinearGradient(0, canvas.height - 0.03 * u, 0, canvas.height);
  fold.addColorStop(0, 'rgba(255,255,255,0)');
  fold.addColorStop(0.75, 'rgba(255,255,255,0.22)');
  fold.addColorStop(1, 'rgba(120,95,60,0.18)');
  x.fillStyle = fold;
  x.fillRect(0, canvas.height - 0.03 * u, canvas.width, 0.03 * u);
  x.restore();
  unitSpace(x, r, u);
  edges(x, path, 0.0015);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// 서류: 각 함수는 (0,0)~(w,h) 픽셀 영역에 그린다
function paintSheet(x: Ctx, s: SheetDef, w: number, h: number, u: number) {
  const rand = rng(`sheet:${s.kind}`);
  const dark = s.kind === 'navy' || s.kind === 'blueprint';
  x.fillStyle = s.color;
  x.fillRect(0, 0, w, h);
  if (s.kind === 'memo') {
    // 줄 메모지: 가로줄만(글자 없음)
    x.fillStyle = C.memoLine;
    for (let y = 0.07 * u; y < h - 0.02 * u; y += 0.034 * u) x.fillRect(0, Math.round(y), w, Math.max(1, 0.0016 * u));
    x.fillStyle = 'rgba(185,191,202,0.7)';
    x.fillRect(0.075 * u, 0, Math.max(1, 0.0016 * u), h); // 왼쪽 여백선
  } else if (s.kind === 'marble') {
    // 대리석 결: 흐린 곡선 몇 개(밝고 어둡게)
    x.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = rand() < 0.5 ? 'rgba(80,88,100,0.16)' : 'rgba(240,243,246,0.22)';
      x.lineWidth = (0.002 + rand() * 0.006) * u;
      x.shadowColor = x.strokeStyle;
      x.shadowBlur = 0.006 * u;
      x.beginPath();
      let px = rand() * w;
      let py = rand() * h;
      x.moveTo(px, py);
      for (let k = 0; k < 4; k++) {
        const nx = px + (rand() - 0.3) * 0.35 * u;
        const ny = py + (rand() - 0.5) * 0.3 * u;
        x.quadraticCurveTo((px + nx) / 2 + (rand() - 0.5) * 0.1 * u, (py + ny) / 2 + (rand() - 0.5) * 0.1 * u, nx, ny);
        px = nx;
        py = ny;
      }
      x.stroke();
    }
    x.shadowBlur = 0;
  } else if (s.kind === 'offwhite') {
    // 인쇄된 문서처럼 옅은 회색 블록(읽히는 글자 없음)
    x.fillStyle = 'rgba(120,124,132,0.16)';
    for (let y = 0.09 * u; y < h - 0.05 * u; y += 0.05 * u) {
      if (rand() < 0.18) continue;
      roundRect(x, 0.07 * u, y, (w - 0.14 * u) * (0.45 + rand() * 0.5), 0.012 * u, 0.006 * u);
    }
  } else if (s.kind === 'navy') {
    x.fillStyle = 'rgba(160,175,200,0.08)';
    for (let y = 0.1 * u; y < h; y += 0.11 * u) x.fillRect(0.06 * u, y, w - 0.12 * u, Math.max(1, 0.002 * u));
  } else if (s.kind === 'blueprint') paintBlueprint(x, w, h, u, rand);
  texture(x, w, h, u, rand, 'fiber', dark);
  const p = new Path2D();
  p.rect(0, 0, w, h);
  edges(x, p, 0.0015 * u, dark);
}

function paintBlueprint(x: Ctx, w: number, h: number, u: number, rand: () => number) {
  const g = 0.03 * u;
  for (let i = 0, p = 0; p <= w + 1; i++, p = i * g) {
    x.fillStyle = i % 4 ? C.grid : C.gridBold;
    x.fillRect(Math.round(p), 0, i % 4 ? 1 : 1.5, h);
  }
  for (let i = 0, p = 0; p <= h + 1; i++, p = i * g) {
    x.fillStyle = i % 4 ? C.grid : C.gridBold;
    x.fillRect(0, Math.round(p), w, i % 4 ? 1 : 1.5);
  }
  x.strokeStyle = C.draft;
  x.lineWidth = Math.max(1.5, 0.0025 * u);
  const snap = (v: number) => Math.round(v / g) * g;
  // 작도선: 상자 윤곽, 점선 원, 치수선 모양(숫자 없음). 위쪽(앞판 밖으로 보이는 띠)에도 걸리게
  for (let i = 0; i < 3; i++) {
    const bw = snap((0.16 + rand() * 0.2) * u);
    const bh = snap((0.08 + rand() * 0.12) * u);
    x.strokeRect(snap(0.06 * u + rand() * (w - bw - 0.12 * u)), snap(0.04 * u + rand() * h * 0.5), bw, bh);
  }
  x.setLineDash([0.012 * u, 0.01 * u]);
  for (let i = 0; i < 2; i++) {
    x.beginPath();
    x.arc(0.15 * u + rand() * (w - 0.3 * u), 0.1 * u + rand() * h * 0.4, (0.05 + rand() * 0.07) * u, 0, Math.PI * 2);
    x.stroke();
  }
  x.setLineDash([]);
  for (let i = 0; i < 2; i++) {
    const y = snap(0.05 * u + rand() * h * 0.3);
    const x0 = snap(0.05 * u + rand() * w * 0.3);
    const x1 = Math.min(snap(x0 + (0.2 + rand() * 0.3) * u), w - 0.05 * u);
    x.beginPath();
    x.moveTo(x0, y);
    x.lineTo(x1, y);
    for (const ex of [x0, x1]) {
      x.moveTo(ex, y - 0.015 * u);
      x.lineTo(ex, y + 0.015 * u);
    }
    x.stroke();
  }
}

/** 서류 6장을 한 장(2048²)에 그린 아틀라스. cells[j]는 서류 j의 UV 사각형(v는 아래에서 위로) */
export function sheetAtlas(): { canvas: HTMLCanvasElement; cells: Rect[] } {
  const { cell, sheetU: u } = LAYOUT;
  const [canvas, x] = canvas2d(cell.w * 3, cell.h * 2);
  const cells = LAYOUT.sheets.map((s, j) => {
    const l = (j % 3) * cell.w;
    const t = Math.floor(j / 3) * cell.h;
    const w = Math.round(s.w * u);
    const h = Math.round(sheetH(s) * u);
    x.save();
    x.translate(l, t);
    x.beginPath();
    x.rect(0, 0, w, h);
    x.clip();
    paintSheet(x, s, w, h, u);
    x.restore();
    return { x0: l / canvas.width, x1: (l + w) / canvas.width, y0: 1 - (t + h) / canvas.height, y1: 1 - t / canvas.height };
  });
  return { canvas, cells };
}

// ---------------------------------------------------------------------------------------------
// 프로젝트 마크: 카드 안쪽 어두운 면에 그리는 직접 만든 도형. 프로젝트마다 함수 하나라 한 개만 바꿔도 다른 코드는 그대로다.
// 선과 면만 쓴다(글자·숫자·화살표·축 없음). 모양 언어가 서로 다르다: 열린 선 / 격자 / 덩어리 / 막대 열.
type MarkFn = (x: Ctx, l: number, t: number, w: number, h: number, accent: string) => void;
const MARKS: Record<string, MarkFn> = {
  // 7점이 번갈아 위아래인 꺾은선 6구간. 진폭을 낮고 넓게 해서 글자(W, V)처럼 읽히지 않게 한다
  netflix(x, l, t, w, h, accent) {
    x.strokeStyle = accent;
    x.lineWidth = h * 0.075;
    x.lineJoin = x.lineCap = 'round';
    x.beginPath();
    for (let i = 0; i < 7; i++) {
      const px = l + w * (0.1 + (0.8 * i) / 6);
      const py = t + h * (i % 2 ? 0.6 : 0.4);
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
  },
  // 3×3 구역 타일, 가운데 한 칸만 강조
  'nyc-congestion-pricing'(x, l, t, w, h, accent) {
    const s = h * 0.74;
    const cell = s / 3;
    const ox = l + (w - s) / 2;
    const oy = t + (h - s) / 2;
    const g = cell * 0.14;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cx = ox + c * cell + g / 2;
        const cy = oy + r * cell + g / 2;
        if (r === 1 && c === 1) {
          x.fillStyle = accent;
          roundRect(x, cx, cy, cell - g, cell - g, cell * 0.12);
        } else {
          x.strokeStyle = C.markInk;
          x.lineWidth = h * 0.03;
          x.beginPath();
          x.roundRect(cx, cy, cell - g, cell - g, cell * 0.12);
          x.stroke();
        }
      }
    }
  },
  // 크기가 다른 블록이 쌓인 덩어리, 가장 큰 블록만 강조
  'airbnb-nyc'(x, l, t, w, h, accent) {
    const u = h / 10;
    const base = t + h * 0.84;
    const blocks: [number, number, number, number, boolean][] = [
      // 왼쪽(u), 아래에서 위로(u), 폭, 높이, 강조
      [-3.6, 0, 4.4, 3.4, true],
      [1.0, 0, 2.6, 2.2, false],
      [-2.8, 3.6, 2.6, 2.0, false],
      [0.0, 2.4, 2.0, 1.8, false],
    ];
    const cx = l + w / 2;
    for (const [bx, by, bw, bh, hot] of blocks) {
      x.fillStyle = hot ? accent : C.markInk;
      roundRect(x, cx + bx * u, base - (by + bh) * u, bw * u, bh * u, u * 0.3);
    }
  },
  // 왼쪽에서 오른쪽으로 짧아지는 막대 5개, 농도가 점점 옅어진다
  'online-retail'(x, l, t, w, h, accent) {
    const hs = [1, 0.74, 0.54, 0.4, 0.3];
    const bw = w * 0.1;
    const gap = w * 0.05;
    const total = hs.length * bw + (hs.length - 1) * gap;
    const ox = l + (w - total) / 2;
    const base = t + h * 0.84;
    hs.forEach((k, i) => {
      x.globalAlpha = 1 - i * 0.14;
      x.fillStyle = accent;
      const bh = k * h * 0.66;
      roundRect(x, ox + i * (bw + gap), base - bh, bw, bh, [bw * 0.25, bw * 0.25, 0, 0]);
    });
    x.globalAlpha = 1;
  },
};
const fallbackMark: MarkFn = (x, l, t, w, h, accent) => {
  x.fillStyle = accent;
  x.beginPath();
  x.arc(l + w / 2, t + h / 2, h * 0.28, 0, Math.PI * 2);
  x.fill();
};

/** 앞 카드(인화 사진 모양): 흰 테두리(아래가 넓다) + 어두운 면 + 약한 광택 + 큰 마크 */
export function cardCanvas(book: BookData, scale = 1): HTMLCanvasElement {
  const K = LAYOUT.card;
  const u = PX * scale;
  const [canvas, x] = canvas2d(K.w * u, K.h * u);
  const w = canvas.width;
  const h = canvas.height;
  x.fillStyle = C.cardBorder;
  x.fillRect(0, 0, w, h);
  texture(x, w, h, u, rng(`card:${book.slug}`), 'fiber');
  const l = K.side * u;
  const t = K.topB * u;
  const iw = w - 2 * l;
  const ih = h - t - K.bottomB * u;
  x.fillStyle = C.cardInner;
  x.fillRect(l, t, iw, ih);
  // 인화지 광택: 왼쪽 위에서 오는 옅은 빛 + 가장자리 비네트
  const sheen = x.createLinearGradient(l, t, l + iw, t + ih);
  sheen.addColorStop(0, 'rgba(255,255,255,0.09)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  x.fillStyle = sheen;
  x.fillRect(l, t, iw, ih);
  const mw = iw * 0.9; // 마크 함수는 상자 안쪽 약 80%에 그린다 → 안쪽 폭의 약 70%
  const mh = mw * 0.6;
  (MARKS[book.slug] ?? fallbackMark)(x, l + (iw - mw) / 2, t + (ih - mh) / 2, mw, mh, accentOf(book));
  x.strokeStyle = 'rgba(0,0,0,0.35)';
  x.lineWidth = Math.max(1, 0.002 * u);
  x.strokeRect(l, t, iw, ih);
  const p = new Path2D();
  p.rect(0, 0, w, h);
  edges(x, p, 0.0012 * u);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
/**
 * 2D 합성(상세 페이지 표지, 홈 전환 오버레이): 1024 × 1536(scale 1) 틀 가운데에 폴더(1 × 1.3), 위아래는 투명 여백.
 * 3D와 같은 그림·같은 seed 배치를 뒤판 → 서류 6장 → 앞판 → 카드 순서로 겹치고, 접촉 그림자는 shadowBlur로 그린다.
 */
export function drawCover(book: BookData, scale = 1): HTMLCanvasElement {
  const F = LAYOUT.frame;
  const u = PX * scale;
  const [canvas, x] = canvas2d(F.w * u, F.h * u);
  const frame: Rect = { x0: -F.w / 2, x1: F.w / 2, y0: -F.h / 2, y1: F.h / 2 };
  const toPx = (X: number, Y: number) => [(X - frame.x0) * u, (frame.y1 - Y) * u] as const;
  const shadow = (blur: number, alpha: number, dy = 0) => {
    x.shadowColor = `rgba(20,14,6,${alpha})`;
    x.shadowBlur = blur * u;
    x.shadowOffsetY = dy * u;
  };
  const noShadow = () => {
    x.shadowColor = 'transparent';
    x.shadowBlur = x.shadowOffsetY = 0;
  };

  // 바닥 그림자(아래 여백)
  const [bx, by] = toPx(0, LAYOUT.box.y0);
  x.save();
  x.translate(bx, by);
  x.scale(1, 0.06);
  const fg = x.createRadialGradient(0, 0, 0, 0, 0, 0.5 * u);
  fg.addColorStop(0, 'rgba(0,0,0,0.45)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = fg;
  x.fillRect(-0.55 * u, -0.5 * u, 1.1 * u, u);
  x.restore();

  const at = (r: Rect) => toPx(r.x0, r.y1);
  x.drawImage(panelCanvas('back', scale), ...at(LAYOUT.backRect));
  const { canvas: atlas, cells } = sheetAtlas();
  const k = u / LAYOUT.sheetU;
  arrange(book.slug).forEach((p, j) => {
    const c = cells[j];
    const [cx, cy] = toPx(p.cx, p.cy);
    x.save();
    x.translate(cx, cy);
    x.rotate(-p.angle);
    shadow(0.012, 0.28);
    const sw = (c.x1 - c.x0) * atlas.width;
    const sh = (c.y1 - c.y0) * atlas.height;
    x.drawImage(atlas, c.x0 * atlas.width, (1 - c.y1) * atlas.height, sw, sh, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
    x.restore();
  });
  shadow(0.014, 0.3);
  x.drawImage(panelCanvas('front', scale), ...at(LAYOUT.frontRect));
  const K = LAYOUT.card;
  const [kx, ky] = toPx(K.cx, K.cy);
  x.save();
  x.translate(kx, ky);
  x.rotate(-K.angle);
  shadow(0.012, 0.35, 0.006);
  x.drawImage(cardCanvas(book, scale), (-K.w * u) / 2, (-K.h * u) / 2);
  x.restore();
  noShadow();
  // 왼쪽 위 키 라이트처럼 옅은 명암(그린 픽셀 위에만)
  x.globalCompositeOperation = 'source-atop';
  const [lx, ly] = toPx(-0.5, 0.65);
  const [rx, ry] = toPx(0.5, -0.65);
  const lg = x.createLinearGradient(lx, ly, rx, ry);
  lg.addColorStop(0, 'rgba(255,255,255,0.06)');
  lg.addColorStop(1, 'rgba(0,0,0,0.12)');
  x.fillStyle = lg;
  x.fillRect(0, 0, canvas.width, canvas.height);
  x.globalCompositeOperation = 'source-over';
  return canvas;
}

if (import.meta.env.DEV) {
  // 서류 아래 끝·실루엣 검사(대표 seed 몇 개). 위반이 있으면 개발 중에 바로 보인다
  const bad = ['netflix', 'airbnb-nyc', 'online-retail', 'nyc-congestion-pricing', 0, 1, 2, 3, 4, 5, 6, 7].reduce<number>((n, s) => n + checkLayout(arrange(s)), 0);
  if (bad) console.error(`coverArt: 폴더 밖으로 나간 서류 모서리 ${bad}개`);
}
