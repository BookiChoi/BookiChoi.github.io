import { CanvasTexture, SRGBColorSpace } from 'three';

// 책 표지와 책등 텍스처를 2D 캔버스로 만든다. 외부 이미지는 쓰지 않는다.
// 정책: 실제 로고와 상표 도형은 그리지 않는다. 브랜드 색과 데이터 모티프(순수 도형)로 "그 회사 느낌"만 낸다.
// 모티프에는 숫자, 라벨, 가짜 수치를 넣지 않는다(하단 순번만 예외). 앞표지에는 제목을 넣지 않고 책등에만 짧은 이름을 쓴다.
export interface BookData {
  slug: string;
  title: string;
  summary: string;
  hue: number;
  order: number;
  href: string;
}
type Fonts = { display: string; mono: string };
type Ctx = CanvasRenderingContext2D;

const W = 512;
const H = 768;
const SPINE_W = 128;

/** 아직 확정되지 않은 값("TODO: 내 확인 필요")은 표지와 툴팁에 그리지 않는다 */
export const isTodo = (s: string) => s.trimStart().startsWith('TODO');
/** 표시용 짧은 이름: 제목 끝의 괄호 꼬리("(working title)" 등)를 뗀다. content 파일은 바꾸지 않는다 */
export const shortName = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '').trim();
const orderLabel = (n: number) => String(n).padStart(2, '0');

/** slug에서 만든 고정 난수: 같은 책은 매번 같은 그림이 나온다 */
function rng(seed: string | number) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function sheet(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [canvas, ctx];
}
function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 볼 때 뭉개지지 않게
  return t;
}
const gradient = (x: Ctx, a: string, b: string, w: number, h: number) => {
  const g = x.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
};
const roundRect = (x: Ctx, l: number, t: number, w: number, h: number, r: number) => {
  x.beginPath();
  x.roundRect(l, t, w, h, r);
  x.fill();
};

interface Theme {
  /** 앞표지 바탕과 모티프 */
  paint(x: Ctx, rand: () => number): void;
  spine: string;
  back: string;
  /** 순번, 책등 글자 색 */
  ink: string;
  /** 책등 위아래 띠(마감) 색. 없으면 띠 없음 */
  band?: string;
}

// slug별 표지 테마
const THEMES: Record<string, Theme> = {
  // 검정 바탕 + 붉은 계열: 필름 스트립과 평점 막대
  netflix: {
    spine: '#141414',
    back: '#0e0e0e',
    ink: '#f3e9e9',
    band: '#d81f26',
    paint(x, rand) {
      gradient(x, '#1b0b0c', '#050505', W, H);
      const left = 70;
      x.fillStyle = '#7a0d12';
      x.fillRect(left, 0, 150, H); // 필름 스트립
      x.fillStyle = '#050505';
      for (let y = 10; y < H; y += 34) {
        roundRect(x, left + 10, y, 16, 20, 4); // 양쪽 구멍
        roundRect(x, left + 124, y, 16, 20, 4);
      }
      for (let y = 18; y < H; y += 128) {
        const g = x.createLinearGradient(0, y, 0, y + 108);
        g.addColorStop(0, '#d81f26');
        g.addColorStop(1, '#3a0507');
        x.fillStyle = g;
        x.fillRect(left + 36, y, 78, 108); // 프레임
      }
      // 평점 막대(길이는 장식)
      for (let i = 0; i < 6; i++) {
        const len = 90 + rand() * 150;
        x.fillStyle = i % 2 ? '#d81f26' : '#ff4b52';
        x.globalAlpha = 0.9 - i * 0.1;
        roundRect(x, 262, 250 + i * 44, len, 22, 11);
      }
      x.globalAlpha = 1;
    },
  },
  // 코랄/핑크 그라데이션: 기울어진 지도 격자와 가격 히트맵 점
  'airbnb-nyc': {
    spine: '#e0474f',
    back: '#c93c44',
    ink: '#fff6f4',
    paint(x, rand) {
      gradient(x, '#ff7b7f', '#e33b58', W, H);
      x.save();
      x.translate(W / 2, H / 2);
      x.rotate(-0.5); // 맨해튼식 기울어진 도로
      x.strokeStyle = 'rgba(255, 255, 255, 0.34)';
      for (let i = -12; i <= 12; i++) {
        x.lineWidth = i % 4 === 0 ? 5 : 2;
        x.beginPath();
        x.moveTo(i * 44, -H);
        x.lineTo(i * 44, H);
        x.stroke();
      }
      for (let j = -24; j <= 24; j++) {
        x.lineWidth = 1.5;
        x.beginPath();
        x.moveTo(-W, j * 26);
        x.lineTo(W, j * 26);
        x.stroke();
      }
      x.restore();
      for (let i = 0; i < 46; i++) {
        const cx = 40 + rand() * (W - 80);
        const cy = 60 + rand() * (H - 220);
        const r = 10 + rand() * 34;
        const heat = rand();
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, heat > 0.55 ? 'rgba(120, 10, 40, 0.75)' : 'rgba(255, 245, 240, 0.8)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        x.fillStyle = g;
        x.beginPath();
        x.arc(cx, cy, r, 0, Math.PI * 2);
        x.fill();
      }
    },
  },
  // 따뜻한 앰버/크림: 영수증 줄과 바코드
  'online-retail': {
    spine: '#c9821f',
    back: '#b5731a',
    ink: '#2a1a07',
    band: '#f6e7c8',
    paint(x, rand) {
      gradient(x, '#f7c766', '#e39a2d', W, H);
      const l = 96;
      const r = W - 96;
      const top = 70;
      const bottom = H - 150;
      x.fillStyle = 'rgba(80, 40, 0, 0.18)';
      x.fillRect(l + 10, top + 12, r - l, bottom - top); // 그림자
      x.fillStyle = '#fdf6e8';
      x.beginPath(); // 아래가 톱니인 영수증
      x.moveTo(l, top);
      x.lineTo(r, top);
      x.lineTo(r, bottom);
      for (let px = r; px > l; px -= 20) {
        x.lineTo(px - 10, bottom + 12);
        x.lineTo(px - 20, bottom);
      }
      x.closePath();
      x.fill();
      x.fillStyle = '#6b5a45';
      for (let i = 0; i < 9; i++) {
        const y = top + 50 + i * 30;
        x.fillRect(l + 28, y, 60 + rand() * 120, 8); // 품목 줄
        x.fillRect(r - 28 - 40 - rand() * 24, y, 40, 8); // 금액 자리(글자 없음)
      }
      x.fillStyle = '#c9b89f';
      for (let px = l + 28; px < r - 28; px += 14) x.fillRect(px, top + 335, 7, 3); // 점선
      x.fillStyle = '#1d1209';
      let bx = l + 34;
      while (bx < r - 34) {
        const bw = 2 + Math.floor(rand() * 4) * 2;
        x.fillRect(bx, bottom - 130, bw, 92); // 바코드
        bx += bw + 2 + Math.floor(rand() * 3) * 2;
      }
    },
  },
  // 청록 → 초록 그라데이션: 앱 아이콘 격자와 별점 히스토그램
  'google-play': {
    spine: '#0b8a6e',
    back: '#0a7a62',
    ink: '#effff8',
    paint(x, rand) {
      gradient(x, '#14b8a6', '#22a55a', W, H);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          x.fillStyle = `rgba(255, 255, 255, ${(0.25 + rand() * 0.6).toFixed(2)})`;
          roundRect(x, 66 + col * 98, 70 + row * 98, 76, 76, 20); // 앱 아이콘 자리(도형만)
        }
      }
      for (let i = 0; i < 5; i++) {
        const y = 410 + i * 42;
        x.fillStyle = '#fff8d6';
        star(x, 82, y + 12, 12);
        x.fillStyle = 'rgba(255, 255, 255, 0.25)';
        roundRect(x, 110, y, 330, 22, 11);
        x.fillStyle = '#fff8d6';
        roundRect(x, 110, y, 330 * (0.85 - i * 0.16 + rand() * 0.06), 22, 11); // 막대 길이는 장식
      }
    },
  },
};

