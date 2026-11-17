import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { PARAMS } from './params';
import { initFrag, pointsFrag, pointsVert, positionFrag, velocityFrag } from './shaders';
import type { Tier } from './tiers';

/** 현재 섹션 쌍의 보간 상태: shape a → b를 mix로 섞는다. dim은 알파 배율, insight는 따뜻한 색 비중(0..1) */
export interface Blend {
  a: number;
  b: number;
  mix: number;
  dim: number;
  insight: number;
  /** noiseAmp 배율 */
  noise: number;
}

export interface Particles {
  points: Points;
  posTexture(): Texture;
  velTexture(): Texture;
  /** pxPerUnit: 거리 1에서 월드 1유닛이 차지하는 디바이스 픽셀 수 */
  setScale(pxPerUnit: number): void;
  step(dt: number, time: number, pointer: Vector3, blend: Blend): void;
  dispose(): void;
}

/**
 * scatter: 1이면 흩어진 위치에서 시작(입장 연출), 0이면 origin에서 시작.
 * from을 주면 초기 위치 대신 그 상태를 이어받는다(tier 하향 시 튐 방지).
 */
export function createParticles(
  renderer: WebGLRenderer,
  size: Tier,
  type: TextureDataType,
  colors: { a: string; b: string; c: string },
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

  // shape 치수는 셰이더에 상수로 구워져 있어서 여기서 넘기는 것은 시간, shape 쌍, tier별 윤곽 비율뿐이다
  const shape = {
    uTime: { value: 0 },
    uOutline: { value: P.outline[size] },
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
    uInsight: { value: 0 },
    uColorA: { value: new Color(colors.a) },
    uColorB: { value: new Color(colors.b) },
    uColorC: { value: new Color(colors.c) },
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
    step(dt, time, pointer, blend) {
      // 입장 구간은 introDuration 안에 수렴하는 임계감쇠 스프링(ω = 6/T), 끝나면 1초에 걸쳐 평소 값으로
      const w = 6 / P.introDuration;
      const a = Math.min(1, Math.max(0, time - P.introDuration));
      sim.uSpring.value = w * w + (P.spring - w * w) * a;
      sim.uDamping.value = 2 * w + (P.damping - 2 * w) * a;
      sim.uDt.value = dt;
      sim.uTime.value = time;
      sim.uShapeA.value = blend.a;
      sim.uShapeB.value = blend.b;
      sim.uMix.value = blend.mix;
      sim.uNoiseAmp.value = P.noiseAmp * blend.noise;
      draw.uDim.value = blend.dim;
      draw.uInsight.value = blend.insight;
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
