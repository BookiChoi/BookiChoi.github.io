// 튜닝 파라미터는 전부 여기. 길이 단위는 월드 유닛.
// shape 치수(SHAPE_DIMS에 든 항목)는 shaders.ts가 GLSL 상수로 굽는다: PARAMS.building.depth → building_depth.
// 부위별 점 분배 비율은 shaders.ts 맨 위 RATIOS에 있다.
export const PARAMS = {
  // 시뮬레이션
  spring: 7.5, // origin으로 당기는 힘 (입장이 끝난 뒤의 평소 값). 이전 3 (2.5배)
  damping: 5.5, // 속도 감쇠 (1/s). 임계감쇠 2√spring 근처로 맞춰 오버슈트를 없앤다. 이전 3
  secSmooth: 14, // 스크롤 sec가 목표를 따라가는 빠르기 (1/s). 이전 8
  introDuration: 2, // 입장: 흩어진 점이 shape로 모이는 데 걸리는 시간(초)
  noiseAmp: 0.25, // (스프링과 같은 배율로 올려 흔들림 크기 유지, 이전 0.1) curl noise 세기. 섹션별 배율은 sectionNoise
  noiseFreq: 0.9,
  noiseSpeed: 0.12,
  pointerRadius: 0.9,
  pointerForce: 15, // 이전 6 (스프링 배율에 맞춤)

  // shape 치수 (SHAPES 순서: 0 ring, 1 building, 2 dataFlow, 3 bars, 4 bulb, 5 band)
  ring: { radius: 1.4, thickness: 0.35, depth: 0.12 },
  // 타워 3개의 x 중심 / 폭 / 높이. cell은 창문 한 칸 크기, lit은 켜진 창 비율, wall은 벽과 꺼진 창의 가시도
  building: { x: [-1.15, 0, 1.15], w: [0.8, 0.95, 0.8], h: [1.9, 2.9, 2.3], depth: 0.6, base: -1.45, cell: 0.2, lit: 0.45, wall: 0.25 },
  // x0에서 x1로 흐르며 한 점으로 모인다. speed는 초당 진행 비율, hide는 래핑된 점이 왼쪽으로 돌아가는 동안 숨기는 시간(초)
  dataFlow: { count: 7, x0: -4.5, x1: 2.4, spread: 2.8, depth: 1.2, thickness: 0.12, wave: 0.12, speedMin: 0.06, speedMax: 0.11, hide: 1.5 },
  // 막대 높이는 장식용 오름세(실제 수치 아님). gap은 막대 사이 빈 비율, fill은 막대 면의 가시도, trendLift는 추세선이 막대 위로 뜨는 높이
  bars: { count: 8, width: 3.6, height: 2.6, base: -1.3, depth: 0.25, gap: 0.45, fill: 0.5, trendLift: 0.35 },
  // cut은 유리구가 목과 만나는 높이(반지름 비율), glass는 유리 가시도, filamentGlow는 1보다 크면 강조(점 확대 + insight 색)
  bulb: { radius: 1.05, y: 0.55, cut: 0.81, neck: 0.55, baseRadius: 0.42, baseHeight: 0.55, turns: 4, glass: 0.6, filamentWidth: 0.56, coils: 5, filamentGlow: 1.8 },
  band: { width: 11, amp: 0.45, thickness: 0.5, depth: 1.2, freq: 0.9, speed: 0.3 },

  sectionShapes: [0, 1, 2, 3, 4, 5], // 섹션 s0..s5가 쓰는 shape id. 이웃한 두 섹션 사이를 sec로 보간한다
  sectionNoise: [1, 0.25, 0.7, 0.25, 0.3, 1], // 섹션별 noiseAmp 배율. 직선이 읽혀야 하는 도형(건물, 막대, 전구)은 낮게
  insightSection: 4, // 이 섹션 근처에서만 점 색이 --insight로 바뀐다
  dimAtProjects: 0.8, // 마지막 섹션(프로젝트)에서 점의 알파 배율. 크기에는 제곱근을 곱한다
  outline: { 512: 0.18, 256: 0.28, 128: 0.45 }, // building과 bars에서 윤곽선에 쓰는 점 비율. 점이 적은 tier일수록 윤곽 위주

  // 입장 연출 시작 위치
  scatterMin: 3, // 화면 가장자리 근처라 첫 프레임부터 점이 보인다
  scatterMax: 5,
  scatterDepth: 2,

  // 렌더 (512 tier 기준, 낮은 tier는 자동 보정)
  pointSize: 0.01,
  alpha: 0.2,
  colorSpeed: 1.5, // 속도 → 색 혼합 비중
  colorDist: 0.2, // 중심 거리 → 색 혼합 비중

  // 카메라: 섹션별 위치/시선. sec로 보간하고 포인터 시선 이동을 그 위에 더한다.
  // shift: 가로가 넓은 화면에서 도형을 오른쪽으로 옮기는 거리(글이 왼쪽에 있어서). drift: 느린 좌우 이동 폭
  fov: 45,
  cameraKeys: [
    { pos: [0, 0, 5], look: [0, 0, 0], shift: 0, drift: 0 },
    { pos: [1.3, 0.35, 5.6], look: [0, 0, 0], shift: 1.9, drift: 0.5 }, // building: 약간 비스듬히, 천천히
    { pos: [0, 0, 5.2], look: [0, 0, 0], shift: 0.6, drift: 0 },
    { pos: [0.4, 0.2, 5.4], look: [0, 0, 0], shift: 1.3, drift: 0 },
    { pos: [0, 0.5, 5], look: [0, 0.05, 0], shift: 1.5, drift: 0 },
    { pos: [0, 0, 5], look: [0, 0, 0], shift: 0, drift: 0 },
  ],
  driftSpeed: 0.15, // drift의 각속도(rad/s)
  fitMargin: 1.3, // 좁은 화면에서 링이 잘리지 않게 뒤로 물러나는 여유
  gaze: 0.25, // 포인터에 따른 시선 이동량
};

/** GLSL 상수로 구워지는 shape 치수 묶음 (이름이 상수 접두어가 된다) */
export const SHAPE_DIMS = {
  ring: PARAMS.ring,
  building: PARAMS.building,
  dataFlow: PARAMS.dataFlow,
  bars: PARAMS.bars,
  bulb: PARAMS.bulb,
  band: PARAMS.band,
};
