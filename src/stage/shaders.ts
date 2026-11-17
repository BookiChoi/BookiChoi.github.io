// shape: seed(0..1 vec3) → 월드 좌표. 배열에 항목을 추가하면 shapeOrigin 분기가 자동으로 생긴다.
// 배열 인덱스가 shape id (uShapeA / uShapeB 유니폼 값).
export const SHAPES = [
  {
    name: 'ring',
    glsl: /* glsl */ `
vec3 shape_ring(vec3 s) {
  float a = s.x * 6.2831853;
  float t = s.y * 2.0 - 1.0;
  float r = uRing.x + t * abs(t) * uRing.y * 0.5; // 가운데가 더 촘촘
  return vec3(cos(a) * r, sin(a) * r, (s.z - 0.5) * uRing.z);
}`,
  },
  {
    name: 'sphere',
    glsl: /* glsl */ `
vec3 shape_sphere(vec3 s) {
  float a = s.x * 6.2831853;
  float z = 1.0 - 2.0 * s.y;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(cos(a) * r, sin(a) * r, z) * uSphere.x * (1.0 + (s.z - 0.5) * uSphere.y);
}`,
  },
] as const;

const shapes = /* glsl */ `
uniform vec3 uRing;   // 반지름, 두께, z 두께
uniform vec2 uSphere; // 반지름, 표면 두께 비율
${SHAPES.map((s) => s.glsl).join('\n')}
vec3 shapeOrigin(int id, vec3 s) {
${SHAPES.map((s, i) => `  if (id == ${i}) return shape_${s.name}(s);`).join('\n')}
  return vec3(0.0);
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
uniform float uDt, uTime, uMorph;
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
  vec3 origin = mix(shapeOrigin(uShapeA, s), shapeOrigin(uShapeB, s), uMorph);
  vec3 acc = (origin - pos) * uSpring;
  acc += curlNoise(pos * uNoiseFreq + uTime * uNoiseSpeed) * uNoiseAmp;
  vec3 d = pos - uPointer;
  float dist = length(d);
  acc += d / (dist + 1e-4) * uPointerForce * smoothstep(uPointerRadius, 0.0, dist);
  vel = (vel + acc * uDt) * exp(-uDamping * uDt);
  gl_FragColor = vec4(vel, 1.0);
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
  vec3 origin = shapeOrigin(uShapeA, seedOf(gl_FragCoord.xy, 0u));
  vec3 s = seedOf(gl_FragCoord.xy, 1u);
  float a = s.x * 6.2831853;
  vec3 far = vec3(cos(a), sin(a), 0.0) * mix(uScatter.x, uScatter.y, s.y) + vec3(0.0, 0.0, (s.z - 0.5) * uScatter.z);
  gl_FragColor = vec4(mix(origin, far, uScatterOn), 1.0);
}`;

// position 어트리뷰트의 xy는 시뮬 텍스처 uv다.
export const pointsVert = /* glsl */ `
uniform sampler2D tPos, tVel;
uniform float uSize, uScale, uColorSpeed, uColorDist;
varying float vMix;
void main() {
  vec3 pos = texture2D(tPos, position.xy).xyz;
  vec3 vel = texture2D(tVel, position.xy).xyz;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * uScale / -mv.z);
  vMix = clamp(length(vel) * uColorSpeed + length(pos) * uColorDist, 0.0, 1.0);
}`;

export const pointsFrag = /* glsl */ `
uniform vec3 uColorA, uColorB;
uniform float uAlpha;
varying float vMix;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(mix(uColorA, uColorB, vMix), a * a * uAlpha);
  #include <colorspace_fragment>
}`;
