import { SHAPE_DIMS } from './params';

// --- 점 분배 비율: 각 shape 안에서 부위별로 점을 몇 %씩 쓰는지. 여기만 고치면 된다 ---
// 남는 비율은 주된 면으로 간다(building 정면, bars 막대 면, bulb 유리구).
const RATIOS = /* glsl */ `
const float BUILDING_SIDE = 0.12; // 옆면. 윤곽선은 uOutline(tier별, PARAMS.outline), 나머지가 정면
const float BARS_TREND = 0.10;    // 추세선. 막대 윤곽(윗변, 양옆)은 uOutline, 나머지가 막대 면
const float BULB_FILAMENT = 0.10; // 필라멘트(코일 70%, 지지선 30%). 과노출되면 낮춘다
const float BULB_NECK = 0.12;     // 목
const float BULB_BASE = 0.13;     // 나사 base. 나머지(약 0.65)가 유리구
`;

// PARAMS의 shape 치수를 GLSL 상수로 굽는다: { building: { depth: 0.6 } } → const float building_depth = 0.6000;
const f = (n: number) => n.toFixed(4);
const dims = Object.entries(SHAPE_DIMS)
  .flatMap(([shape, values]) =>
    Object.entries(values).map(([key, v]) =>
      typeof v === 'number'
        ? `const float ${shape}_${key} = ${f(v)};`
        : `const vec3 ${shape}_${key} = vec3(${v.map(f).join(', ')});`,
    ),
  )
  .join('\n');

