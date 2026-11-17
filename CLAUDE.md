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
- `src/components/SectionNav.astro`: 우측 섹션 인디케이터(점 6개). IntersectionObserver(화면 세로 중앙선 기준)로 링크의 `aria-current`와 현재 섹션의 `data-active="true"`를 갱신, 클릭은 `scrollIntoView`. 인라인 스크립트가 `<html class="js-sections">`를 붙인다. 스테이지와 독립.
- `src/stage/index.ts`: 지원 검사, 렌더러/카메라, rAF 루프, tier 하향, resize/visibility/context lost, 정리. 첫 프레임에 `stage:ready` 이벤트. sec에서 shape 쌍/보간값/dim/insight/noise 배율을 구하고 `PARAMS.cameraKeys`(위치, 시선, `shift`, `drift`)를 같은 값으로 보간한다. `shift`는 가로가 넓은 화면에서 도형을 오른쪽으로 옮긴다(글이 왼쪽). 렌더는 `autoClear` 없이 pass 2개: 점 구름 → (책이 보일 때만) 깊이만 지우고 책 scene.
- `src/stage/params.ts`: 튜닝 파라미터 `PARAMS`(한 객체: shape 치수, `sectionShapes`, `sectionNoise`, `cameraKeys`, `dimAtProjects`, `outline`(tier별 윤곽 비율), `introDuration` 등). shape 치수는 GLSL 상수로 구워진다(`PARAMS.building.depth` → `building_depth`).
- `src/stage/particles.ts`: GPUComputationRenderer(위치/속도), `THREE.Points` 1개.
- `src/stage/shaders.ts`: GLSL. 맨 위 `RATIOS`가 shape 안 부위별 점 분배 비율. shape는 `SHAPES` 배열에 추가(인덱스가 shape id)하고 `vec4(위치, w)`를 돌려준다: w 0..1은 가시도, 1 초과는 강조(점 확대 + insight 색). 현재 0 ring, 1 building, 2 dataFlow, 3 bars, 4 bulb, 5 band (이름 → Business → Data → Analysis → Insight → Projects). 섹션 i는 `sectionShapes[i]`를 쓰고, origin = mix(shape[i], shape[i+1], smoothstep(frac(sec)))(`uShapeA`, `uShapeB`, `uMix`, 점당 shape 호출 2번). w는 속도 텍스처 w 채널에 실린다. 마지막 섹션에서는 `uDim`으로 알파(×dim)와 크기(×√dim)를 낮추고, `uInsight`(sec가 4 근처일 때 1)로 점 색을 accent → `--insight`로 섞는다.
- `src/stage/scroll.ts`: 네이티브 스크롤 → `--sec`(연속 섹션 인덱스 0..5), `--p`(전체 0..1), `--p-sN`(섹션 N 가시 정도 = clamp(1 - |sec - N|)). 스테이지 루프가 돌 때만 갱신되므로 이 변수를 쓰는 CSS는 `var(--p-s1, 1)`처럼 기본값을 둔다.
- `src/stage/tiers.ts`: 512/256/128, 모바일 판정, sessionStorage `stage-tier`(하향이 확정된 때만 저장), FPS 이동평균(디버그 표시용). 하향 판정(`createDownshiftGate`): 2초 윈도우 평균 FPS가 45 미만인 윈도우가 연속 2회일 때만 한 단계 내린다. 탭 복귀와 tier 교체 직후 첫 윈도우는 판정에서 뺀다.
- `src/stage/debug.ts`: `?debug`일 때만 패널 생성(상태, shape 쌍과 `uMix`, `t_ready`, 타입 a/b/c 전환 링크). `debugLine('ink' | 'books', text)`로 잉크 블롭 수와 책 상태를 한 줄씩 붙인다.
- 상태(`<html>`): `stage-ready`(첫 프레임 뒤 캔버스 표시), `no-webgl`(캔버스 숨김, 정적 배경), `intro-wait` → `intro-go`(이름 글자 등장: `stage:ready` 또는 600ms 중 먼저), `js-sections`, `data-type`.
- 스냅: 홈의 `main[data-snap]`이 있을 때만 `html`에 `scroll-snap-type: y mandatory`. `s0`..`s4`는 정확히 100svh + `scroll-snap-stop: always`, `s5`는 min-height 100svh. 상세 페이지에는 걸지 않는다.
- 섹션 텍스트 등장(시간 기반): 기본은 항상 표시. `html.js-sections`일 때만 `.reveal`을 숨기고, `[data-active]` 섹션에서 `--i` 순서로 0.7s 등장(지연 `--i * 90ms + 120ms`), 비활성은 0.3s에 사라진다. reduced-motion에서는 규칙을 적용하지 않는다. S0 이름 연출은 별개.
- 프로젝트 섹션(`s5`)과 목록 컨테이너에는 배경을 두지 않는다(같은 캔버스에 그려질 3D 책과 점이 보여야 함). 글자는 `text-shadow`로 받치고, 비네트는 `--p-s5`로 약하게 한다.
- 타입 프리셋: `<html data-type="a|b|c">`(기본 c, CSS 기본값도 c, `?type=` 쿼리 우선). `--font-display` 등은 tokens.css, 폰트 CSS(Fraunces/Outfit/Newsreader)는 홈 `index.astro`에서만 import. 한글 문장/라벨은 Pretendard. 안 고른 프리셋 정리는 다음 단계.
- 본문 `--font-body`는 Pretendard 우선(기존 Geist에서 변경): 한글 가독성과 홈/상세 페이지 일관성 때문. Geist 패키지와 Base.astro의 import는 남아 있지만 쓰이지 않는다.
- 색은 tokens.css의 `--bg`, `--text`, `--accent`, `--insight`를 읽어 쓴다. `--insight`(따뜻한 노랑)는 인사이트 순간(s4의 점과 라벨)에만 쓴다. 스타일은 `src/styles/stage.css`.
- 홈 섹션 id: `s0` 이름 / `s1` Business / `s2` Data / `s3` Analysis / `s4` Insight / `s5` Projects. `#projects` 목록은 `s5` 안에 있다. 섹션 문장은 전부 i18n(`TODO: 내 확인 필요`). `s0`은 밝은 히어로에 가려져 있어 점 구름은 `s1`과 같은 building을 쓰고 카메라만 움직인다(ring shape는 코드에 남아 있지만 현재 쓰지 않는다). building은 도시 스카이라인: 상자 7개(건물 5 + 타워 계단식 크라운 2, `PARAMS.building`의 길이 7 배열 → GLSL `const float[7]`), 안테나, 플라자 지상선, 로비 입구, 정면은 창문 칸 안에만 점을 두고 창문마다 밝기를 달리한다(가시도 1 이하만).
- 첫 화면(S0) Hover Ink: `#s0`는 불투명한 밝은 배경(`--hero-bg`)으로 고정 캔버스를 가리고, 이름은 화면 폭을 채우는 검정 글자(`--hero-fg`, 굵기 650, 가로 화면 한 줄 / 세로 화면 두 줄, CSS만으로 맞춤). 이 두 토큰만 바꾸면 어두운 버전이 된다. 레이어(아래 → 위): `#s0` 배경 → 잉크 캔버스(`.hero-ink`, z-index 0, pointer-events none) → h1과 SCROLL 힌트(z-index 1). 잉크는 글자를 덮지 않는다. 잉크(`src/stage/ink.ts`)는 붓 획 방식: 포인터 궤적 점(최대 120개 링 버퍼)을 매 프레임 지운 뒤 중점을 잇는 곡선으로 긋고, 폭은 `min(70px, 5vw)` × 속도 비율 × 수명 taper(약 2초) × 길이 taper. 길이 상한으로 잉크 면적이 화면의 약 25%를 넘지 않는다. 겹은 그림자 → 본체 → 얇은 하이라이트 3번, 전부 불투명 색이라 줄무늬/원 무늬가 생기지 않는다(획 안쪽은 butt 끝으로 잇고 양 끝만 원으로 막음). 팔레트와 상수는 `ink.ts` 상단. 자동 스윕은 이름 등장 직후 이름 위 S자 획 1번, 이후 약 14초 간격. reduced-motion과 JS 꺼짐에서는 잉크 없이 밝은 배경 + 검정 이름만 보인다. S0가 보일 때만 갱신하고 그릴 것이 없으면 rAF를 멈춘다.
- 헤더와 인디케이터는 밝은 S0와 어두운 섹션 양쪽에 걸치므로 흰색 + `mix-blend-mode: difference`를 쓴다.
- 점 이동 속도(`params.ts`): `spring` 7.5, `damping` 5.5(임계감쇠 근처), `secSmooth` 14(스크롤 sec 추종), 이에 맞춰 `noiseAmp` 0.25, `pointerForce` 15. 스프링을 올리면 노이즈/포인터 힘도 같은 배율로 올려야 흔들림 크기가 유지된다.
- 3D 책 캐러셀(`src/stage/books.ts`, `src/stage/covers.ts`): S5에서 같은 렌더러의 두 번째 pass로 그린다. 책 전용 카메라를 쓰고 파티클 `cameraKeys`와 분리. `index.astro`가 현재 언어의 프로젝트를 `<script type="application/json" id="books-data">`로 내보내고 `books.ts`가 읽는다. 실제 프로젝트 책 + 장식용 빈 책(`PARAMS.blankBooks`, 모바일은 최대 4)이 무한 고리로 돈다: 책 i의 x = wrap(i × spacing − 가운데 + offset). x는 스프링을 거치지 않고, 고리 끝에서는 스프링 밖에서 크기를 0으로 줄이며 가라앉혀 래핑이 보이지 않는다. 입력: 포인터 드래그(관성 → 가장 가까운 슬롯 정렬), 가로 휠/트랙패드/shift+휠, 좌우 방향키(S5 활성 시), 이전/다음 버튼(`.book-prev`/`.book-next`, i18n `prev`/`next`), 모바일 가로 스와이프(`#s5`에 `touch-action: pan-y`), 느린 자동 드리프트(S5 도착 뒤, 호버·드래그·포커스·전환 중에는 정지). 6px 넘게 움직이면 드래그로 보고 클릭 전환을 하지 않는다. 가운데 슬롯 책은 정면 쪽으로 돌아 표지가 보인다. 호버(정면 회전 + HTML 툴팁 `#book-tip`), 클릭(약 0.6초 전환 뒤 `/[lang]/projects/[slug]/`, 모바일은 탭 즉시 이동). 치수와 움직임 값은 `PARAMS.books`. 모서리는 three 내장 `RoundedBoxGeometry`, 책마다 높이 ±8%·두께 0.16~0.26.
- 책 표지 정책(`covers.ts`): 실제 로고와 상표 도형은 그리지 않는다. slug별 테마 테이블(브랜드 색 + 데이터 모티프: netflix 필름 스트립·평점 막대, airbnb-nyc 지도 격자·가격 히트맵 점, online-retail 영수증·바코드, google-play 앱 아이콘 격자·별점 히스토그램, 그 외는 coverHue 폴백)로 "그 회사 느낌"만 낸다. 모티프는 순수 도형이고 숫자·라벨·가짜 수치를 넣지 않는다. 앞표지에는 제목이 없고 하단 mono 순번만, 책등에만 짧은 세로 이름(제목 끝 괄호 꼬리는 표시용으로만 뗀다). `TODO`로 시작하는 값은 그리지 않는다. 장식 책은 글자 없는 추상 표지(줄무늬/점/격자/물결).
- 책의 접근성/폴백: `#projects`의 HTML 링크 목록이 원본이다. 책이 준비되면 `html.books-on`이 붙고 그때만 `.project-list`를 시각적으로 숨긴다(포커스 가능). 숨긴 링크에 포커스가 가면 대응하는 책이 호버 상태가 된다. WebGL 없음, reduced-motion, JS 꺼짐, 책 생성 실패, context lost에서는 `books-on`이 없어 목록이 그대로 보인다. 렌더러 안티에일리어싱은 책 모서리용으로 데스크톱에서만 켠다.
