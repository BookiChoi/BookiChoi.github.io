/** ?debug가 있을 때만 좌하단 패널(상태 텍스트 + 타입 프리셋 전환 링크)을 만든다. 없으면 DOM을 만들지 않는다. */
export function createDebug(): ((text: string) => void) | null {
  const params = new URLSearchParams(location.search);
  if (!params.has('debug')) return null;
  const el = document.createElement('div');
  el.id = 'stage-debug';
  const pre = document.createElement('pre');
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
  el.append(pre, nav);
  document.body.append(el);
  return (text) => {
    pre.textContent = text;
  };
}
