import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { initFrag, pointsFrag, pointsVert, positionFrag, velocityFrag } from './shaders';

// 튜닝 파라미터는 전부 여기. 길이 단위는 월드 유닛.
export const PARAMS = {
  // 시뮬레이션
  spring: 3, // origin으로 당기는 힘 (입장이 끝난 뒤의 평소 값)
  damping: 3, // 속도 감쇠 (1/s)
  introDuration: 2, // 입장: 흩어진 점이 shape로 모이는 데 걸리는 시간(초)
  noiseAmp: 0.1,
  noiseFreq: 0.9,
  noiseSpeed: 0.12,
  pointerRadius: 0.9,
  pointerForce: 6,
  // shape (SHAPES 순서: 0 ring, 1 sphere, 2 dataSurface, 3 risingStreams, 4 band)
  ringRadius: 1.4,
  ringThickness: 0.35,
  ringDepth: 0.12,
  sphereRadius: 1.25,
  sphereJitter: 0.08,
  surface: { width: 6.5, depth: 4.5, amp: 0.3, lines: 28, freq: 1.3, speed: 0.25, y: -0.5 },
  // speed는 초당 높이 비율, hide는 위에서 래핑된 점이 아래로 돌아가는 동안 숨기는 시간(초)
  streams: { count: 16, width: 6, height: 4.5, depth: 1.5, jitter: 0.08, speedMin: 0.04, speedMax: 0.14, hide: 1.2 },
  band: { width: 11, amp: 0.45, thickness: 0.5, depth: 1.2, freq: 0.9, speed: 0.3 },
  sectionShapes: [0, 1, 2, 3, 4], // 섹션 s0..s4가 쓰는 shape id. 이웃한 두 섹션 사이를 sec로 보간한다
  dimAtProjects: 0.8, // 마지막 섹션(프로젝트)에서 점의 알파 배율. 크기에는 제곱근을 곱한다
  // 입장 연출 시작 위치
  scatterMin: 3, // 화면 가장자리 근처라 첫 프레임부터 점이 보인다
  scatterMax: 5,
  scatterDepth: 2,
  // 렌더 (512 tier 기준, 낮은 tier는 자동 보정)
  pointSize: 0.01,
  alpha: 0.2,
  colorSpeed: 1.5, // 속도 → 색 혼합 비중
  colorDist: 0.2, // 중심 거리 → 색 혼합 비중
  // 카메라: 섹션별 위치/시선. sec로 보간하고 포인터 시선 이동을 그 위에 더한다
  fov: 45,
  cameraKeys: [
    { pos: [0, 0, 5], look: [0, 0, 0] },
    { pos: [0, 0, 4.6], look: [0, 0, 0] },
    { pos: [0, 2.2, 4.6], look: [0, -0.3, 0] }, // dataSurface를 약간 위에서 내려다본다
    { pos: [0, 0, 5.5], look: [0, 0, 0] },
    { pos: [0, 0, 5], look: [0, 0, 0] },
  ],
  fitMargin: 1.3, // 좁은 화면에서 링이 잘리지 않게 뒤로 물러나는 여유
  gaze: 0.25, // 포인터에 따른 시선 이동량
};

export interface Particles {
  points: Points;
  posTexture(): Texture;
  velTexture(): Texture;
  /** pxPerUnit: 거리 1에서 월드 1유닛이 차지하는 디바이스 픽셀 수 */
  setScale(pxPerUnit: number): void;
  /** shapeA → shapeB를 mix(0..1)로 보간한 origin을 따라간다. dim은 알파 배율. */
  step(dt: number, time: number, shapeA: number, shapeB: number, mix: number, dim: number, pointer: Vector3): void;
  dispose(): void;
}

/**
 * scatter: 1이면 흩어진 위치에서 시작(입장 연출), 0이면 origin에서 시작.
 * from을 주면 초기 위치 대신 그 상태를 이어받는다(tier 하향 시 튐 방지).
 */
