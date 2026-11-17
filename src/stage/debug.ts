/** ?debug가 있을 때만 디버그 패널을 쓴다 */
export const DEBUG = new URLSearchParams(location.search).has('debug');
const LINES = ['ink', 'books']; // 스테이지 본문 아래에 한 줄씩 붙는 추가 정보

/** ?debug가 있을 때만 좌하단 패널(상태 텍스트 + 추가 줄 + 타입 프리셋 전환 링크)을 만든다. 없으면 DOM을 만들지 않는다. */
export function createDebug(): ((text: string) => void) | null {
  if (!DEBUG) return null;
  const params = new URLSearchParams(location.search);
  const el = document.createElement('div');
  el.id = 'stage-debug';
  const pre = document.createElement('pre');
  el.append(pre);
  for (const key of LINES) {
    const line = document.createElement('pre');
    line.id = `stage-debug-${key}`;
    el.append(line);
  }
  const nav = document.createElement('p');
  nav.append('type');
  for (const type of ['a', 'b', 'c']) {
    const a = document.createElement('a');
    params.set('type', type);
    a.href = `?${params}`;
    a.textContent = type;
    if (document.documentElement.dataset.type === type) a.setAttribute('aria-current', 'true');
    nav.append(' ', a);
  }
  el.append(nav);
  document.body.append(el);
  return (text) => {
    pre.textContent = text;
  };
}

/** 추가 정보 한 줄(잉크 블롭 수, 책 상태). 패널이 없으면 아무 일도 하지 않는다. */
export function debugLine(key: string, text: string): void {
  const el = DEBUG ? document.getElementById(`stage-debug-${key}`) : null;
  if (el) el.textContent = text;
}
