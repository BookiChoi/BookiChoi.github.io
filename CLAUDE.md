# 레포 규칙

## 공개/내용
- 공개 레포. 이메일, 전화번호, 주소, 키, 토큰 등 개인정보 금지.
- 경력/성과/결론 문장은 내가 확인한 것만 쓴다. 확인 안 된 문장은 "TODO: 내 확인 필요"로 둔다. 내용을 지어내지 않는다.
- 설명은 한국어로.

## Git
- `git add`는 파일 경로를 명시한다. `git add -A`, `git add .` 금지. 커밋 전 `git status` 확인. push 금지.
- `assets/resume.pdf`는 건드리지 않는다.

## 에셋
- 외부 이미지/영상/폰트 CDN 핫링크 금지. 폰트는 npm 패키지로 자체 호스팅.

## 수정 범위
- 허용: package.json, package-lock.json, astro.config.mjs, tsconfig.json, .gitignore(끝에 추가만), CLAUDE.md, src/**, public/**
- 금지: index.html, 404.html, assets/**, resume-source/**, robots.txt, sitemap.xml, .claude/**, .serena/**

## 기술
- Astro, TypeScript strict, output 'static', site 'https://bookichoi.github.io', base 없음.
- 다크 단일 테마. 토큰은 src/styles/tokens.css.
- i18n: /en/, /ko/. 문자열은 src/i18n/*.json.
- 의존성은 astro, typescript, 폰트 패키지만. three/gsap/lenis 설치 금지는 A단계 한정, B단계부터 three/@types/three 허용.

## 다음 단계 제약 (기록만, 아직 구현하지 않음)
- WebGL 캔버스 1개, 렌더러 1개.
- 이름과 문장은 HTML 텍스트로 둔다.
- 상세 페이지에는 WebGL 없음.
- prefers-reduced-motion / WebGL 실패 / JS 없음이면 HTML 폴백(#projects 목록).
- 파티클 tier 128² / 256² / 512²를 자동으로 하향.

## 스테이지 구조 (B단계, 홈 전용)
- `src/components/Stage.astro`: 맨 앞 인라인 스크립트(`data-type`, 이름 등장 대기) + 고정 레이어 3겹(`.stage-bg` 정적 배경 → `<canvas id="stage">` → `.stage-vignette`). 모듈 스크립트가 파싱 직후 `import('../stage/index')`로 three 청크를 동적 로드. 빌드 때 `dist/_astro`에서 청크를 찾아 `modulepreload` 링크를 넣는다(못 찾으면 생략).
- `src/components/SectionNav.astro`: 우측 섹션 인디케이터(점 5개). IntersectionObserver로 `aria-current` 갱신, 클릭은 `scrollIntoView`. 스테이지와 독립.
- `src/stage/index.ts`: 지원 검사, 렌더러/카메라, rAF 루프, tier 하향, resize/visibility/context lost, 정리. 첫 프레임에 `stage:ready` 이벤트.
- `src/stage/particles.ts`: 튜닝 파라미터 `PARAMS`(한 객체, 입장 시간은 `introDuration`), GPUComputationRenderer(위치/속도), `THREE.Points` 1개.
- `src/stage/shaders.ts`: GLSL. shape는 `SHAPES` 배열에 추가(인덱스가 shape id). 현재 0=링, 1=구체, `uMorph`로 보간.
- `src/stage/scroll.ts`: 네이티브 스크롤 → `--sec`(연속 섹션 인덱스 0..4), `--p`(전체 0..1), `--p-sN`(섹션 N 가시 정도 = clamp(1 - |sec - N|)), morph(sec 0→1). 스테이지 루프가 돌 때만 갱신되므로 이 변수를 쓰는 CSS는 `var(--p-s1, 1)`처럼 기본값을 둔다.
- `src/stage/tiers.ts`: 512/256/128, 모바일 판정, FPS 이동평균, sessionStorage `stage-tier`.
- `src/stage/debug.ts`: `?debug`일 때만 패널 생성(상태, `t_ready`, 타입 a/b/c 전환 링크).
- 상태(`<html>`): `stage-ready`(첫 프레임 뒤 캔버스 표시), `no-webgl`(캔버스 숨김, 정적 배경), `intro-wait` → `intro-go`(이름 글자 등장: `stage:ready` 또는 600ms 중 먼저), `data-type`.
- 스냅: 홈의 `main[data-snap]`이 있을 때만 `html`에 `scroll-snap-type: y mandatory`. `s0`..`s3`은 정확히 100svh + `scroll-snap-stop: always`, `s4`는 min-height 100svh. 상세 페이지에는 걸지 않는다.
- 타입 프리셋: `<html data-type="a|b|c">`(기본 a, `?type=` 쿼리 우선). `--font-display` 등은 tokens.css, 폰트 CSS(Fraunces/Outfit/Newsreader)는 홈 `index.astro`에서만 import. 한글 문장/라벨은 Pretendard. 안 고른 프리셋 정리는 다음 단계.
- 본문 `--font-body`는 Pretendard 우선(기존 Geist에서 변경): 한글 가독성과 홈/상세 페이지 일관성 때문. Geist 패키지와 Base.astro의 import는 남아 있지만 쓰이지 않는다.
- 색은 tokens.css의 `--bg`, `--text`, `--accent`를 읽어 쓴다. 스타일은 `src/styles/stage.css`.
- 홈 섹션 id: `s0`..`s4`. `#projects` 목록은 `s4` 안에 있다.