export function createParticles(
  renderer: WebGLRenderer,
  size: number,
  type: TextureDataType,
  colors: { a: string; b: string },
  scatter: number,
  from?: Particles,
): Particles {
  const P = PARAMS;
  const gpu = new GPUComputationRenderer(size, size, renderer);
  gpu.setDataType(type);
  const zero = gpu.createTexture();
  const vel = gpu.addVariable('tVel', velocityFrag, zero);
  const pos = gpu.addVariable('tPos', positionFrag, zero);
  gpu.setVariableDependencies(vel, [pos, vel]);
  gpu.setVariableDependencies(pos, [pos, vel]);

  const { surface: sf, streams: st, band: bd } = P;
  const shape = {
    uTime: { value: 0 },
    uRing: { value: new Vector3(P.ringRadius, P.ringThickness, P.ringDepth) },
    uSphere: { value: new Vector2(P.sphereRadius, P.sphereJitter) },
    uSurface: { value: new Vector4(sf.width, sf.depth, sf.amp, sf.lines) },
    uSurfaceWave: { value: new Vector3(sf.freq, sf.speed, sf.y) },
    uStreams: { value: new Vector4(st.count, st.width, st.height, st.depth) },
    uStreamFlow: { value: new Vector4(st.jitter, st.speedMin, st.speedMax, st.hide) },
    uBand: { value: new Vector4(bd.width, bd.amp, bd.thickness, bd.depth) },
    uBandWave: { value: new Vector2(bd.freq, bd.speed) },
    uShapeA: { value: P.sectionShapes[0] },
    uShapeB: { value: P.sectionShapes[0] },
  };
  const sim = {
    ...shape,
    uDt: { value: 0 },
    uMix: { value: 0 },
    uPointer: { value: new Vector3() },
    uSpring: { value: P.spring },
    uDamping: { value: P.damping },
    uNoiseAmp: { value: P.noiseAmp },
    uNoiseFreq: { value: P.noiseFreq },
    uNoiseSpeed: { value: P.noiseSpeed },
    uPointerRadius: { value: P.pointerRadius },
    uPointerForce: { value: P.pointerForce },
  };
  Object.assign(vel.material.uniforms, sim);
  Object.assign(pos.material.uniforms, sim);

  const err = gpu.init();
  if (err) {
    gpu.dispose();
    throw new Error(err);
  }

  if (from) {
    for (const rt of pos.renderTargets) gpu.renderTexture(from.posTexture(), rt);
    for (const rt of vel.renderTargets) gpu.renderTexture(from.velTexture(), rt);
  } else {
    const init = gpu.createShaderMaterial(initFrag, {
      ...shape,
      uScatterOn: { value: scatter },
      uScatter: { value: new Vector3(P.scatterMin, P.scatterMax, P.scatterDepth) },
    });
    for (const rt of pos.renderTargets) gpu.doRenderTarget(init, rt);
    init.dispose();
  }

  // 점 수가 줄면 점을 키우고 밝게 해서 전체 밝기를 비슷하게 유지한다.
  const k = Math.sqrt(512 / size);
  const draw = {
    tPos: { value: gpu.getCurrentRenderTarget(pos).texture as Texture },
    tVel: { value: gpu.getCurrentRenderTarget(vel).texture as Texture },
    uSize: { value: P.pointSize * k },
    uScale: { value: 1 },
    uAlpha: { value: Math.min(1, P.alpha * k) },
    uDim: { value: 1 },
    uColorA: { value: new Color(colors.a) },
    uColorB: { value: new Color(colors.b) },
    uColorSpeed: { value: P.colorSpeed },
    uColorDist: { value: P.colorDist },
  };
  const uv = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    uv[i * 3] = ((i % size) + 0.5) / size;
    uv[i * 3 + 1] = (Math.floor(i / size) + 0.5) / size;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(uv, 3));
  const material = new ShaderMaterial({
    uniforms: draw,
    vertexShader: pointsVert,
    fragmentShader: pointsFrag,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false; // position은 uv라 바운딩 계산이 의미 없다

  return {
    points,
    posTexture: () => gpu.getCurrentRenderTarget(pos).texture,
    velTexture: () => gpu.getCurrentRenderTarget(vel).texture,
    setScale(pxPerUnit) {
      draw.uScale.value = pxPerUnit;
    },
    step(dt, time, shapeA, shapeB, mix, dim, pointer) {
      // 입장 구간은 introDuration 안에 수렴하는 임계감쇠 스프링(ω = 6/T), 끝나면 1초에 걸쳐 평소 값으로
      const w = 6 / P.introDuration;
      const a = Math.min(1, Math.max(0, time - P.introDuration));
      sim.uSpring.value = w * w + (P.spring - w * w) * a;
      sim.uDamping.value = 2 * w + (P.damping - 2 * w) * a;
      sim.uDt.value = dt;
      sim.uTime.value = time;
      sim.uShapeA.value = shapeA;
      sim.uShapeB.value = shapeB;
      sim.uMix.value = mix;
      draw.uDim.value = dim;
      sim.uPointer.value.copy(pointer);
      gpu.compute();
      draw.tPos.value = gpu.getCurrentRenderTarget(pos).texture;
      draw.tVel.value = gpu.getCurrentRenderTarget(vel).texture;
    },
    dispose() {
      gpu.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
