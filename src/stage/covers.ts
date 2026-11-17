import { CanvasTexture, SRGBColorSpace } from 'three';

// 책 표지와 책등 텍스처를 2D 캔버스로 만든다. 외부 이미지는 쓰지 않는다.
export interface BookData {
  slug: string;
  title: string;
  summary: string;
  hue: number;
  order: number;
  href: string;
}

const W = 512;
const H = 768;
const SPINE_W = 128;
const INK = '#f2f0ea';

/** 아직 확정되지 않은 값("TODO: 내 확인 필요")은 표지와 툴팁에 그리지 않는다 */
export const isTodo = (s: string) => s.trimStart().startsWith('TODO');
export const bookColor = (hue: number, light: number) => `hsl(${hue} 42% ${light}%)`;
const orderLabel = (n: number) => String(n).padStart(2, '0');

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 볼 때 글자가 뭉개지지 않게
  return t;
}
function sheet(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [canvas, ctx];
}

/** 앞표지: hue 기반 어두운 배경 + 약한 점 패턴 + 큰 제목 + 하단 순번 */
export function makeCover(book: BookData, fonts: { display: string; mono: string }): CanvasTexture {
  const [canvas, x] = sheet(W, H);
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, bookColor(book.hue, 22));
  bg.addColorStop(1, bookColor(book.hue, 9));
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);

  x.fillStyle = 'rgba(255, 255, 255, 0.07)';
  for (let row = 0; row * 24 < H; row++) {
    for (let col = 0; col * 24 < W; col++) {
      x.beginPath();
      x.arc(col * 24 + (row % 2) * 12 + 6, row * 24 + 6, 1.5, 0, Math.PI * 2);
      x.fill();
    }
  }

  x.fillStyle = INK;
  x.textBaseline = 'alphabetic';
  if (!isTodo(book.title)) {
    // 단어 단위 줄바꿈
    x.font = `500 68px ${fonts.display}`;
    const max = W - 96;
    let line = '';
    let y = 150;
    for (const word of book.title.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && x.measureText(next).width > max) {
        x.fillText(line, 48, y);
        y += 76;
        line = word;
      } else line = next;
    }
    x.fillText(line, 48, y);
  }
  x.globalAlpha = 0.5;
  x.fillRect(48, H - 118, W - 96, 1);
  x.globalAlpha = 0.85;
  x.font = `400 30px ${fonts.mono}`;
  x.fillText(orderLabel(book.order), 48, H - 60);
  return texture(canvas);
}

/** 책등: 단색 + 세로 제목 + 순번 */
export function makeSpine(book: BookData, fonts: { display: string; mono: string }): CanvasTexture {
  const [canvas, x] = sheet(SPINE_W, H);
  x.fillStyle = bookColor(book.hue, 14);
  x.fillRect(0, 0, SPINE_W, H);
  x.fillStyle = INK;
  if (!isTodo(book.title)) {
    x.save();
    x.translate(SPINE_W / 2, 48);
    x.rotate(Math.PI / 2); // 위에서 아래로 읽는 세로 제목
    x.font = `500 44px ${fonts.display}`;
    x.textBaseline = 'middle';
    x.fillText(book.title, 0, 0, H - 190);
    x.restore();
  }
  x.globalAlpha = 0.85;
  x.font = `400 30px ${fonts.mono}`;
  x.textAlign = 'center';
  x.fillText(orderLabel(book.order), SPINE_W / 2, H - 48);
  return texture(canvas);
}
