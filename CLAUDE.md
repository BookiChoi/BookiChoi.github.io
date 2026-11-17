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
- `src/components/SectionNav.astro`: 우측 섹션 인디케이터(점 5개). IntersectionObserver(화면 세로 중앙선 기준)로 링크의 `aria-current`와 현재 섹션의 `data-active="true"`를 갱신, 클릭은 `scrollIntoView`. 인라인 스크립트가 `<html class="js-sections">`를 붙인다. 스테이지와 독립.
- `src/stage/index.ts`: 지원 검사, 렌더러/카메라, rAF 루프, tier 하향, resize/visibility/context lost, 정리. 첫 프레임에 `stage:ready` 이벤트. sec에서 shape 쌍/보간값/dim을 구하고 `PARAMS.cameraKeys`를 같은 값으로 보간한다.
- `src/stage/particles.ts`: 튜닝 파라미터 `PARAMS`(한 객체: shape별 값, `sectionShapes`, `cameraKeys`, `dimAtProjects`, `introDuration` 등), GPUComputationRenderer(위치/속도), `THREE.Points` 1개.
- `src/stage/shaders.ts`: GLSL. shape는 `SHAPES` 배열에 추가(인덱스가 shape id)하고 `vec4(위치, 가시도)`를 돌려준다. 현재 0 ring, 1 sphere, 2 dataSurface, 3 risingStreams, 4 band. 섹션 i는 `sectionShapes[i]`를 쓰고, origin = mix(shape[i], shape[i+1], smoothstep(frac(sec)))(`uShapeA`, `uShapeB`, `uMix`, 점당 shape 호출 2번). 가시도는 속도 텍스처 w 채널에 실려 렌더 알파에 곱해진다(기둥 래핑 숨김용). 마지막 섹션에서는 `uDim`으로 알파(×dim)와 크기(×√dim)를 낮춘다.
- `src/stage/scroll.ts`: 네이티브 스크롤 → `--sec`(연속 섹션 인덱스 0..4), `--p`(전체 0..1), `--p-sN`(섹션 N 가시 정도 = clamp(1 - |sec - N|)). 스테이지 루프가 돌 때만 갱신되므로 이 변수를 쓰는 CSS는 `var(--p-s1, 1)`처럼 기본값을 둔다.
- `src/stage/tiers.ts`: 512/256/128, 모바일 판정, FPS 이동평균, sessionStorage `stage-tier`.
- `src/stage/debug.ts`: `?debug`일 때만 패널 생성(상태, shape 쌍과 `uMix`, `t_ready`, 타입 a/b/c 전환 링크).
- 상태(`<html>`): `stage-ready`(첫 프레임 뒤 캔버스 표시), `no-webgl`(캔버스 숨김, 정적 배경), `intro-wait` → `intro-go`(이름 글자 등장: `stage:ready` 또는 600ms 중 먼저), `js-sections`, `data-type`.
- 스냅: 홈의 `main[data-snap]`이 있을 때만 `html`에 `scroll-snap-type: y mandatory`. `s0`..`s3`은 정확히 100svh + `scroll-snap-stop: always`, `s4`는 min-height 100svh. 상세 페이지에는 걸지 않는다.
- 섹션 텍스트 등장(시간 기반): 기본은 항상 표시. `html.js-sections`일 때만 `.reveal`을 숨기고, `[data-active]` 섹션에서 `--i` 순서로 0.7s 등장(지연 `--i * 90ms + 120ms`), 비활성은 0.3s에 사라진다. reduced-motion에서는 규칙을 적용하지 않는다. S0 이름 연출은 별개.
- 프로젝트 섹션(`s4`)과 목록 컨테이너에는 배경을 두지 않는다(같은 캔버스에 그려질 3D 책과 점이 보여야 함). 글자는 `text-shadow`로 받치고, 비네트는 `--p-s4`로 약하게 한다.
- 타입 프리셋: `<html data-type="a|b|c">`(기본 c, CSS 기본값도 c, `?type=` 쿼리 우선). `--font-display` 등은 tokens.css, 폰트 CSS(Fraunces/Outfit/Newsreader)는 홈 `index.astro`에서만 import. 한글 문장/라벨은 Pretendard. 안 고른 프리셋 정리는 다음 단계.
- 본문 `--font-body`는 Pretendard 우선(기존 Geist에서 변경): 한글 가독성과 홈/상세 페이지 일관성 때문. Geist 패키지와 Base.astro의 import는 남아 있지만 쓰이지 않는다.
- 색은 tokens.css의 `--bg`, `--text`, `--accent`를 읽어 쓴다. 스타일은 `src/styles/stage.css`.
- 홈 섹션 id: `s0`..`s4`. `#projects` 목록은 `s4` 안에 있다.
