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
  // 상자 7개: 0~4는 건물(2가 가운데 타워), 5~6은 타워 위 계단식 setback 크라운. y0은 base 위 시작 높이, z는 앞뒤 위치(옆 건물은 뒤로)
  // cols는 창문 열 수, floor는 층 높이, lit은 켜진 창 비율, wall은 옆면 가시도. 모든 가시도는 1 이하(1 초과 강조는 전구 전용)
  building: {
    x: [-1.6, -0.9, 0.1, 1.05, 1.75, 0.1, 0.1],
    w: [0.9, 0.75, 1.15, 0.8, 0.95, 0.83, 0.48],
    h: [1.3, 2.0, 2.7, 2.15, 1.2, 0.34, 0.24],
    y0: [0, 0, 0, 0, 0, 2.7, 3.04],
    z: [-0.4, -0.15, 0.15, -0.15, -0.4, 0.15, 0.15],
    cols: [7, 6, 9, 6, 8, 7, 4],
    depth: 0.6,
    base: -1.55,
    floor: 0.14,
    lit: 0.4,
    wall: 0.18,
    antenna: 0.45,
    lobbyW: 0.42,
    lobbyH: 0.26,
    plazaX0: -2.4,
    plazaX1: 2.6,
    plazaFront: 1.0,
    plazaBack: -0.9,
  },
  // x0에서 x1로 흐르며 한 점으로 모인다. speed는 초당 진행 비율, hide는 래핑된 점이 왼쪽으로 돌아가는 동안 숨기는 시간(초)
  dataFlow: { count: 7, x0: -4.5, x1: 2.4, spread: 2.8, depth: 1.2, thickness: 0.12, wave: 0.12, speedMin: 0.06, speedMax: 0.11, hide: 1.5 },
  // 막대 높이는 장식용 오름세(실제 수치 아님). gap은 막대 사이 빈 비율, fill은 막대 면의 가시도, trendLift는 추세선이 막대 위로 뜨는 높이
  bars: { count: 8, width: 3.6, height: 2.6, base: -1.3, depth: 0.25, gap: 0.45, fill: 0.5, trendLift: 0.35 },
  // cut은 유리구가 목과 만나는 높이(반지름 비율), glass는 유리 가시도, filamentGlow는 1보다 크면 강조(점 확대 + insight 색)
  bulb: { radius: 1.05, y: 0.55, cut: 0.81, neck: 0.55, baseRadius: 0.42, baseHeight: 0.55, turns: 4, glass: 0.6, filamentWidth: 0.56, coils: 5, filamentGlow: 1.8 },
  band: { width: 11, amp: 0.45, thickness: 0.5, depth: 1.2, freq: 0.9, speed: 0.3 },

  // 섹션 s0..s5가 쓰는 shape id. 이웃한 두 섹션 사이를 sec로 보간한다.
  // s0은 밝은 히어로에 가려져 있어서 s1과 같은 building을 쓴다(스크롤하면 이미 완성된 건물이 보인다). ring(0)은 현재 쓰지 않는다
  sectionShapes: [1, 1, 2, 3, 4, 5],
  sectionNoise: [0.25, 0.25, 0.7, 0.25, 0.3, 1], // 섹션별 noiseAmp 배율. 직선이 읽혀야 하는 도형(건물, 막대, 전구)은 낮게
  insightSection: 4, // 이 섹션 근처에서만 점 색이 --insight로 바뀐다
  dimAtProjects: 0.8, // 마지막 섹션(프로젝트)에서 점의 알파 배율. 크기에는 제곱근을 곱한다
  outline: { 512: 0.18, 256: 0.28, 128: 0.45 }, // building과 bars에서 윤곽선에 쓰는 점 비율. 점이 적은 tier일수록 윤곽 위주

  // 3D 책 줄 (S5). 길이 단위는 책 scene의 월드 유닛
  blankBooks: 8, // 캐러셀 고리에 섞는 장식용 빈 책 수. 0이면 실제 프로젝트 책만
  ghost: { color: '#e6edf7', opacity: 0.14, line: 0.3, hinge: 0.08 }, // 장식 책: 반투명 면, 윤곽선 불투명도, 경첩선의 책등 쪽 거리
  books: {
    size: [1, 1.5, 0.2], // 폭, 높이, 두께(기준)
    radius: 0.02, // 모서리 둥글기
    heightJitter: 0.08, // 책마다 높이 ±8%
    thickness: [0.16, 0.26], // 책마다 두께 범위
    appear: [4.2, 5], // 이 sec 구간에서 아래에서 올라온다
    stagger: 0.6, // 등장 순서 차이(0이면 동시에)
    rise: 4.5, // 등장 전 숨는 깊이(아래쪽)
    y: -0.25, // 줄의 세로 위치
    spacing: 0.52, // 책 사이 간격
    spacingMobile: 0.95,
    yaw: 0.96, // 기본 자세: 책장을 비스듬히 본 각도(rad, 약 55°). 책등과 표지 일부가 보인다
    yawMobile: 0.45, // 모바일은 표지가 더 보이게
    blankMobile: 4, // 모바일 장식 책 상한(루프가 보이게)
    mobileVisible: 3.3, // 모바일에서 화면 폭에 들어오는 책 수
    centerTurn: 0.55, // 가운데 슬롯 책이 정면 쪽으로 도는 비율(표지가 읽히게)
    centerPush: 0.52, // 가운데 슬롯 책이 앞으로 나오는 거리(하한: 책 두께 + 이웃 두께 = 2 × 최대 두께)
    spread: 0.8, // 가운데 주변 가로 벌림: x = bx + spread × tanh(bx / spacing). 앞으로 나온 책이 비스듬한 이웃과 교차하지 않게
    spreadMobile: 0.6,
    edgeFade: 1.4, // 고리 끝에서 작아지며 사라지는 구간(책 간격 배수)
    edgeSink: 0.9, // 사라지며 가라앉는 깊이
    drift: 0.12, // 자동 드리프트 속도(월드/초)
    driftDelay: 3000, // 마지막 입력 뒤 이만큼(ms) 지나야 드리프트
    friction: 4, // 드래그를 놓은 뒤 관성 감쇠(1/s)
    inertiaStop: 0.15, // 관성이 이 속도 아래로 떨어지면 슬롯 정렬
    snapSpring: 60, // 슬롯 정렬 스프링(임계감쇠)
    spring: 70, // 책 스프링 강도
    damping: 12,
    waveRadius: 1.1, // 포인터 파도의 폭
    waveLift: 0.2,
    waveYaw: 0.18,
    hoverLift: 0.22, // 호버한 책: 들림, 카메라 쪽으로 나옴, 정면에 가깝게 회전
    hoverPush: 1.1, // 하한: 가운데 책 z + 2 × 최대 두께
    hoverYaw: 0.14,
    pickPush: 3.2, // 클릭 전환: 화면 중앙으로 나오며 커진다
    pickScale: 1.35,
    pickMs: 600,
    fov: 32, // 책 전용 카메라
    distance: 6.6, // 최소 카메라 거리. 줄이 화면 폭을 넘으면 더 물러난다
    cameraY: 0.75,
    fitMargin: 1.08,
  },

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
    { pos: [-0.6, 1.3, 7.6], look: [0, 0.3, 0], shift: 1.75, drift: 0.4 }, // s0: 가려진 동안. s1로 가며 카메라만 다가간다
    { pos: [1.3, 0.6, 6.9], look: [0, 0.3, 0], shift: 1.75, drift: 0.4 }, // building: 약간 비스듬히, 천천히
    { pos: [0, 0, 5.2], look: [0, 0, 0], shift: 0.6, drift: 0 },
    { pos: [0.4, 0.2, 5.4], look: [0, 0, 0], shift: 1.3, drift: 0 },
    { pos: [0, 0.5, 5], look: [0, 0.05, 0], shift: 1.5, drift: 0 },
    { pos: [0, -0.95, 5], look: [0, -0.95, 0], shift: 0, drift: 0 }, // s5: 띠가 책 줄 위쪽(책 뒤와 그 위)을 지나게 시선을 내린다
  ],
  driftSpeed: 0.15, // drift의 각속도(rad/s)
  fitDistance: 5, // 좁은 화면 보정의 기준 카메라 거리
  fitMargin: 1.3, // 좁은 화면에서 도형이 잘리지 않게 뒤로 물러나는 여유
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
