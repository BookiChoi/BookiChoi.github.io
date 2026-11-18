import { CanvasTexture, SRGBColorSpace } from 'three';
import { drawCover, drawSpine, type BookData, type Fonts } from './coverArt';

// 표지 그림(coverArt.ts, 순수 2D)을 three 텍스처로 감싼다. 그리기 코드는 홈의 책과 상세 페이지 표지가 같은 것을 쓴다.
export { isTodo, shortName, themeOf, type BookData } from './coverArt';

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 볼 때 뭉개지지 않게
  return t;
}
export const makeCover = (book: BookData, fonts: Fonts) => texture(drawCover(book, fonts));
export const makeSpine = (book: BookData, fonts: Fonts) => texture(drawSpine(book, fonts));
