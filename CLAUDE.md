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
- 의존성은 astro, typescript, 폰트 패키지만. three/gsap/lenis는 이번 단계에서 설치하지 않는다.

## 다음 단계 제약 (기록만, 아직 구현하지 않음)
- WebGL 캔버스 1개, 렌더러 1개.
- 이름과 문장은 HTML 텍스트로 둔다.
- 상세 페이지에는 WebGL 없음.
- prefers-reduced-motion / WebGL 실패 / JS 없음이면 HTML 폴백(#projects 목록).
- 파티클 tier 128² / 256² / 512²를 자동으로 하향.
