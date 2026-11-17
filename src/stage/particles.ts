import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { initFrag, pointsFrag, pointsVert, positionFrag, velocityFrag } from './shaders';

// 튜닝 파라미터는 전부 여기. 길이 단위는 월드 유닛.
export const PARAMS = {
  // 시뮬레이션
  spring: 3, // origin으로 당기는 힘
  damping: 3, // 속도 감쇠 (1/s)
  noiseAmp: 0.1,
  noiseFreq: 0.9,
  noiseSpeed: 0.12,
  pointerRadius: 0.9,
  pointerForce: 6,
  // shape
  ringRadius: 1.4,
  ringThickness: 0.35,
  ringDepth: 0.12,
  sphereRadius: 1.25,
  sphereJitter: 0.08,
  shapeA: 0, // SHAPES 인덱스 (shaders.ts)
  shapeB: 1,
  // 입장 연출 시작 위치
  scatterMin: 6,
  scatterMax: 10,
  scatterDepth: 2,
  // 렌더 (512 tier 기준, 낮은 tier는 자동 보정)
  pointSize: 0.01,
  alpha: 0.2,
  colorSpeed: 1.5, // 속도 → 색 혼합 비중
  colorDist: 0.2, // 중심 거리 → 색 혼합 비중
  // 카메라
  fov: 45,
  cameraZ: 5,
  fitMargin: 1.3, // 좁은 화면에서 링이 잘리지 않게 뒤로 물러나는 여유
  gaze: 0.25, // 포인터에 따른 시선 이동량
  scrollZoom: 0.8, // 스크롤 끝에서 다가가는 거리
};

export interface Particles {
  points: Points;
  posTexture(): Texture;
  velTexture(): Texture;
  /** pxPerUnit: 거리 1에서 월드 1유닛이 차지하는 디바이스 픽셀 수 */
  setScale(pxPerUnit: number): void;
  step(dt: number, time: number, morph: number, pointer: Vector3): void;
  dispose(): void;
}

/**
 * scatter: 1이면 화면 밖에서 시작, 0이면 origin에서 시작.
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

  const shape = {
    uRing: { value: new Vector3(P.ringRadius, P.ringThickness, P.ringDepth) },
    uSphere: { value: new Vector2(P.sphereRadius, P.sphereJitter) },
    uShapeA: { value: P.shapeA },
    uShapeB: { value: P.shapeB },
  };
  const sim = {
    ...shape,
    uDt: { value: 0 },
    uTime: { value: 0 },
    uMorph: { value: 0 },
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
    step(dt, time, morph, pointer) {
      sim.uDt.value = dt;
      sim.uTime.value = time;
      sim.uMorph.value = morph;
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