// shape: 점마다 고정된 난수 s, r(각 0..1 vec3) → vec4(월드 좌표 xyz, w).
// w는 0..1이면 가시도(알파 배율), 1보다 크면 강조(알파 1 + 점 확대 + insight 색).
// 배열에 항목을 추가하면 shapeOrigin 분기가 자동으로 생긴다. 배열 인덱스가 shape id이고, 섹션별 배정은 PARAMS.sectionShapes.
export const SHAPES = [
  {
    name: 'ring',
    glsl: /* glsl */ `
vec4 shape_ring(vec3 s, vec3 r) {
  float a = s.x * 6.2831853;
  float t = s.y * 2.0 - 1.0;
  float rad = ring_radius + t * abs(t) * ring_thickness * 0.5; // 가운데가 더 촘촘
  return vec4(cos(a) * rad, sin(a) * rad, (s.z - 0.5) * ring_depth, 1.0);
}`,
  },
  {
    // 가운데가 가장 높은 타워 3개: 정면 파사드(창문 격자) + 옆면 + 윤곽선
    name: 'building',
    glsl: /* glsl */ `
vec4 shape_building(vec3 s, vec3 r) {
  vec3 area = building_w * building_h; // 타워는 정면 면적에 비례해 고른다
  float pick = s.x * (area.x + area.y + area.z);
  int k = pick < area.x ? 0 : (pick < area.x + area.y ? 1 : 2);
  float w = building_w[k];
  float h = building_h[k];
  float left = building_x[k] - 0.5 * w;
  float right = left + w;
  float front = 0.5 * building_depth;
  float y = building_base + r.y * h;
  float top = building_base + h;
  if (s.y < uOutline) {
    // 윤곽선: 지붕선(정면, 옆면)과 세로 모서리 3개
    float e = s.y / uOutline;
    if (e < 0.35) return vec4(left + r.x * w, top, front, 1.0);
    if (e < 0.5) return vec4(right, top, front - r.x * building_depth, 1.0);
    if (e < 0.68) return vec4(left, y, front, 1.0);
    if (e < 0.86) return vec4(right, y, front, 1.0);
    return vec4(right, y, -front, 1.0);
  }
  if (s.y < uOutline + BUILDING_SIDE) return vec4(right, y, front - r.x * building_depth, building_wall);
  // 정면: 창문 격자에서 켜진 창 안의 점만 밝다
  vec2 n = max(vec2(1.0), floor(vec2(w, h) / building_cell));
  vec2 g = r.xy * n;
  vec2 c = floor(g);
  vec2 q = fract(g);
  float lit = step(1.0 - building_lit, fract(sin(dot(c + float(k) * 17.0, vec2(127.1, 311.7))) * 43758.5453));
  float inWindow = step(0.2, q.x) * step(q.x, 0.8) * step(0.25, q.y) * step(q.y, 0.8);
  return vec4(left + r.x * w, y, front, mix(building_wall, 1.0, lit * inWindow));
}`,
  },
  {
    // 왼쪽에서 오른쪽으로 흐르는 점 스트림이 한 점으로 모이는 깔때기. 래핑 직후 돌아가는 동안은 가시도 0
    name: 'dataFlow',
    glsl: /* glsl */ `
vec4 shape_dataFlow(vec3 s, vec3 r) {
  float j = floor(s.x * dataFlow_count);
  float h = fract(sin(j * 91.7 + 1.3) * 43758.5453); // 줄마다 고정된 난수
  float speed = mix(dataFlow_speedMin, dataFlow_speedMax, r.x);
  float phase = fract(s.y + uTime * speed);
  float open = 1.0 - smoothstep(0.0, 1.0, phase); // 1 → 0: 오른쪽으로 갈수록 모인다
  float y0 = ((j + 0.5) / dataFlow_count - 0.5) * dataFlow_spread;
  float x = mix(dataFlow_x0, dataFlow_x1, phase);
  float y = (y0 + dataFlow_wave * sin(phase * 9.0 + j * 1.7 + uTime * 0.6)) * open
    + (r.y - 0.5) * dataFlow_thickness * (0.4 + 0.6 * open);
  float z = (h - 0.5) * dataFlow_depth * open + (r.z - 0.5) * dataFlow_thickness;
  float vis = smoothstep(dataFlow_hide, dataFlow_hide + 1.0, phase / speed) * (1.0 - smoothstep(0.92, 1.0, phase));
  return vec4(x, y, z, vis);
}`,
  },
  {
    // 점으로 된 막대(장식용 오름세)와 그 위를 지나는 추세선
    name: 'bars',
    glsl: /* glsl */ `
vec4 shape_bars(vec3 s, vec3 r) {
  float left = -0.5 * bars_width;
  if (s.y < BARS_TREND) {
    float y = bars_base + bars_height * (0.3 + 0.7 * r.x) + bars_trendLift + 0.06 * bars_height * sin(r.x * 5.0);
    return vec4(left + r.x * bars_width, y, 0.5 * bars_depth, 1.0);
  }
  float j = floor(s.x * bars_count);
  float h = bars_height * (0.3 + 0.7 * j / (bars_count - 1.0)) + 0.1 * bars_height * sin(j * 2.4);
  float z = (r.z - 0.5) * bars_depth;
  float u = r.x;
  float v = r.y;
  float vis = bars_fill;
  if (s.y < BARS_TREND + uOutline) {
    // 막대 윤곽: 윗변 40%, 양옆 60%
    if (s.z < 0.4) v = 1.0;
    else u = step(0.7, s.z);
    vis = 1.0;
  }
  float x = left + ((j + 0.5) + (u - 0.5) * (1.0 - bars_gap)) / bars_count * bars_width;
  return vec4(x, bars_base + v * h, z, vis);
}`,
  },
  {
    // 전구: 유리구(구 표면) + 목 + 나사 base(나선) + 안쪽 필라멘트(강조)
    name: 'bulb',
    glsl: /* glsl */ `
vec4 shape_bulb(vec3 s, vec3 r) {
  float a = r.x * 6.2831853;
  float yNeck = bulb_y - bulb_cut * bulb_radius; // 유리구가 목과 만나는 높이
  float rNeck = bulb_radius * sqrt(1.0 - bulb_cut * bulb_cut);
  float p = s.y;
  if (p < BULB_FILAMENT) {
    if (s.x < 0.7) {
      float t = r.x * 6.2831853 * bulb_coils;
      return vec4((r.x - 0.5) * bulb_filamentWidth, bulb_y + 0.09 * sin(t), 0.09 * cos(t), bulb_filamentGlow);
    }
    float side = s.z < 0.5 ? -1.0 : 1.0; // 지지선 2개
    return vec4(side * mix(0.5 * bulb_filamentWidth, 0.12, r.y), mix(bulb_y, yNeck - 0.15, r.y), 0.0, bulb_filamentGlow);
  }
  p -= BULB_FILAMENT;
  if (p < BULB_NECK) {
    float rad = mix(rNeck, bulb_baseRadius, smoothstep(0.0, 1.0, r.y));
    return vec4(cos(a) * rad, yNeck - r.y * bulb_neck, sin(a) * rad, bulb_glass);
  }
  p -= BULB_NECK;
  if (p < BULB_BASE) {
    float t = r.y * 6.2831853 * bulb_turns; // 나사산: 원기둥을 감는 나선
    return vec4(cos(t) * bulb_baseRadius, yNeck - bulb_neck - r.y * bulb_baseHeight, sin(t) * bulb_baseRadius, 1.0);
  }
  float c = mix(-bulb_cut, 1.0, r.y); // 구 표면에 고르게, 아래쪽(목 자리)은 비운다
  float sn = sqrt(max(0.0, 1.0 - c * c));
  return vec4(cos(a) * sn * bulb_radius, bulb_y + c * bulb_radius, sin(a) * sn * bulb_radius, bulb_glass);
}`,
  },
  {
    // 화면 가로 전체를 지나는 물결 띠
    name: 'band',
    glsl: /* glsl */ `
vec4 shape_band(vec3 s, vec3 r) {
  float x = (s.x - 0.5) * band_width;
  float w = uTime * band_speed;
  float t = s.y * 2.0 - 1.0;
  float thick = band_thickness * (0.6 + 0.4 * sin(1.7 * band_freq * x - w)); // 폭이 x를 따라 숨쉰다
  float y = band_amp * (sin(band_freq * x + w) + 0.5 * sin(2.3 * band_freq * x - 1.4 * w)) + t * abs(t) * thick * 0.5;
  float z = (s.z - 0.5) * band_depth + 0.3 * band_amp * cos(band_freq * x + w);
  return vec4(x, y, z, 1.0);
}`,
  },
] as const;

