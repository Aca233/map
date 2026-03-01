/**
 * HOI4 风格 3D 交互式地图 - 主入口（HOI4 真实数据版本）
 * 支持 State（一级行政区）可视化和交互
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { ProvinceStore } from './data/ProvinceStore';
import { TerrainManager, TERRAIN_TOTAL_SEGS_X, TERRAIN_TOTAL_SEGS_Z } from './terrain/TerrainManager';
import { ProvincePicker } from './interaction/ProvincePicker';
import { UIManager } from './ui/UIManager';
import {
  OwnershipSystem,
  RuntimeStore,
  SimulationClock,
  StateEconomySystem,
  SupplySystem,
} from './runtime';
import { SaveManager } from './persistence';
import './styles.css';
import cityHouseObjRaw from '../outputs/pdmesh/city_4_01.obj?raw';

interface CityScatterData {
  width: number;
  height: number;
  instanceCount: number;
  instances: Array<{
    x: number;
    y: number;
    colorIndex: number;
    mesh: string;
    distance: number;
    rotation: number;
    scale: number;
  }>;
}

interface BuildingsData {
  count: number;
  typeCounts: Record<string, number>;
  items: Array<{
    stateId: number;
    type: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
    extra: number | string;
  }>;
}

type HeightSampler = (px: number, py: number) => number;
type ProvinceColorSampler = (px: number, py: number) => number;

type TerrainSample = {
  height: number;
  normal: THREE.Vector3;
};

type CityBuildingTextures = {
  diffuse: THREE.Texture | null;
  normal: THREE.Texture | null;
};

// ===== 配置 =====
// HOI4 地图尺寸 5632x2048 → 世界空间比例 2.75:1
// 增大世界尺寸，提高可视空间与建筑分布间距
const MAP_WORLD_WIDTH = 440;
const MAP_WORLD_HEIGHT = 160;
// 降低地形起伏，避免政治视图中山脊过于夸张
const HEIGHT_SCALE = 3.7;

// 城市模型（OBJ）在当前世界坐标系中的统一尺度
const CITY_SCATTER_BASE_SCALE = 0.085;
const BUILDING_BASE_SCALE = 0.16;
const BUILDING_SUPPORT_RADIUS_FACTOR = 1.15;
const BUILDING_PROVINCE_FOOTPRINT_FACTOR = 2.2;
const BUILDING_BORDER_MISMATCH_TOLERANCE = 1;
const MAX_TERRAIN_TILT_RAD = Math.PI / 14;
const CITY_SCATTER_DENSITY = 0.42;
const BUILDING_DENSITY = 0.58;

// 采样与诊断
const NORMAL_SAMPLE_STEP_PX = 1.35;
const NORMAL_SMOOTH_CENTER_WEIGHT = 0.55;
const NORMAL_SMOOTH_NEIGHBOR_WEIGHT = 0.1125; // 四邻域合计 0.45
const HEIGHT_SMOOTH_GRID_RADIUS = 0.42;
const HEIGHT_SMOOTH_CENTER_WEIGHT = 0.64;
const HEIGHT_SMOOTH_NEIGHBOR_WEIGHT = 0.09; // 四邻域合计 0.36
const ENABLE_GROUNDING_DIAGNOSTICS = true;
const GROUNDING_DIAGNOSTIC_LOG_LIMIT = 40;

type GroundingProfile = {
  maxEmbed: number;
  maxFloat: number;
  baseLift: number;
  slopeLiftFactor: number;
  steepSpreadThreshold: number;
  relocationRings: number;
  relocationStepPx: number;
  relocationAngles: number;
};

type GroundingStats = {
  center: number;
  min: number;
  max: number;
  avg: number;
  spread: number;
};

type GroundingEvaluation = {
  stats: GroundingStats;
  slope: number;
  lowerBound: number;
  upperBound: number;
  targetY: number;
  finalY: number;
  feasible: boolean;
  needsRelocation: boolean;
};

type GroundingPlacement = {
  px: number;
  py: number;
  terrain: TerrainSample;
  evaluation: GroundingEvaluation;
  distancePx: number;
};

const BUILDING_GROUNDING_PROFILE: GroundingProfile = {
  maxEmbed: 0.0014,
  maxFloat: 0.0018,
  baseLift: 0.0009,
  slopeLiftFactor: 0.0008,
  steepSpreadThreshold: 0.0048,
  relocationRings: 4,
  relocationStepPx: 1.25,
  relocationAngles: 12,
};

const CITY_GROUNDING_PROFILE: GroundingProfile = {
  maxEmbed: 0.0018,
  maxFloat: 0.0024,
  baseLift: 0.0010,
  slopeLiftFactor: 0.0009,
  steepSpreadThreshold: 0.0056,
  relocationRings: 3,
  relocationStepPx: 1.1,
  relocationAngles: 10,
};

let groundingDiagnosticsCount = 0;

// 海平面高度（heightmap 像素值 0-1 × HEIGHT_SCALE），低于此值视为海洋
const SEA_LEVEL_WORLD = 0.358 * HEIGHT_SCALE;
// HOI4 的 city_n.dds 使用的是引擎自定义法线编码，直接喂给 three.js normalMap 会发黑；
// 先默认关闭，后续若完成重编码可再打开。
const ENABLE_CITY_NORMAL_MAP = false;

// ===== 资源路径与加载辅助函数 =====
function assetUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}assets/${fileName}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

async function loadJson<T>(fileName: string): Promise<T> {
  const response = await fetch(assetUrl(fileName));
  if (!response.ok) {
    throw new Error(`[Map] ${fileName} 加载失败: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function mapPixelToWorldX(px: number, mapWidthPx: number): number {
  const t = px / mapWidthPx;
  return t * MAP_WORLD_WIDTH - MAP_WORLD_WIDTH * 0.5;
}

function mapPixelToWorldZ(py: number, mapHeightPx: number): number {
  // HOI4 的 city/building 像素 Y 以底部为原点，这里需要翻转到贴图坐标系（顶部为原点）
  const t = 1.0 - py / mapHeightPx;
  return t * MAP_WORLD_HEIGHT - MAP_WORLD_HEIGHT * 0.5;
}

function mapDataYToCanvasY(py: number, mapHeightPx: number): number {
  // 数据坐标：底部为 0；Canvas 坐标：顶部为 0
  return mapHeightPx - 1 - py;
}

function canvasYToMapDataY(py: number, mapHeightPx: number): number {
  return mapHeightPx - 1 - py;
}

function wrapMapX(px: number, mapWidthPx: number): number {
  const w = Math.max(1, mapWidthPx);
  return ((px % w) + w) % w;
}

function clampMapY(py: number, mapHeightPx: number): number {
  const h = Math.max(1, mapHeightPx);
  return Math.max(0, Math.min(h - 1, py));
}

function sampleMapHeight(
  sampleHeight: HeightSampler,
  px: number,
  py: number,
  mapWidthPx: number,
  mapHeightPx: number
): number {
  return sampleHeight(
    wrapMapX(px, mapWidthPx),
    clampMapY(py, mapHeightPx)
  );
}

function parseObjGeometry(objText: string): THREE.BufferGeometry {
  const rawPositions: Array<[number, number, number]> = [];
  const rawNormals: Array<[number, number, number]> = [];
  const rawUvs: Array<[number, number]> = [];

  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUvs: number[] = [];
  const outIndices: number[] = [];
  const vertexCache = new Map<string, number>();

  const parseIndex = (value: string | undefined, length: number): number => {
    if (!value) return -1;
    const idx = Number.parseInt(value, 10);
    if (!Number.isFinite(idx) || idx === 0) return -1;
    return idx > 0 ? idx - 1 : length + idx;
  };

  const resolveVertex = (token: string): number => {
    const cached = vertexCache.get(token);
    if (cached !== undefined) return cached;

    const [vStr, vtStr, vnStr] = token.split('/');
    const vi = parseIndex(vStr, rawPositions.length);
    if (vi < 0 || vi >= rawPositions.length) {
      throw new Error(`[OBJ] 顶点索引越界: ${token}`);
    }

    const [px, py, pz] = rawPositions[vi];
    outPositions.push(px, py, pz);

    const vti = parseIndex(vtStr, rawUvs.length);
    if (vti >= 0 && vti < rawUvs.length) {
      const [u, v] = rawUvs[vti];
      outUvs.push(u, v);
    } else {
      outUvs.push(0, 0);
    }

    const vni = parseIndex(vnStr, rawNormals.length);
    if (vni >= 0 && vni < rawNormals.length) {
      const [nx, ny, nz] = rawNormals[vni];
      outNormals.push(nx, ny, nz);
    } else {
      outNormals.push(0, 1, 0);
    }

    const outIndex = outPositions.length / 3 - 1;
    vertexCache.set(token, outIndex);
    return outIndex;
  };

  const lines = objText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('v ')) {
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts.length >= 3) {
        rawPositions.push([
          Number.parseFloat(parts[0]),
          Number.parseFloat(parts[1]),
          Number.parseFloat(parts[2]),
        ]);
      }
      continue;
    }

    if (line.startsWith('vn ')) {
      const parts = line.slice(3).trim().split(/\s+/);
      if (parts.length >= 3) {
        rawNormals.push([
          Number.parseFloat(parts[0]),
          Number.parseFloat(parts[1]),
          Number.parseFloat(parts[2]),
        ]);
      }
      continue;
    }

    if (line.startsWith('vt ')) {
      const parts = line.slice(3).trim().split(/\s+/);
      if (parts.length >= 2) {
        rawUvs.push([
          Number.parseFloat(parts[0]),
          Number.parseFloat(parts[1]),
        ]);
      }
      continue;
    }

    if (line.startsWith('f ')) {
      const faceTokens = line.slice(2).trim().split(/\s+/).filter(Boolean);
      if (faceTokens.length < 3) continue;

      const faceIndices = faceTokens.map(resolveVertex);
      for (let i = 1; i < faceIndices.length - 1; i++) {
        outIndices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
  }

  if (outPositions.length === 0 || outIndices.length === 0) {
    throw new Error('[OBJ] 未解析到有效几何数据');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUvs, 2));
  geometry.setIndex(outIndices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function normalizeModelGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = geometry.clone();
  normalized.computeBoundingBox();

  const bbox = normalized.boundingBox;
  if (!bbox) return normalized;

  const centerX = (bbox.min.x + bbox.max.x) * 0.5;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;
  const baseY = bbox.min.y;

  // 让模型底面落在 y=0，且模型中心对齐到 xz 原点，方便实例化贴地
  normalized.translate(-centerX, -baseY, -centerZ);
  normalized.computeVertexNormals();
  normalized.computeBoundingBox();
  normalized.computeBoundingSphere();
  return normalized;
}

function sampleTerrainWithNormal(
  sampleHeight: HeightSampler,
  px: number,
  py: number,
  mapWidthPx: number,
  mapHeightPx: number
): TerrainSample {
  const step = NORMAL_SAMPLE_STEP_PX;
  const centerRaw = sampleMapHeight(sampleHeight, px, py, mapWidthPx, mapHeightPx);

  const hL = sampleMapHeight(sampleHeight, px - step, py, mapWidthPx, mapHeightPx);
  const hR = sampleMapHeight(sampleHeight, px + step, py, mapWidthPx, mapHeightPx);
  const hD = sampleMapHeight(sampleHeight, px, py - step, mapWidthPx, mapHeightPx);
  const hU = sampleMapHeight(sampleHeight, px, py + step, mapWidthPx, mapHeightPx);

  const center =
    centerRaw * NORMAL_SMOOTH_CENTER_WEIGHT +
    (hL + hR + hD + hU) * NORMAL_SMOOTH_NEIGHBOR_WEIGHT;

  const dx = (MAP_WORLD_WIDTH / mapWidthPx) * step;
  const dz = (MAP_WORLD_HEIGHT / mapHeightPx) * step;
  const dHdX = (hR - hL) / Math.max(1e-5, 2 * dx);
  // py 增加时 world-z 减小，所以这里使用 (hD - hU)
  const dHdZ = (hD - hU) / Math.max(1e-5, 2 * dz);

  const normal = new THREE.Vector3(-dHdX, 1, -dHdZ).normalize();
  return { height: center, normal };
}

function applyTerrainAlignedTransform(
  target: THREE.Object3D,
  terrainNormal: THREE.Vector3,
  yawRad: number,
  maxTiltRad: number
): void {
  const up = new THREE.Vector3(0, 1, 0);
  const normal = terrainNormal.clone().normalize();
  const angle = up.angleTo(normal);

  let alignedUp = normal;
  if (angle > maxTiltRad) {
    const axis = new THREE.Vector3().crossVectors(up, normal);
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      alignedUp = up.clone().applyAxisAngle(axis, maxTiltRad);
    } else {
      alignedUp = up.clone();
    }
  }

  const alignQuat = new THREE.Quaternion().setFromUnitVectors(up, alignedUp);
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(alignedUp, Number.isFinite(yawRad) ? yawRad : 0);
  target.quaternion.copy(alignQuat).multiply(yawQuat);
}

function getBuildingScaleMultiplier(type: string): number {
  const name = type.toLowerCase();
  if (name.includes('air_base')) return 1.55;
  if (name.includes('dockyard') || name.includes('naval_base') || name.includes('floating_harbor') || name.includes('naval_headquarters')) return 1.35;
  if (name.includes('bunker') || name.includes('stronghold')) return 1.15;
  if (name.includes('rocket') || name.includes('nuclear') || name.includes('special_project')) return 1.25;
  if (name.includes('landmark') || name.includes('dam') || name.includes('locks')) return 1.45;
  if (name.includes('radar')) return 0.95;
  if (name.includes('anti_air') || name.includes('supply')) return 0.9;
  return 1.0;
}

function stableHashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let hash = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(seed, 362437);
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 1274126177) >>> 0;
  return hash / 0xffffffff;
}

function createHeightSampler(
  heightmapCanvas: HTMLCanvasElement,
  mapWidthPx: number,
  mapHeightPx: number
): HeightSampler {
  const w = heightmapCanvas.width;
  const h = heightmapCanvas.height;
  const ctx = heightmapCanvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, w, h).data;

  // 复刻 TerrainManager 的 CPU 位移采样（先降采样到 2560x930 顶点网格，再按网格三角面插值）
  const gridW = TERRAIN_TOTAL_SEGS_X + 1;
  const gridH = TERRAIN_TOTAL_SEGS_Z + 1;
  const lodHeights = new Float32Array(gridW * gridH);

  for (let gz = 0; gz < gridH; gz++) {
    const srcY = Math.min(h - 1, Math.floor((gz / TERRAIN_TOTAL_SEGS_Z) * h));
    for (let gx = 0; gx < gridW; gx++) {
      const srcX = Math.min(w - 1, Math.floor((gx / TERRAIN_TOTAL_SEGS_X) * w));
      const idx = (srcY * w + srcX) * 4;
      lodHeights[gz * gridW + gx] = (data[idx] / 255) * HEIGHT_SCALE;
    }
  }

  const sampleLodHeight = (gridX: number, gridZ: number): number => {
    const gx = Math.max(0, Math.min(TERRAIN_TOTAL_SEGS_X, gridX));
    const gz = Math.max(0, Math.min(TERRAIN_TOTAL_SEGS_Z, gridZ));

    const x0 = Math.max(0, Math.min(TERRAIN_TOTAL_SEGS_X - 1, Math.floor(gx)));
    const z0 = Math.max(0, Math.min(TERRAIN_TOTAL_SEGS_Z - 1, Math.floor(gz)));
    const tx = gx - x0;
    const tz = gz - z0;

    const i00 = z0 * gridW + x0;
    const h00 = lodHeights[i00];
    const h10 = lodHeights[i00 + 1];
    const h01 = lodHeights[i00 + gridW];
    const h11 = lodHeights[i00 + gridW + 1];

    // 与 PlaneGeometry 默认三角拆分一致：
    // tri0: (0,0)-(0,1)-(1,0), tri1: (0,1)-(1,1)-(1,0)
    if (tx + tz <= 1.0) {
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }

    const w01 = 1.0 - tx;
    const w10 = 1.0 - tz;
    const w11 = tx + tz - 1.0;
    return h01 * w01 + h10 * w10 + h11 * w11;
  };

  const sampleLodHeightSmoothed = (gridX: number, gridZ: number): number => {
    const base = sampleLodHeight(gridX, gridZ);
    const r = HEIGHT_SMOOTH_GRID_RADIUS;

    const hL = sampleLodHeight(gridX - r, gridZ);
    const hR = sampleLodHeight(gridX + r, gridZ);
    const hD = sampleLodHeight(gridX, gridZ - r);
    const hU = sampleLodHeight(gridX, gridZ + r);

    return (
      base * HEIGHT_SMOOTH_CENTER_WEIGHT +
      (hL + hR + hD + hU) * HEIGHT_SMOOTH_NEIGHBOR_WEIGHT
    );
  };

  return (px: number, py: number): number => {
    const wrappedX = wrapMapX(px, mapWidthPx);
    const clampedY = clampMapY(py, mapHeightPx);

    const u = wrappedX / Math.max(1, mapWidthPx);
    const v = clampedY / Math.max(1, mapHeightPx);
    const gridX = u * TERRAIN_TOTAL_SEGS_X;
    const gridZ = v * TERRAIN_TOTAL_SEGS_Z;
    return sampleLodHeightSmoothed(gridX, gridZ);
  };
}

function createProvinceColorSampler(provinceCanvas: HTMLCanvasElement): ProvinceColorSampler {
  const w = provinceCanvas.width;
  const h = provinceCanvas.height;
  const ctx = provinceCanvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, w, h).data;

  return (px: number, py: number): number => {
    const xRaw = Math.floor(px);
    const x = ((xRaw % w) + w) % w; // 地图 X 方向支持水平循环
    const y = Math.max(0, Math.min(h - 1, Math.floor(py)));
    const idx = (y * w + x) * 4;
    return (data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2];
  };
}

function isFootprintMostlyInsideProvince(
  sampleProvinceColor: ProvinceColorSampler,
  centerX: number,
  centerY: number,
  radiusPx: number,
  maxMismatches: number
): boolean {
  const centerColor = sampleProvinceColor(centerX, centerY);
  const diag = radiusPx * 0.70710678;
  let mismatches = 0;

  const testPoint = (x: number, y: number) => {
    if (sampleProvinceColor(x, y) !== centerColor) {
      mismatches++;
    }
  };

  testPoint(centerX + radiusPx, centerY);
  testPoint(centerX - radiusPx, centerY);
  testPoint(centerX, centerY + radiusPx);
  testPoint(centerX, centerY - radiusPx);
  testPoint(centerX + diag, centerY + diag);
  testPoint(centerX + diag, centerY - diag);
  testPoint(centerX - diag, centerY + diag);
  testPoint(centerX - diag, centerY - diag);

  return mismatches <= maxMismatches;
}

function hideInstancedObject(temp: THREE.Object3D, instanced: THREE.InstancedMesh, index: number): void {
  temp.position.set(0, -100, 0);
  temp.scale.setScalar(0);
  temp.updateMatrix();
  instanced.setMatrixAt(index, temp.matrix);
}

function collectFootprintHeights(
  sampleHeight: HeightSampler,
  centerX: number,
  centerY: number,
  radiusPx: number,
  mapWidthPx: number,
  mapHeightPx: number
): GroundingStats {
  const diag = radiusPx * 0.70710678;
  const inner = radiusPx * 0.5;

  const points: Array<[number, number]> = [
    [centerX, centerY],
    [centerX + radiusPx, centerY],
    [centerX - radiusPx, centerY],
    [centerX, centerY + radiusPx],
    [centerX, centerY - radiusPx],
    [centerX + diag, centerY + diag],
    [centerX + diag, centerY - diag],
    [centerX - diag, centerY + diag],
    [centerX - diag, centerY - diag],
    [centerX + inner, centerY],
    [centerX - inner, centerY],
    [centerX, centerY + inner],
    [centerX, centerY - inner],
  ];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let center = 0;

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const h = sampleMapHeight(sampleHeight, x, y, mapWidthPx, mapHeightPx);
    if (i === 0) center = h;
    min = Math.min(min, h);
    max = Math.max(max, h);
    sum += h;
  }

  const avg = sum / points.length;
  return {
    center,
    min,
    max,
    avg,
    spread: max - min,
  };
}

function evaluateGrounding(
  terrain: TerrainSample,
  stats: GroundingStats,
  profile: GroundingProfile
): GroundingEvaluation {
  const slope = 1.0 - Math.max(0, Math.min(1, terrain.normal.y));
  const lowerBound = stats.max - profile.maxEmbed;
  const upperBound = stats.min + profile.maxFloat;
  const feasible = lowerBound <= upperBound + 1e-6;
  const targetY = stats.avg + profile.baseLift + slope * profile.slopeLiftFactor;
  const finalY = feasible
    ? THREE.MathUtils.clamp(targetY, lowerBound, upperBound)
    : (lowerBound + upperBound) * 0.5;
  const needsRelocation = !feasible || stats.spread > profile.steepSpreadThreshold;

  return {
    stats,
    slope,
    lowerBound,
    upperBound,
    targetY,
    finalY,
    feasible,
    needsRelocation,
  };
}

function mapToWorldPosition(
  px: number,
  canvasPy: number,
  mapWidthPx: number,
  mapHeightPx: number
): { x: number; z: number } {
  const wrappedX = wrapMapX(px, mapWidthPx);
  const clampedCanvasY = clampMapY(canvasPy, mapHeightPx);
  const sourceMapY = canvasYToMapDataY(clampedCanvasY, mapHeightPx);

  return {
    x: mapPixelToWorldX(wrappedX, mapWidthPx),
    z: mapPixelToWorldZ(sourceMapY, mapHeightPx),
  };
}

function findRelocatedGroundingPlacement(
  sampleHeight: HeightSampler,
  mapWidthPx: number,
  mapHeightPx: number,
  centerX: number,
  centerY: number,
  footprintRadiusPx: number,
  profile: GroundingProfile,
  seaLevelWorld: number,
  validator?: (x: number, y: number) => boolean
): GroundingPlacement | null {
  let best: GroundingPlacement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const evaluateCandidate = (x: number, y: number, distancePx: number): GroundingPlacement | null => {
    const px = wrapMapX(x, mapWidthPx);
    const py = clampMapY(y, mapHeightPx);

    if (validator && !validator(px, py)) return null;

    const terrain = sampleTerrainWithNormal(sampleHeight, px, py, mapWidthPx, mapHeightPx);
    if (terrain.height < seaLevelWorld) return null;

    const stats = collectFootprintHeights(sampleHeight, px, py, footprintRadiusPx, mapWidthPx, mapHeightPx);
    const evaluation = evaluateGrounding(terrain, stats, profile);
    if (!evaluation.feasible || evaluation.needsRelocation) return null;

    const score =
      distancePx * 0.35 +
      evaluation.stats.spread * 6.0 +
      Math.abs(evaluation.finalY - evaluation.stats.center) * 8.0 +
      evaluation.slope * 2.0;

    const placement: GroundingPlacement = {
      px,
      py,
      terrain,
      evaluation,
      distancePx,
    };

    if (score < bestScore) {
      bestScore = score;
      best = placement;
    }

    return placement;
  };

  const centerPlacement = evaluateCandidate(centerX, centerY, 0);
  if (centerPlacement) {
    return centerPlacement;
  }

  for (let ring = 1; ring <= profile.relocationRings; ring++) {
    const radius = ring * profile.relocationStepPx;
    const sampleCount = Math.max(8, profile.relocationAngles * ring);

    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * Math.PI * 2.0;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      evaluateCandidate(x, y, radius);
    }
  }

  return best;
}

function logGroundingDiagnostic(message: string, payload: Record<string, unknown>): void {
  if (!ENABLE_GROUNDING_DIAGNOSTICS) return;
  if (groundingDiagnosticsCount >= GROUNDING_DIAGNOSTIC_LOG_LIMIT) return;
  groundingDiagnosticsCount += 1;
  console.info(`[Grounding] ${message}`, payload);
}

function configureCityTexture(texture: THREE.Texture, maxAnisotropy: number, isColor: boolean): THREE.Texture {
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = texture.mipmaps && texture.mipmaps.length > 1
    ? THREE.LinearMipmapLinearFilter
    : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  if (isColor) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  texture.needsUpdate = true;
  return texture;
}

function loadDdsTexture(loader: DDSLoader, fileName: string): Promise<THREE.CompressedTexture> {
  return new Promise((resolve, reject) => {
    loader.load(
      assetUrl(fileName),
      (texture) => resolve(texture),
      undefined,
      (error) => reject(error)
    );
  });
}

function loadTexture(loader: THREE.TextureLoader, fileName: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      assetUrl(fileName),
      (texture) => resolve(texture),
      undefined,
      (error) => reject(error)
    );
  });
}

async function loadCityBuildingTextures(maxAnisotropy: number): Promise<CityBuildingTextures> {
  const ddsLoader = new DDSLoader();
  const textureLoader = new THREE.TextureLoader();
  const textures: CityBuildingTextures = {
    diffuse: null,
    normal: null,
  };

  // 先走 PNG（由 DDS 解码得到），避免不同显卡/驱动对 DDS 采样差异导致黑模
  try {
    const diffusePng = await loadTexture(textureLoader, 'city_d.png');
    textures.diffuse = configureCityTexture(diffusePng, maxAnisotropy, true);
    console.log('[Map] city_d.png 加载成功');
  } catch (pngError) {
    try {
      const diffuseDds = await loadDdsTexture(ddsLoader, 'city_d.dds');
      textures.diffuse = configureCityTexture(diffuseDds, maxAnisotropy, true);
      console.log('[Map] city_d.dds 加载成功（PNG 不可用时回退）');
    } catch (ddsError) {
      console.warn('[Map] city_d 贴图加载失败，建筑将退回纯色材质', { pngError, ddsError });
    }
  }

  if (!ENABLE_CITY_NORMAL_MAP) {
    console.log('[Map] 已禁用城市 normalMap（避免 HOI4 法线编码差异导致发黑）');
    return textures;
  }

  try {
    const normalPng = await loadTexture(textureLoader, 'city_n.png');
    textures.normal = configureCityTexture(normalPng, maxAnisotropy, false);
    console.log('[Map] city_n.png 加载成功');
  } catch (pngError) {
    try {
      const normalDds = await loadDdsTexture(ddsLoader, 'city_n.dds');
      textures.normal = configureCityTexture(normalDds, maxAnisotropy, false);
      console.log('[Map] city_n.dds 加载成功（PNG 不可用时回退）');
    } catch (ddsError) {
      console.warn('[Map] city_n 贴图加载失败，将不启用法线贴图', { pngError, ddsError });
    }
  }

  return textures;
}

function createCityScatterInstanced(
  cityData: CityScatterData,
  mapWidthPx: number,
  mapHeightPx: number,
  sampleHeight: HeightSampler,
  geometry: THREE.BufferGeometry,
  textures: CityBuildingTextures
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'CityScatterGroup';

  const entries = Object.entries(cityData.instances.reduce<Record<string, CityScatterData['instances']>>((acc, item) => {
    (acc[item.mesh] ||= []).push(item);
    return acc;
  }, {}));

  const temp = new THREE.Object3D();

  for (const [meshName, items] of entries) {
    const material = textures.diffuse
      ? new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: textures.diffuse,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      : new THREE.MeshStandardMaterial({
        color: 0xd6d2c7,
        roughness: 0.92,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });

    const instanced = new THREE.InstancedMesh(geometry, material, items.length);
    instanced.name = `CityScatter_${meshName}`;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sourcePy = item.y;
      const canvasPy = mapDataYToCanvasY(sourcePy, mapHeightPx);

      // 密度抽样：降低城市散布密度
      if (seededNoise2D(item.x, sourcePy, 13579) > CITY_SCATTER_DENSITY) {
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const baseTerrain = sampleTerrainWithNormal(sampleHeight, item.x, canvasPy, mapWidthPx, mapHeightPx);

      // 海洋过滤：低于海平面的实例缩放为 0（隐藏）
      if (baseTerrain.height < SEA_LEVEL_WORLD) {
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const footprintRadiusPx = Math.max(1.0, 0.95 * item.scale);
      const baseStats = collectFootprintHeights(
        sampleHeight,
        item.x,
        canvasPy,
        footprintRadiusPx,
        mapWidthPx,
        mapHeightPx
      );
      const baseEvaluation = evaluateGrounding(baseTerrain, baseStats, CITY_GROUNDING_PROFILE);

      let placement: GroundingPlacement | null = null;

      if (!baseEvaluation.needsRelocation) {
        placement = {
          px: item.x,
          py: canvasPy,
          terrain: baseTerrain,
          evaluation: baseEvaluation,
          distancePx: 0,
        };
      } else {
        placement = findRelocatedGroundingPlacement(
          sampleHeight,
          mapWidthPx,
          mapHeightPx,
          item.x,
          canvasPy,
          footprintRadiusPx,
          CITY_GROUNDING_PROFILE,
          SEA_LEVEL_WORLD
        );

        if (placement) {
          logGroundingDiagnostic('city-relocated', {
            mesh: meshName,
            fromX: item.x,
            fromY: canvasPy,
            toX: placement.px,
            toY: placement.py,
            distancePx: placement.distancePx,
            spread: placement.evaluation.stats.spread,
            finalY: placement.evaluation.finalY,
          });
        }
      }

      if (!placement) {
        logGroundingDiagnostic('city-hidden-steep', {
          mesh: meshName,
          x: item.x,
          y: canvasPy,
          spread: baseEvaluation.stats.spread,
          lower: baseEvaluation.lowerBound,
          upper: baseEvaluation.upperBound,
          hMin: baseEvaluation.stats.min,
          hMax: baseEvaluation.stats.max,
        });
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const world = mapToWorldPosition(placement.px, placement.py, mapWidthPx, mapHeightPx);
      temp.position.set(world.x, placement.evaluation.finalY, world.z);
      applyTerrainAlignedTransform(temp, placement.terrain.normal, item.rotation, MAX_TERRAIN_TILT_RAD * 0.45);
      temp.scale.setScalar(CITY_SCATTER_BASE_SCALE * item.scale);
      temp.updateMatrix();
      instanced.setMatrixAt(i, temp.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  }

  return group;
}

function createBuildingsInstanced(
  buildingsData: BuildingsData,
  mapWidthPx: number,
  mapHeightPx: number,
  sampleHeight: HeightSampler,
  sampleProvinceColor: ProvinceColorSampler,
  geometry: THREE.BufferGeometry,
  textures: CityBuildingTextures
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'BuildingsGroup';

  const byType = buildingsData.items.reduce<Record<string, BuildingsData['items']>>((acc, item) => {
    (acc[item.type] ||= []).push(item);
    return acc;
  }, {});

  const temp = new THREE.Object3D();

  for (const [type, items] of Object.entries(byType)) {
    const material = textures.diffuse
      ? new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: textures.diffuse,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      : new THREE.MeshStandardMaterial({
        color: 0xc7c3b4,
        roughness: 0.9,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });

    const typeSeed = stableHashString(type);

    const instanced = new THREE.InstancedMesh(geometry, material, items.length);
    instanced.name = `Building_${type}`;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sourcePz = item.z;
      const canvasPy = mapDataYToCanvasY(sourcePz, mapHeightPx);

      // 密度抽样：减少建筑过密
      if (seededNoise2D(item.x, sourcePz, typeSeed) > BUILDING_DENSITY) {
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const yFactor = 1.0 + Math.min(0.28, Math.max(0, item.y - 9.0) / 90.0);
      const typeScaleMultiplier = getBuildingScaleMultiplier(type);
      const footprintRadiusPx = Math.max(1.0, BUILDING_SUPPORT_RADIUS_FACTOR * yFactor * typeScaleMultiplier);

      // 省份边界约束：建筑占地超出地块边界则隐藏
      const provinceFootprintRadiusPx = Math.max(1.25, footprintRadiusPx * BUILDING_PROVINCE_FOOTPRINT_FACTOR);
      const provinceValidator = (x: number, y: number) => isFootprintMostlyInsideProvince(
        sampleProvinceColor,
        x,
        y,
        provinceFootprintRadiusPx,
        BUILDING_BORDER_MISMATCH_TOLERANCE
      );

      if (!provinceValidator(item.x, canvasPy)) {
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const baseTerrain = sampleTerrainWithNormal(sampleHeight, item.x, canvasPy, mapWidthPx, mapHeightPx);

      // 海洋过滤：低于海平面的实例缩放为 0（隐藏）
      if (baseTerrain.height < SEA_LEVEL_WORLD) {
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const baseStats = collectFootprintHeights(
        sampleHeight,
        item.x,
        canvasPy,
        footprintRadiusPx,
        mapWidthPx,
        mapHeightPx
      );
      const baseEvaluation = evaluateGrounding(baseTerrain, baseStats, BUILDING_GROUNDING_PROFILE);

      let placement: GroundingPlacement | null = null;

      if (!baseEvaluation.needsRelocation) {
        placement = {
          px: item.x,
          py: canvasPy,
          terrain: baseTerrain,
          evaluation: baseEvaluation,
          distancePx: 0,
        };
      } else {
        placement = findRelocatedGroundingPlacement(
          sampleHeight,
          mapWidthPx,
          mapHeightPx,
          item.x,
          canvasPy,
          footprintRadiusPx,
          BUILDING_GROUNDING_PROFILE,
          SEA_LEVEL_WORLD,
          provinceValidator
        );

        if (placement) {
          logGroundingDiagnostic('building-relocated', {
            type,
            fromX: item.x,
            fromY: canvasPy,
            toX: placement.px,
            toY: placement.py,
            distancePx: placement.distancePx,
            spread: placement.evaluation.stats.spread,
            finalY: placement.evaluation.finalY,
          });
        }
      }

      if (!placement) {
        logGroundingDiagnostic('building-hidden-steep', {
          type,
          x: item.x,
          y: canvasPy,
          spread: baseEvaluation.stats.spread,
          lower: baseEvaluation.lowerBound,
          upper: baseEvaluation.upperBound,
          hMin: baseEvaluation.stats.min,
          hMax: baseEvaluation.stats.max,
        });
        hideInstancedObject(temp, instanced, i);
        continue;
      }

      const world = mapToWorldPosition(placement.px, placement.py, mapWidthPx, mapHeightPx);
      const buildingScale = BUILDING_BASE_SCALE * typeScaleMultiplier;
      const rad = (item.rotation / 180) * Math.PI;

      temp.position.set(world.x, placement.evaluation.finalY, world.z);
      // 建筑保持近似竖直，避免倾斜导致底边穿进地形
      applyTerrainAlignedTransform(temp, placement.terrain.normal, rad, 0);

      temp.scale.setScalar(buildingScale * yFactor);
      temp.updateMatrix();
      instanced.setMatrixAt(i, temp.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  }

  return group;
}

// ===== 主程序 =====
async function main() {
  console.log('[Map] 正在初始化...');

  // 1. 创建数据仓库并加载 HOI4 数据
  const store = new ProvinceStore();
  await store.loadFromHOI4Data();

  // 2. 初始化运行时与持久化（在 ProvinceStore 就绪后）
  const runtimeStore = RuntimeStore.fromProvinceStore(store);
  const simulationClock = new SimulationClock({
    fixedStepSeconds: 0.2,
    maxStepsPerFrame: 6,
    maxFrameDeltaSeconds: 0.5,
  });
  const ownershipSystem = new OwnershipSystem();
  const stateEconomySystem = new StateEconomySystem();
  const supplySystem = new SupplySystem();
  const saveManager = new SaveManager(runtimeStore, simulationClock, 'main-runtime');

  // 3. 加载纹理图片
  console.log('[Map] 正在加载纹理...');
  const [heightmapImg, provincesImg, riversImg, terrainColormapImg, waterColormapImg, cityLightsImg] = await Promise.all([
    loadImage(assetUrl('heightmap.png')),
    loadImage(assetUrl('provinces.png')),
    loadImage(assetUrl('rivers.png')),
    loadImage(assetUrl('terrain_colormap.png')),
    loadImage(assetUrl('terrain_water.png')),
    loadImage(assetUrl('city_lights.png')),
  ]);

  console.log(`[Map] heightmap: ${heightmapImg.width}x${heightmapImg.height}`);
  console.log(`[Map] provinces: ${provincesImg.width}x${provincesImg.height}`);
  console.log(`[Map] rivers: ${riversImg.width}x${riversImg.height}`);
  console.log(`[Map] terrain_colormap: ${terrainColormapImg.width}x${terrainColormapImg.height}`);
  console.log(`[Map] terrain_water: ${waterColormapImg.width}x${waterColormapImg.height}`);
  console.log(`[Map] city_lights: ${cityLightsImg.width}x${cityLightsImg.height}`);

  const heightmapCanvas = imageToCanvas(heightmapImg);
  const provinceMapCanvas = imageToCanvas(provincesImg);
  const riversCanvas = imageToCanvas(riversImg);
  const terrainColormapCanvas = imageToCanvas(terrainColormapImg);
  const waterColormapCanvas = imageToCanvas(waterColormapImg);
  const cityLightsCanvas = imageToCanvas(cityLightsImg);

  // 3. 生成国家颜色 LUT 纹理
  console.log('[Map] 正在生成国家颜色 LUT...');
  const countryLutCanvas = store.generateCountryLUT(provinceMapCanvas);

  // 4. 生成 State LUT 纹理
  console.log('[Map] 正在生成 State LUT...');
  const stateLutCanvas = store.generateStateLUT(provinceMapCanvas);

  // 5. 生成 Strategic Region LUT 纹理
  console.log('[Map] 正在生成 Strategic Region LUT...');
  const strategicRegionLutCanvas = store.generateStrategicRegionLUT(provinceMapCanvas);

  // ===== 场景设置 =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1e);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 180, 180);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // 帧率优先：默认压低像素比，降低填充率压力
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
  document.getElementById('app')!.prepend(renderer.domElement);

  // 后处理：帧率优先策略下默认关闭 FXAA，低成本直接 renderer.render
  // 保留 composer/fxaa 以便后续动态切换
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.enabled = false;
  composer.addPass(fxaaPass);

  const updateFxaaResolution = () => {
    const pr = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * pr),
      1 / (window.innerHeight * pr)
    );
  };
  updateFxaaResolution();

  // ===== 相机控制 =====
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 5;
  controls.maxDistance = 700;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,       // 左键按住拖动 = 平移地图
    MIDDLE: THREE.MOUSE.ROTATE,  // 中键按住 = 自由旋转角度
    RIGHT: THREE.MOUSE.DOLLY,    // 右键 = 缩放（备用）
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  controls.target.set(0, 0, 0);

  // WASD 键盘移动控制
  const keysPressed = new Set<string>();
  const MOVE_SPEED_FACTOR = 0.012; // 移速系数（乘以相机距离）

  // 动态分辨率（帧率优先）
  const DPR_MIN = 0.72;
  const DPR_MAX = 1.35;
  const FPS_TARGET = 60;
  const FPS_LOW = 52;
  const FPS_HIGH = 63;
  let dprCurrent = Math.min(window.devicePixelRatio, DPR_MAX);
  let dprAccumulator = 0;
  let dprSampleFrames = 0;
  let dprCooldown = 0;

  // 拾取触发降载：仅在鼠标/相机变化时高频拾取，静止时低频保活
  let mouseDirty = true;
  let cameraDirty = true;
  let idlePickAccumulator = 0;
  const IDLE_PICK_INTERVAL = 0.20; // 秒

  window.addEventListener('keydown', (e) => {
    const keyLower = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && keyLower === 's') {
      e.preventDefault();
      const snapshot = saveManager.save();
      console.log(`[Runtime] 已保存运行时快照: tick=${snapshot.runtime.tick}, at=${snapshot.createdAt}`);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && keyLower === 'l') {
      e.preventDefault();
      const loadedSnapshot = saveManager.load();
      if (loadedSnapshot) {
        runtimeStore.setTick(simulationClock.getTick());
        console.log(`[Runtime] 已加载运行时快照: tick=${loadedSnapshot.runtime.tick}, at=${loadedSnapshot.createdAt}`);
      } else {
        console.warn('[Runtime] 未找到可加载的运行时快照或快照无效');
      }
      return;
    }

    keysPressed.add(keyLower);
  });
  window.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key.toLowerCase());
  });

  // ===== 光照 =====
  scene.add(new THREE.AmbientLight(0x404060, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
  dirLight.position.set(50, 100, 30);
  scene.add(dirLight);

  // ===== 地形 =====
  console.log('[Map] 正在创建地形...');
  const terrainManager = new TerrainManager(scene, MAP_WORLD_WIDTH, MAP_WORLD_HEIGHT, HEIGHT_SCALE);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  // 创建纹理对象
  // flipY=false: 确保 UV v=0 对应图片顶部（与 Canvas y=0 对应图片顶部一致）
  const heightmapTexture = new THREE.CanvasTexture(heightmapCanvas);
  heightmapTexture.flipY = false;
  heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
  heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
  heightmapTexture.minFilter = THREE.LinearFilter;
  heightmapTexture.magFilter = THREE.LinearFilter;

  const provinceMapTexture = new THREE.CanvasTexture(provinceMapCanvas);
  provinceMapTexture.flipY = false;
  provinceMapTexture.wrapS = THREE.ClampToEdgeWrapping;
  provinceMapTexture.wrapT = THREE.ClampToEdgeWrapping;
  // 视觉渲染使用线性过滤，降低放大后边界“像素块”锯齿感
  // 交互拾取仍走 CPU Canvas 逐像素读取，不受此处过滤影响
  provinceMapTexture.minFilter = THREE.LinearFilter;
  provinceMapTexture.magFilter = THREE.LinearFilter;

  const countryLutTexture = new THREE.CanvasTexture(countryLutCanvas);
  countryLutTexture.flipY = false;
  countryLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  countryLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  countryLutTexture.minFilter = THREE.LinearFilter;
  countryLutTexture.magFilter = THREE.LinearFilter;

  const stateLutTexture = new THREE.CanvasTexture(stateLutCanvas);
  stateLutTexture.flipY = false;
  stateLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  stateLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  stateLutTexture.minFilter = THREE.LinearFilter;
  stateLutTexture.magFilter = THREE.LinearFilter;

  const strategicRegionLutTexture = new THREE.CanvasTexture(strategicRegionLutCanvas);
  strategicRegionLutTexture.flipY = false;
  strategicRegionLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  strategicRegionLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  strategicRegionLutTexture.minFilter = THREE.LinearFilter;
  strategicRegionLutTexture.magFilter = THREE.LinearFilter;

  const riversTexture = new THREE.CanvasTexture(riversCanvas);
  riversTexture.flipY = false;
  riversTexture.wrapS = THREE.ClampToEdgeWrapping;
  riversTexture.wrapT = THREE.ClampToEdgeWrapping;
  riversTexture.minFilter = THREE.NearestFilter;
  riversTexture.magFilter = THREE.NearestFilter;

  const terrainColormapTexture = new THREE.CanvasTexture(terrainColormapCanvas);
  terrainColormapTexture.flipY = false;
  terrainColormapTexture.wrapS = THREE.RepeatWrapping;
  terrainColormapTexture.wrapT = THREE.ClampToEdgeWrapping;
  // 兼顾近距离与远距离：避免近处马赛克，同时在斜视角下尽量保持清晰
  terrainColormapTexture.minFilter = THREE.LinearMipmapLinearFilter;
  terrainColormapTexture.magFilter = THREE.LinearFilter;
  terrainColormapTexture.generateMipmaps = true;
  terrainColormapTexture.anisotropy = maxAnisotropy;

  const waterColormapTexture = new THREE.CanvasTexture(waterColormapCanvas);
  waterColormapTexture.flipY = false;
  waterColormapTexture.wrapS = THREE.RepeatWrapping;
  waterColormapTexture.wrapT = THREE.ClampToEdgeWrapping;
  waterColormapTexture.minFilter = THREE.LinearMipmapLinearFilter;
  waterColormapTexture.magFilter = THREE.LinearFilter;
  waterColormapTexture.generateMipmaps = true;
  waterColormapTexture.anisotropy = maxAnisotropy;

  const cityLightsTexture = new THREE.CanvasTexture(cityLightsCanvas);
  cityLightsTexture.flipY = false;
  cityLightsTexture.wrapS = THREE.RepeatWrapping;
  cityLightsTexture.wrapT = THREE.ClampToEdgeWrapping;
  cityLightsTexture.minFilter = THREE.LinearMipmapLinearFilter;
  cityLightsTexture.magFilter = THREE.LinearFilter;
  cityLightsTexture.generateMipmaps = true;
  cityLightsTexture.anisotropy = maxAnisotropy;

  terrainManager.createTerrainFromTextures(
    heightmapTexture,
    provinceMapTexture,
    countryLutTexture,
    stateLutTexture,
    strategicRegionLutTexture,
    riversTexture,
    terrainColormapTexture,
    waterColormapTexture,
    cityLightsTexture,
    provincesImg.width,
    provincesImg.height,
    heightmapCanvas
  );
  console.log('[Map] 地形创建完毕');

  // ===== 城市建筑（InstancedMesh） =====
  const [citiesData, buildingsData] = await Promise.all([
    loadJson<CityScatterData>('cities.json'),
    loadJson<BuildingsData>('buildings.json'),
  ]);
  console.log(`[Map] cities.json: ${citiesData.instanceCount} 个城市散布实例`);
  console.log(`[Map] buildings.json: ${buildingsData.count} 个建筑实例`);

  const sampleHeight = createHeightSampler(heightmapCanvas, provincesImg.width, provincesImg.height);
  const sampleProvinceColor = createProvinceColorSampler(provinceMapCanvas);
  const cityBuildingTextures = await loadCityBuildingTextures(maxAnisotropy);

  const cityRawGeometry = parseObjGeometry(cityHouseObjRaw);
  const cityGeometry = normalizeModelGeometry(cityRawGeometry);

  const cityScatterGroup = createCityScatterInstanced(
    citiesData,
    provincesImg.width,
    provincesImg.height,
    sampleHeight,
    cityGeometry,
    cityBuildingTextures
  );
  const buildingsGroup = createBuildingsInstanced(
    buildingsData,
    provincesImg.width,
    provincesImg.height,
    sampleHeight,
    sampleProvinceColor,
    cityGeometry,
    cityBuildingTextures
  );
  scene.add(cityScatterGroup);
  scene.add(buildingsGroup);

  // ===== 交互拾取 =====
  const picker = new ProvincePicker(
    camera,
    terrainManager,
    store,
    provinceMapCanvas,
    stateLutCanvas,
    strategicRegionLutCanvas
  );

  // ===== UI =====
  const ui = new UIManager(store);

  let lastMouseX = 0;
  let lastMouseY = 0;

  picker.onHover = (province, state, strategicRegion) => {
    if (province) {
      ui.showTooltip(province, state, strategicRegion, lastMouseX, lastMouseY);
      document.body.style.cursor = 'pointer';
    } else {
      ui.hideTooltip();
      document.body.style.cursor = 'default';
    }
  };

  picker.onSelect = (province, state, strategicRegion) => {
    if (province) {
      ui.showPanel(province, state, strategicRegion);
    } else {
      ui.hidePanel();
    }
  };

  ui.onMapModeChange = (mode) => {
    terrainManager.setMapMode(mode);
  };

  ui.onCityScatterVisibilityChange = (visible) => {
    cityScatterGroup.visible = visible;
  };

  ui.onBuildingsVisibilityChange = (visible) => {
    buildingsGroup.visible = visible;
  };

  ui.onCityLightsVisibilityChange = (visible) => {
    terrainManager.setCityLightsIntensity(visible ? 1.0 : 0.0);
  };

  // 初始化默认图层状态：默认关闭 3D 建筑（城市散布 + 特殊建筑）
  const cityScatterToggle = document.getElementById('toggle-city-scatter') as HTMLInputElement | null;
  const buildingsToggle = document.getElementById('toggle-buildings') as HTMLInputElement | null;
  if (cityScatterToggle) cityScatterToggle.checked = false;
  if (buildingsToggle) buildingsToggle.checked = false;

  cityScatterGroup.visible = false;
  buildingsGroup.visible = false;
  terrainManager.setCityLightsIntensity(0.0);

  // ===== 事件 =====
  // 区分点击 vs 拖拽：只有鼠标移动距离 < 5px 时才算作点击选中
  let mouseDownPos = { x: 0, y: 0 };
  let isDragging = false;
  let mouseDownPickBlocked = false;

  window.addEventListener('mousedown', (e) => {
    mouseDownPos.x = e.clientX;
    mouseDownPos.y = e.clientY;
    isDragging = false;

    const target = e.target as HTMLElement;
    mouseDownPickBlocked =
      !!target.closest('#province-panel') ||
      !!target.closest('#map-mode-bar') ||
      !!target.closest('#layer-toggles');
  });

  window.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    picker.updateMouse(e.clientX, e.clientY);
    mouseDirty = true;

    // 检查是否拖拽
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      isDragging = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDragging && e.button === 0) {
      if (mouseDownPickBlocked) return;

      // 点击选中以 mousedown 坐标为准，避免左键轻微平移导致落点漂移（陆地小省份更明显）
      const pickX = mouseDownPos.x;
      const pickY = mouseDownPos.y;
      lastMouseX = pickX;
      lastMouseY = pickY;

      // 在 select 之前强制 pick 一次，确保 hoveredProvince 是最新的
      picker.updateMouse(pickX, pickY);
      picker.pick(performance.now(), true); // 强制 pick，跳过节流
      picker.select();
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // resize 后保持当前动态 DPR（不强行回到设备 DPR）
    renderer.setPixelRatio(dprCurrent);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    updateFxaaResolution();
  });

  // ===== 渲染循环 =====
  const clock = new THREE.Clock();
  let lastFrameTime = performance.now();

  function animate(): void {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const timestamp = performance.now();
    const deltaTime = (timestamp - lastFrameTime) / 1000; // 秒
    lastFrameTime = timestamp;

    const runtimeTicks = simulationClock.advance(deltaTime);
    for (const tickContext of runtimeTicks) {
      runtimeStore.setTick(tickContext.tick);
      ownershipSystem.update(runtimeStore, tickContext);
      stateEconomySystem.update(runtimeStore, tickContext);
      supplySystem.update(runtimeStore, tickContext);
    }

    // WASD 键盘移动
    if (keysPressed.size > 0) {
      // 获取相机在 XZ 平面上的前方和右方方向
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveVec = new THREE.Vector3();

      if (keysPressed.has('w')) moveVec.add(forward);
      if (keysPressed.has('s')) moveVec.sub(forward);
      if (keysPressed.has('a')) moveVec.sub(right);
      if (keysPressed.has('d')) moveVec.add(right);

      if (moveVec.length() > 0) {
        // 移速与相机到目标的距离成正比：近距离慢，远距离快
        const dist = camera.position.distanceTo(controls.target);
        const speed = dist * MOVE_SPEED_FACTOR;
        moveVec.normalize().multiplyScalar(speed);
        camera.position.add(moveVec);
        controls.target.add(moveVec);
      }
    }

    const prevCamX = camera.position.x;
    const prevCamY = camera.position.y;
    const prevCamZ = camera.position.z;
    const prevTargetX = controls.target.x;
    const prevTargetY = controls.target.y;
    const prevTargetZ = controls.target.z;

    controls.update();

    const camChanged =
      Math.abs(camera.position.x - prevCamX) > 1e-6 ||
      Math.abs(camera.position.y - prevCamY) > 1e-6 ||
      Math.abs(camera.position.z - prevCamZ) > 1e-6 ||
      Math.abs(controls.target.x - prevTargetX) > 1e-6 ||
      Math.abs(controls.target.y - prevTargetY) > 1e-6 ||
      Math.abs(controls.target.z - prevTargetZ) > 1e-6;
    if (camChanged) cameraDirty = true;

    // 水平循环卷轴：当相机超出地图边界时回绕
    const halfW = MAP_WORLD_WIDTH / 2;
    if (controls.target.x > halfW) {
      const shift = MAP_WORLD_WIDTH;
      controls.target.x -= shift;
      camera.position.x -= shift;
    } else if (controls.target.x < -halfW) {
      const shift = MAP_WORLD_WIDTH;
      controls.target.x += shift;
      camera.position.x += shift;
    }

    const shouldPickActive = mouseDirty || cameraDirty;
    if (shouldPickActive) {
      picker.pick(timestamp);
      mouseDirty = false;
      cameraDirty = false;
      idlePickAccumulator = 0;
    } else {
      idlePickAccumulator += deltaTime;
      if (idlePickAccumulator >= IDLE_PICK_INTERVAL) {
        picker.pick(timestamp);
        idlePickAccumulator = 0;
      }
    }

    // 更新地形管理器：时间、相机位置、过渡动画
    terrainManager.updateCameraPos(camera.position);
    terrainManager.updateTime(elapsed, deltaTime);

    // 约每 30 帧评估一次并调整 DPR，避免频繁波动
    const fpsNow = deltaTime > 0 ? 1 / deltaTime : FPS_TARGET;
    dprAccumulator += fpsNow;
    dprSampleFrames += 1;

    if (dprCooldown > 0) {
      dprCooldown -= 1;
    } else if (dprSampleFrames >= 30) {
      const avgFps = dprAccumulator / dprSampleFrames;
      let nextDpr = dprCurrent;

      if (avgFps < FPS_LOW) {
        nextDpr = Math.max(DPR_MIN, dprCurrent - 0.08);
      } else if (avgFps > FPS_HIGH && dprCurrent < Math.min(window.devicePixelRatio, DPR_MAX)) {
        nextDpr = Math.min(Math.min(window.devicePixelRatio, DPR_MAX), dprCurrent + 0.05);
      }

      if (Math.abs(nextDpr - dprCurrent) > 1e-4) {
        dprCurrent = nextDpr;
        renderer.setPixelRatio(dprCurrent);
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        updateFxaaResolution();
      }

      // 仅在高帧率余量明显时开启 FXAA，低帧率时关闭
      fxaaPass.enabled = avgFps >= FPS_TARGET + 6;

      dprAccumulator = 0;
      dprSampleFrames = 0;
      dprCooldown = 20;
    }

    ui.updateFPS(timestamp);
    if (fxaaPass.enabled) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  animate();
  console.log('[Map] 应用启动完毕');
}

main().catch(console.error);
