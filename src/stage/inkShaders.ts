// 히어로 잉크 리빌 셰이더(WebGL2, three 미사용). ink.ts가 컴파일한다.

// 화면을 덮는 삼각형 1개. 버퍼 없이 gl_VertexID로 만든다(drawArrays(TRIANGLES, 0, 3))
export const inkVert = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const MAX_STAMPS = 8;

// 마스크 필드 갱신(저해상도 ping-pong): 약한 블러 → 감쇠(곱 + 선형) → 이번 프레임의 캡슐 스탬프를 max로 누적.
// 선형 감쇠항이 8비트 텍스처에서도 값이 0까지 내려가게 한다.
export const fieldFrag = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uSize;   // CSS px
uniform float uBlur;
uniform float uKeep;
uniform float uSub;
uniform int uCount;
uniform vec4 uSeg[${MAX_STAMPS}]; // 선분 x0, y0, x1, y1 (CSS px, y 아래로)
uniform vec2 uRS[${MAX_STAMPS}];  // 반경(px), 세기
in vec2 vUv;
out vec4 o;
void main() {
  float c = texture(uPrev, vUv).r;
  float n = texture(uPrev, vUv + vec2(uTexel.x, 0.0)).r + texture(uPrev, vUv - vec2(uTexel.x, 0.0)).r
          + texture(uPrev, vUv + vec2(0.0, uTexel.y)).r + texture(uPrev, vUv - vec2(0.0, uTexel.y)).r;
  float f = max(0.0, mix(c, n * 0.25, uBlur) * uKeep - uSub);
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  for (int i = 0; i < ${MAX_STAMPS}; i++) {
    if (i >= uCount) break;
    vec2 a = uSeg[i].xy;
    vec2 ba = uSeg[i].zw - a;
    vec2 pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float d = length(pa - ba * h) / uRS[i].x;
    f = max(f, uRS[i].y * (1.0 - smoothstep(0.0, 1.0, d))); // 반경의 절반쯤에서 임계 0.5를 넘는다
  }
  o = vec4(f, 0.0, 0.0, 1.0);
}`;

// 2D simplex noise: Ian McEwan, Stefan Gustavson (Ashima Arts), MIT License
// https://github.com/stegu/webgl-noise
const noise2 = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}`;

/** 합성: 배경 + (마스크 안) 흐르는 잉크 + 마스크 바깥 옅은 그림자 + 글자(잉크 안 흰색, 밖 검정). 불투명. */
export const compositeFrag = (octaves: number) => /* glsl */ `#version 300 es
precision highp float;
#define OCT ${octaves}
uniform sampler2D uField;
uniform sampler2D uText;
uniform vec2 uSize;      // CSS px
uniform vec2 uShadowOff; // uv 단위
uniform vec2 uFlow;      // 포인터 이동이 끌어당긴 흐름 오프셋
uniform float uTime;
uniform vec3 uBg;
uniform vec3 uFg;
uniform vec3 uShadow;
uniform vec3 uPal[5];
uniform vec3 uDeep;
in vec2 vUv;
out vec4 o;
${noise2}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCT; i++) {
    s += a * snoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.45;
  }
  return s;
}
vec3 palette(float u) {
  float f = fract(u) * 5.0;
  int i = int(f);
  vec3 a = uPal[i];
  vec3 b = uPal[(i + 1) % 5];
  return mix(a, b, smoothstep(0.0, 1.0, fract(f)));
}
// 2단 domain warp fbm: 번지는 물감
vec3 ink(vec2 p) {
  float t = uTime;
  p += uFlow;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.06)), fbm(p + vec2(5.2, 1.3) - t * 0.05));
  vec2 r = vec2(fbm(p + 1.4 * q + vec2(1.7, 9.2) + t * 0.1), fbm(p + 1.4 * q + vec2(8.3, 2.8) - t * 0.08));
  float v = fbm(p + 1.6 * r);
  vec3 c = palette(0.5 + 0.75 * v + 0.3 * q.x + t * 0.02);
  c = mix(c, uDeep, smoothstep(0.35, 0.9, length(r)) * 0.55); // 깊은 곳: 어두운 군청 소량
  return clamp((c - 0.5) * 1.12 + 0.5, 0.0, 1.0); // 대비
}
void main() {
  vec2 p = vUv * uSize / min(uSize.x, uSize.y);
  float f = texture(uField, vUv).r;
  float fs = texture(uField, vUv - uShadowOff).r;
  vec3 col = uBg;
  float m = 0.0;
  if (max(f, fs) > 0.2) {
    // 가장자리 노이즈: 임계를 흔들어 메타볼처럼 울퉁불퉁하게, 꼬리는 물방울로 끊기게
    float n = snoise(p * 9.0 + vec2(uTime * 0.25, 0.0)) * 0.65 + snoise(p * 17.0 - vec2(0.0, uTime * 0.35)) * 0.35;
    m = smoothstep(0.46, 0.54, f + n * 0.16);
    float sh = smoothstep(0.3, 0.62, fs + n * 0.16) * (1.0 - m);
    col = mix(col, uShadow, sh * 0.55);
    if (m > 0.0) col = mix(col, ink(p * 1.1), m);
  }
  float t = texture(uText, vUv).a;
  col = mix(col, mix(uFg, vec3(1.0), m), t);
  o = vec4(col, 1.0);
}`;
