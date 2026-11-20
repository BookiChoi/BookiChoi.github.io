import { CanvasTexture, EquirectangularReflectionMapping, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { canvas2d, rng, trace, type Pt } from './coverArt';

// 폴더 그림(coverArt.ts, 순수 2D)을 three 텍스처로 감싸고, 3D에서만 쓰는 공유 맵(종이 결 법선·거칠기, 그림자, 환경광)을 만든다.
export { arrange, cardCanvas, drawCover, isTodo, LAYOUT, panelCanvas, sheetAtlas, trace, type BookData, type Placement } from './coverArt';

/** canvas → 텍스처. GPU에 올린 뒤에는 CPU 쪽 canvas를 0×0으로 줄여 메모리를 돌려받는다(다시 올릴 일이 없다) */
export function texture(canvas: HTMLCanvasElement, opts: { linear?: boolean; repeat?: number } = {}): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = opts.linear ? NoColorSpace : SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 볼 때 뭉개지지 않게
  if (opts.repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(opts.repeat, opts.repeat);
  }
  t.onUpdate = () => {
    t.onUpdate = null;
    canvas.width = canvas.height = 0;
  };
  return t;
}

/**
 * 반복 가능한 종이 결 높이(주기 격자 값 노이즈, 저주파 + 고주파 + 섬유 점) → 법선 맵과 거칠기 맵.
 * grain이면 가로로 늘인 카드스톡 결. 크기 n은 2의 거듭제곱(반복 + mipmap).
 * pause: 덩어리(옥타브, 섬유 점, 법선 계산 절반) 사이에 쉬는 함수. 긴 작업 하나를 15~25ms 덩어리로 나눈다(결과는 같다)
 */
export async function paperMaps(kind: 'fiber' | 'grain', n = 512, pause: () => Promise<unknown> = async () => {}): Promise<{ normal: HTMLCanvasElement; rough: HTMLCanvasElement }> {
  const rand = rng(`maps:${kind}`);
  const H = new Float32Array(n * n);
  const octave = (px: number, py: number, amp: number) => {
    const grid = Float32Array.from({ length: px * py }, () => rand());
    for (let y = 0; y < n; y++) {
      const gy = (y / n) * py;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < n; x++) {
        const gx = (x / n) * px;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[(y0 % py) * px + (x0 % px)];
        const b = grid[(y0 % py) * px + ((x0 + 1) % px)];
        const c = grid[((y0 + 1) % py) * px + (x0 % px)];
        const d = grid[((y0 + 1) % py) * px + ((x0 + 1) % px)];
        H[y * n + x] += amp * (a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy);
      }
    }
  };
  const [o1, o2] = kind === 'grain' ? [[8, 64, 0.35], [32, 256, 0.45]] : [[8, 8, 0.35], [64, 64, 0.35]];
  octave(o1[0], o1[1], o1[2]);
  await pause();
  octave(o2[0], o2[1], o2[2]);
  await pause();
  for (let i = 0; i < n * n; i++) H[i] += rand() * (kind === 'grain' ? 0.12 : 0.3); // 섬유 점
  const [normal, nx] = canvas2d(n, n);
  const [rough, rx] = canvas2d(n, n);
  const ni = nx.createImageData(n, n);
  const ri = rx.createImageData(n, n);
  const at = (x: number, y: number) => H[((y + n) % n) * n + ((x + n) % n)];
  const k = kind === 'grain' ? 2.2 : 3;
  for (let y = 0; y < n; y++) {
    if (y === n / 2) await pause();
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      ni.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      ni.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255; // canvas y는 아래, 텍스처 v는 위
      ni.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
      const r = 200 + (at(x, y) - 0.6) * 60; // 거칠기 약 0.7~0.95(G 채널)
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = r;
      ri.data[i + 3] = 255;
    }
  }
  nx.putImageData(ni, 0, 0);
  rx.putImageData(ri, 0, 0);
  return { normal, rough };
}

/** 흐린 사각형(접촉 그림자 면): 가운데 불투명, 가장자리 margin 비율에서 0으로. 검정 + alpha */
export function blurRect(margin = 0.12, n = 256): HTMLCanvasElement {
  const [c, x] = canvas2d(n, n);
  const m = margin * n;
  x.shadowColor = 'rgba(0,0,0,1)';
  x.shadowBlur = m * 0.9;
  x.shadowOffsetX = n * 4; // 사각형은 화면 밖에 그리고 그림자만 남긴다
  x.fillStyle = '#000';
  x.fillRect(m - n * 4, m, n - 2 * m, n - 2 * m);
  return c;
}

/**
 * 코드로 만든 부드러운 스튜디오 환경광(equirect): 위는 밝고 아래는 어둡게, 앞 왼쪽 위와 오른쪽에 소프트박스. books.ts가 PMREM으로 바꾼다.
 * 256×128: PMREM 큐브가 64가 되어 변환 비용이 줄어든다(판·카드는 거칠어 반사가 흐리므로 512×256과 차이가 작다)
 */
export function studioEnv(): CanvasTexture {
  const w = 256;
  const h = 128;
  const [c, x] = canvas2d(w, h);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#d8d4cc');
  g.addColorStop(0.45, '#7a7670');
  g.addColorStop(0.55, '#3a3836');
  g.addColorStop(1, '#141414');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const box = (u: number, v: number, rw: number, rh: number, a: number) => {
    // ctx.filter는 Safari에서 안 되므로 그림자만 남기는 방식으로 흐린다
    x.save();
    x.shadowColor = `rgba(255,252,245,${a})`;
    x.shadowBlur = h * 0.06;
    x.shadowOffsetX = w * 2;
    x.fillStyle = '#fff';
    x.fillRect(u * w - (rw * w) / 2 - w * 2, v * h - (rh * h) / 2, rw * w, rh * h);
    x.restore();
  };
  // u 0.75 = +z(카메라 쪽 앞), u 0.5 = −x 방향 근처
  box(0.68, 0.28, 0.16, 0.2, 0.95);
  box(0.95, 0.35, 0.1, 0.25, 0.5);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** 윤곽(Pt 목록)의 흐린 그림자 텍스처: rect에 margin(단위)을 더한 범위, 1 단위당 u 픽셀. 검정 + alpha */
export function shapeShadow(pts: readonly Pt[], r: { x0: number; x1: number; y0: number; y1: number }, margin: number, blur: number, u = 256): HTMLCanvasElement {
  const [c, x] = canvas2d((r.x1 - r.x0 + 2 * margin) * u, (r.y1 - r.y0 + 2 * margin) * u);
  const off = c.width * 4;
  x.shadowColor = 'rgba(0,0,0,1)';
  x.shadowBlur = blur * u;
  x.shadowOffsetX = off; // 윤곽은 화면 밖에 그리고 그림자만 남긴다
  x.setTransform(u, 0, 0, -u, (margin - r.x0) * u - off, (r.y1 + margin) * u);
  const p = new Path2D();
  trace(p, pts);
  p.closePath();
  x.fillStyle = '#000';
  x.fill(p);
  return c;
}
