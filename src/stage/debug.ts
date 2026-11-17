/** ?debug가 있을 때만 좌하단 패널을 만들고 텍스트 갱신 함수를 돌려준다. 없으면 DOM을 만들지 않는다. */
export function createDebug(): ((text: string) => void) | null {
  if (!new URLSearchParams(location.search).has('debug')) return null;
  const el = document.createElement('pre');
  el.id = 'stage-debug';
  document.body.append(el);
  return (text) => {
    el.textContent = text;
  };
}