function star(x: Ctx, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
  x.fill();
}

// 알 수 없는 slug: coverHue 그라데이션 + 사선 줄무늬
const fallback = (hue: number): Theme => ({
  spine: `hsl(${hue} 40% 22%)`,
  back: `hsl(${hue} 40% 16%)`,
  ink: '#f2f0ea',
  paint(x) {
    gradient(x, `hsl(${hue} 45% 36%)`, `hsl(${hue} 45% 14%)`, W, H);
    x.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    x.lineWidth = 10;
    for (let i = -H; i < W + H; i += 36) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i - H, H);
      x.stroke();
    }
  },
});

export const themeOf = (book: BookData) => THEMES[book.slug] ?? fallback(book.hue);

/** 앞표지: 큰 모티프 + 하단의 작은 mono 순번 */
export function makeCover(book: BookData, fonts: Fonts): CanvasTexture {
  const theme = themeOf(book);
  const [canvas, x] = sheet(W, H);
  theme.paint(x, rng(book.slug));
  x.fillStyle = theme.ink;
  x.globalAlpha = 0.85;
  x.font = `400 26px ${fonts.mono}`;
  x.fillText(orderLabel(book.order), 40, H - 40);
  x.globalAlpha = 1;
  return texture(canvas);
}

/** 책등: 단색 + (선택) 위아래 띠 + 세로 짧은 이름 + 순번 */
export function makeSpine(book: BookData, fonts: Fonts): CanvasTexture {
  const theme = themeOf(book);
  const [canvas, x] = sheet(SPINE_W, H);
  x.fillStyle = theme.spine;
  x.fillRect(0, 0, SPINE_W, H);
  if (theme.band) {
    x.fillStyle = theme.band;
    x.fillRect(0, 22, SPINE_W, 10);
    x.fillRect(0, H - 32, SPINE_W, 10);
  }
  x.fillStyle = theme.ink;
  const name = isTodo(book.title) ? '' : shortName(book.title);
  if (name) {
    x.save();
    x.translate(SPINE_W / 2, 70);
    x.rotate(Math.PI / 2); // 위에서 아래로 읽는 세로 이름
    x.font = `500 46px ${fonts.display}`;
    x.textBaseline = 'middle';
    x.fillText(name, 0, 0, H - 200);
    x.restore();
  }
  x.globalAlpha = 0.85;
  x.font = `400 26px ${fonts.mono}`;
  x.textAlign = 'center';
  x.fillText(orderLabel(book.order), SPINE_W / 2, H - 62);
  return texture(canvas);
}