const shapes = /* glsl */ `
uniform float uTime;
uniform float uOutline; // 윤곽선에 쓰는 점 비율
${RATIOS}
${dims}
${SHAPES.map((s) => s.glsl).join('\n')}
vec4 shapeOrigin(int id, vec3 s, vec3 r) {
${SHAPES.map((s, i) => `  if (id == ${i}) return shape_${s.name}(s, r);`).join('\n')}
  return vec4(0.0, 0.0, 0.0, 1.0);
}`;

// 점마다 고정 시드: 텍셀 좌표의 정수 해시 (pcg3d, Jarzynski & Olano 2020)
const seed = /* glsl */ `
vec3 seedOf(vec2 fragCoord, uint salt) {
  uvec3 v = uvec3(uvec2(fragCoord), salt);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967296.0);
}`;

// 3D simplex noise: Ian McEwan, Stefan Gustavson (Ashima Arts), MIT License
// https://github.com/stegu/webgl-noise
const noise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// 벡터 포텐셜 (n1, n2, n3)의 curl. 필요한 편미분만 계산한다(snoise 12회).
float n1(vec3 p) { return snoise(p); }
float n2(vec3 p) { return snoise(p.yzx + vec3(-19.1, 33.4, 47.2)); }
float n3(vec3 p) { return snoise(p.zxy + vec3(74.2, -124.5, 99.4)); }
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  return vec3(
    n3(p + dy) - n3(p - dy) - n2(p + dz) + n2(p - dz),
    n1(p + dz) - n1(p - dz) - n3(p + dx) + n3(p - dx),
    n2(p + dx) - n2(p - dx) - n1(p + dy) + n1(p - dy)
  ) / (2.0 * e);
}`;

// tPos, tVel 샘플러와 resolution define은 GPUComputationRenderer가 앞에 붙인다.
export const velocityFrag = /* glsl */ `
uniform float uDt, uMix;
uniform float uSpring, uDamping, uNoiseAmp, uNoiseFreq, uNoiseSpeed, uPointerRadius, uPointerForce;
uniform vec3 uPointer;
uniform int uShapeA, uShapeB;
${shapes}
${seed}
${noise}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(tPos, uv).xyz;
  vec3 vel = texture2D(tVel, uv).xyz;
  vec3 s = seedOf(gl_FragCoord.xy, 0u);
  vec3 r = seedOf(gl_FragCoord.xy, 2u);
  // 점당 shape 호출은 2번: 현재 섹션 shape와 다음 섹션 shape
  vec4 origin = mix(shapeOrigin(uShapeA, s, r), shapeOrigin(uShapeB, s, r), uMix);
  vec3 acc = (origin.xyz - pos) * uSpring;
  acc += curlNoise(pos * uNoiseFreq + uTime * uNoiseSpeed) * uNoiseAmp;
  vec3 d = pos - uPointer;
  float dist = length(d);
  acc += d / (dist + 1e-4) * uPointerForce * smoothstep(uPointerRadius, 0.0, dist);
  vel = (vel + acc * uDt) * exp(-uDamping * uDt);
  gl_FragColor = vec4(vel, origin.w); // w: shape가 정한 가시도/강조(렌더에서 쓴다)
}`;

export const positionFrag = /* glsl */ `
uniform float uDt;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  gl_FragColor = vec4(texture2D(tPos, uv).xyz + texture2D(tVel, uv).xyz * uDt, 1.0);
}`;

// 초기 위치: uScatterOn=1이면 화면 밖 원환(입장 연출), 0이면 shape A의 origin 그대로.
export const initFrag = /* glsl */ `
uniform int uShapeA;
uniform float uScatterOn;
uniform vec3 uScatter; // 최소 반지름, 최대 반지름, z 두께
${shapes}
${seed}
void main() {
  vec3 origin = shapeOrigin(uShapeA, seedOf(gl_FragCoord.xy, 0u), seedOf(gl_FragCoord.xy, 2u)).xyz;
  vec3 s = seedOf(gl_FragCoord.xy, 1u);
  float a = s.x * 6.2831853;
  vec3 far = vec3(cos(a), sin(a), 0.0) * mix(uScatter.x, uScatter.y, s.y) + vec3(0.0, 0.0, (s.z - 0.5) * uScatter.z);
  gl_FragColor = vec4(mix(origin, far, uScatterOn), 1.0);
}`;

// position 어트리뷰트의 xy는 시뮬 텍스처 uv다.
export const pointsVert = /* glsl */ `
uniform sampler2D tPos, tVel;
uniform float uSize, uScale, uColorSpeed, uColorDist, uDim, uInsight;
varying float vMix;
varying float vVis;
void main() {
  vec3 pos = texture2D(tPos, position.xy).xyz;
  vec4 velVis = texture2D(tVel, position.xy);
  vec3 vel = velVis.xyz;
  float glow = clamp(velVis.w - 1.0, 0.0, 1.0); // w가 1을 넘는 만큼 강조
  vVis = min(velVis.w, 1.0) * uDim;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * sqrt(uDim) * (1.0 + glow) * uScale / -mv.z);
  vMix = clamp(length(vel) * uColorSpeed + length(pos) * uColorDist, 0.0, 1.0);
  // insight 구간: 전체를 따뜻한 색 쪽으로, 강조 점(필라멘트)은 전부 그 색으로
  vMix = max(mix(vMix, 1.0, 0.6 * uInsight), glow);
}`;

export const pointsFrag = /* glsl */ `
uniform vec3 uColorA, uColorB, uColorC; // 기본, accent, insight
uniform float uAlpha, uInsight;
varying float vMix;
varying float vVis;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(mix(uColorA, mix(uColorB, uColorC, uInsight), vMix), a * a * uAlpha * vVis);
  #include <colorspace_fragment>
}`;
