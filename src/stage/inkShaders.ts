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

export const MAX_LETTERS = 16;

/** 합성(불투명). 마스크 밖: 밝은 배경 + 옅은 그림자 + 검정 이름. 마스크 안은 모드별:
 *  uMode 0(name): 어두운 바닥 위에 같은 이름이 스타일 글자로(0 은빛 풍선, 1 파스텔 풍선, 2 네온). 글자 반전 없음.
 *  uMode 1(smoke): 3색 + 군청의 부드러운 구름, 잉크 안 글자는 흰색.
 *  글자 텍스처 uText: R 작은 흐림(윤곽에서 약 0.5), G 큰 흐림, B 선명한 글자 커버리지. */
export const compositeFrag = /* glsl */ `#version 300 es
precision highp float;
#define OCT 3
uniform sampler2D uField;
uniform sampler2D uText;
uniform vec2 uSize;      // CSS px
uniform vec2 uTexel;     // 글자 텍스처 1픽셀(uv)
uniform vec2 uShadowOff; // uv 단위
uniform vec2 uFlow;      // 포인터 이동이 끌어당긴 흐름 오프셋
uniform float uTime;
uniform vec3 uBg;
uniform vec3 uFg;
uniform vec3 uShadow;
uniform int uMode;
uniform int uStyleA;
uniform int uStyleB;
uniform float uStyleMix;  // 0이면 A만, 0..1이면 A → B 크로스페이드
uniform vec4 uLetters[${MAX_LETTERS}]; // 글자 상자(uv: x0, y0, x1, y1)
uniform int uLetterCount;
uniform vec3 uSmoke[4];  // 인디고, 마젠타, 오렌지, 깊이용 군청
in vec2 vUv;
out vec4 o;
${noise2}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCT; i++) {
    s += a * snoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// --- smoke: 큰 덩어리, 약한 워프 1단, 부드러운 경계, 낮은 대비 ---
vec3 smoke(vec2 p) {
  float t = uTime;
  p = p * 0.75 + uFlow;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.05)), fbm(p + vec2(5.2, 1.3) - t * 0.04));
  vec2 s = p + 0.6 * q;
  float a = fbm(s + vec2(t * 0.03, 0.0));
  float b = fbm(s * 1.3 + vec2(7.1, 3.7) - vec2(0.0, t * 0.025));
  vec3 c = mix(uSmoke[0], uSmoke[1], smoothstep(-0.35, 0.35, a));
  c = mix(c, uSmoke[2], smoothstep(0.05, 0.5, b) * 0.85);
  c = mix(c, uSmoke[3], smoothstep(-0.1, -0.55, a) * 0.4);
  c = mix(c, min(c * 1.22 + 0.06, vec3(1.0)), smoothstep(0.25, 0.7, a + b) * 0.5); // 같은 계열의 밝은 톤
  return clamp((c - 0.5) * 0.85 + 0.5, 0.0, 1.0);
}

// --- name: 높이 지도 조명 ---
float height(vec4 t) { return sqrt(clamp(0.3 * t.r + 1.0 * t.g, 0.0, 1.0)); } // 큰 흐림 위주: 획 가운데가 둥글게 부푼다
float parity(vec2 uv) { // 글자 순번 홀짝(글자마다 색 교대). 글자 상자까지의 거리로 부드럽게 섞어 사이 글로우에 경계가 생기지 않게
  float sw = 0.0;
  float sp = 0.0;
  for (int i = 0; i < ${MAX_LETTERS}; i++) {
    if (i >= uLetterCount) break;
    vec4 r = uLetters[i];
    vec2 d = max(abs(uv - (r.xy + r.zw) * 0.5) - (r.zw - r.xy) * 0.5, 0.0) * uSize;
    float wgt = exp(-dot(d, d) / 200.0) + 1e-6;
    sw += wgt;
    sp += wgt * float(i % 2);
  }
  return sp / max(sw, 1e-5);
}
vec3 env(vec3 r) { // 가짜 스튜디오 환경: 위 밝음/아래 어두움 + 소프트박스 2개
  vec3 c = mix(vec3(0.07, 0.07, 0.09), vec3(0.82, 0.84, 0.88), smoothstep(-0.7, 0.9, r.y));
  c += vec3(1.0) * pow(max(dot(r, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 36.0) * 1.6;
  c += vec3(0.85, 0.9, 1.0) * pow(max(dot(r, normalize(vec3(0.55, -0.25, 0.8))), 0.0), 18.0) * 0.6;
  return c;
}
const vec3 FLOOR = vec3(0.043, 0.043, 0.063); // #0b0b10
vec3 nameStyle(int s, vec4 t, vec3 n, float h, float par, vec2 p) {
  if (s == 0) { // 은빛 풍선: 포일 주름 + 얇은 막 색 + 접힘 선
    vec3 nn = normalize(n + vec3(snoise(p * 24.0), snoise(p * 24.0 + 7.3), 0.0) * 0.05 * h);
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), nn);
    vec3 c = env(r) * vec3(0.93, 0.95, 1.0);
    float ph = fract(h * 1.6 + dot(nn.xy, vec2(1.8, 1.1)) + uTime * 0.05) * 3.0;
    vec3 film = ph < 1.0 ? mix(vec3(0.62, 0.42, 1.0), vec3(0.35, 0.62, 1.0), ph)
              : ph < 2.0 ? mix(vec3(0.35, 0.62, 1.0), vec3(1.0, 0.8, 0.38), ph - 1.0)
              : mix(vec3(1.0, 0.8, 0.38), vec3(0.62, 0.42, 1.0), ph - 2.0);
    float fres = pow(1.0 - nn.z, 1.5);
    c = mix(c, c * film * 1.45, 0.3 + 0.45 * fres);
    c *= 1.0 - 0.5 * exp(-pow((t.r - 0.64) / 0.05, 2.0)) - 0.35 * exp(-pow((t.r - 0.5) / 0.04, 2.0));
    return c;
  }
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  if (s == 1) { // 파스텔 풍선: 확산광 + 흰 스페큘러 + 림
    vec3 base = mix(vec3(1.0, 0.70, 0.82), vec3(0.66, 0.86, 1.0), par);
    float diff = 0.5 + 0.5 * max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
    float rim = pow(1.0 - n.z, 2.0);
    return base * diff * (0.78 + 0.22 * h) + vec3(spec) * 1.1 + vec3(1.0, 0.96, 1.0) * rim * 0.45;
  }
  // 네온: 윤곽을 따라 가는 튜브(심지 흰빛) + 글로우. 2색 교대
  vec3 col = mix(vec3(1.0, 0.18, 0.71), vec3(0.13, 0.9, 1.0), par);
  float tube = exp(-pow((t.r - 0.5) / 0.1, 2.0));
  float core = exp(-pow((t.r - 0.5) / 0.035, 2.0));
  float glow = smoothstep(0.02, 0.45, t.g) * (1.0 - t.b); // 글로우는 글자 바깥에만(안쪽은 바닥색)
  return FLOOR + col * (tube * 1.1 + glow * 0.35) + vec3(1.0, 0.95, 1.0) * core * 0.75;
}
vec3 nameInk(vec2 uv, vec4 t, vec2 p) {
  vec2 dx = vec2(uTexel.x * 2.0, 0.0);
  vec2 dy = vec2(0.0, uTexel.y * 2.0);
  float h = height(t);
  bool fading = uStyleMix > 0.0;
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (uStyleA != 2 || (fading && uStyleB != 2)) { // 법선은 풍선에만 필요(네온은 생략)
    vec2 g = vec2(height(texture(uText, uv + dx)) - height(texture(uText, uv - dx)), height(texture(uText, uv + dy)) - height(texture(uText, uv - dy)));
    n = normalize(vec3(-g * 7.0, 1.0));
  }
  float par = (uStyleA != 0 || fading) ? parity(uv) : 0.0; // 글자별 색 교대는 파스텔·네온만
  vec3 a = nameStyle(uStyleA, t, n, h, par, p);
  if (uStyleMix > 0.0) a = mix(a, nameStyle(uStyleB, t, n, h, par, p), uStyleMix);
  // 풍선은 글자 모양 안에만, 네온은 바닥까지 포함한 색
  float isNeonA = uStyleA == 2 ? 1.0 : 0.0;
  float isNeon = mix(isNeonA, uStyleB == 2 ? 1.0 : 0.0, uStyleMix);
  return mix(mix(FLOOR, a, t.b), a, isNeon);
}

void main() {
  vec2 p = vUv * uSize / min(uSize.x, uSize.y);
  float f = texture(uField, vUv).r;
  float fs = texture(uField, vUv - uShadowOff).r;
  vec4 t = texture(uText, vUv);
  vec3 col = uBg;
  float m = 0.0;
  if (max(f, fs) > 0.2) {
    // 가장자리 노이즈: 임계를 흔들어 메타볼처럼 울퉁불퉁하게, 꼬리는 물방울로 끊기게
    float n = snoise(p * 9.0 + vec2(uTime * 0.25, 0.0)) * 0.65 + snoise(p * 17.0 - vec2(0.0, uTime * 0.35)) * 0.35;
    m = smoothstep(0.46, 0.54, f + n * 0.16);
    float sh = smoothstep(0.3, 0.62, fs + n * 0.16) * (1.0 - m);
    col = mix(col, uShadow, sh * 0.55);
  }
  vec3 outside = mix(col, uFg, t.b);
  if (m <= 0.0) { o = vec4(outside, 1.0); return; }
  if (uMode == 0) {
    o = vec4(mix(outside, nameInk(vUv, t, p), m), 1.0);
  } else {
    vec3 c = mix(col, smoke(p), m);
    o = vec4(mix(c, mix(uFg, vec3(1.0), m), t.b), 1.0);
  }
}`;
