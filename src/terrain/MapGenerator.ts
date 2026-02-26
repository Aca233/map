// @ts-nocheck
/**
 * 程序化地图生成器（旧版，已废弃）
 * 使用噪声函数生成高度图，使用 Voronoi 分区生成地块颜色图
 * 现在使用 HOI4 真实数据，此文件仅作参考保留
 */

import { ProvinceStore, ProvinceData } from '../data/ProvinceStore';
import { idToRgb } from '../utils/ColorUtils';

// ===== Simplex Noise 实现 =====
// 简化版 2D Simplex Noise（自包含，无外部依赖）

class SimplexNoise {
  private perm: Uint8Array;
  private grad3: number[][];

  constructor(seed: number = 42) {
    this.grad3 = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ];

    const p = new Uint8Array(256);
    // 使用 seed 生成伪随机排列
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private dot2(g: number[], x: number, y: number): number {
    return g[0] * x + g[1] * y;
  }

  noise2D(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;

    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.perm[ii + this.perm[jj]] % 12;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;

    let n0: number, n1: number, n2: number;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else { t0 *= t0; n0 = t0 * t0 * this.dot2(this.grad3[gi0], x0, y0); }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else { t1 *= t1; n1 = t1 * t1 * this.dot2(this.grad3[gi1], x1, y1); }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else { t2 *= t2; n2 = t2 * t2 * this.dot2(this.grad3[gi2], x2, y2); }

    return 70.0 * (n0 + n1 + n2);
  }

  /** 多层分形噪声 (FBM) */
  fbm(x: number, y: number, octaves: number = 6, lacunarity: number = 2.0, gain: number = 0.5): number {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

// ===== 地图生成 =====

export interface MapTextures {
  heightmapData: ImageData;
  heightmapCanvas: HTMLCanvasElement;
  provinceMapData: ImageData;
  provinceMapCanvas: HTMLCanvasElement;
  /** 国家颜色 LUT 纹理数据（256x1 RGBA） */
  countryLutData: ImageData;
  countryLutCanvas: HTMLCanvasElement;
}

export interface VoronoiSeed {
  x: number;
  y: number;
  provinceId: number;
  isLand: boolean;
  countryCode: string;
}

/**
 * 生成完整的地图纹理数据
 */
export function generateMapTextures(
  width: number,
  height: number,
  provinceCount: number,
  store: ProvinceStore
): MapTextures {
  const noise = new SimplexNoise(12345);

  // 1. 生成高度图
  const heightmapCanvas = document.createElement('canvas');
  heightmapCanvas.width = width;
  heightmapCanvas.height = height;
  const heightCtx = heightmapCanvas.getContext('2d')!;
  const heightmapData = heightCtx.createImageData(width, height);

  // 2. 生成 Province Map
  const provinceCanvas = document.createElement('canvas');
  provinceCanvas.width = width;
  provinceCanvas.height = height;
  const provinceCtx = provinceCanvas.getContext('2d')!;
  const provinceMapData = provinceCtx.createImageData(width, height);

  // ===== Step 1: 生成高度场 =====
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;

      // 基础大陆形状：使用多层噪声
      let h = noise.fbm(nx * 4, ny * 4, 6, 2.0, 0.5);

      // 添加大尺度的大陆轮廓
      const continent = noise.fbm(nx * 1.5 + 100, ny * 1.5 + 100, 3, 2.0, 0.6);

      // 混合：大陆轮廓决定基础海拔
      h = h * 0.4 + continent * 0.6;

      // 将范围从 [-1, 1] 映射到 [0, 1]
      h = (h + 1.0) * 0.5;

      // 应用海平面：低于 0.4 的区域为海洋
      const seaLevel = 0.38;
      if (h < seaLevel) {
        // 海洋深度
        h = h * 0.6;
      } else {
        // 陆地：拉伸高度范围
        h = seaLevel * 0.6 + (h - seaLevel) * 1.5;
      }

      h = Math.max(0, Math.min(1, h));
      heightField[y * width + x] = h;

      // 写入高度图像素
      const idx = (y * width + x) * 4;
      const v = Math.floor(h * 255);
      heightmapData.data[idx] = v;
      heightmapData.data[idx + 1] = v;
      heightmapData.data[idx + 2] = v;
      heightmapData.data[idx + 3] = 255;
    }
  }

  // ===== Step 2: 生成 Voronoi 种子点 + Province Map =====
  const seeds: VoronoiSeed[] = [];
  const landCountries = store.getLandCountries();
  const seaLevel = 0.38 * 0.6; // 与上面的海平面计算保持一致

  // 生成种子点，使用泊松盘采样近似（简化版：在网格中随机抖动）
  const gridCols = Math.ceil(Math.sqrt(provinceCount * 2)); // 宽是高的两倍
  const gridRows = Math.ceil(gridCols / 2);
  const cellW = width / gridCols;
  const cellH = height / gridRows;

  let idCounter = 1;
  const rng = mulberry32(54321); // 可重复的随机数

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      if (idCounter > provinceCount) break;

      // 在单元格内随机抖动
      const sx = (col + 0.1 + rng() * 0.8) * cellW;
      const sy = (row + 0.1 + rng() * 0.8) * cellH;
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);

      if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

      const h = heightField[iy * width + ix];
      const isLand = h > seaLevel;

      // 为陆地地块分配国家
      let countryCode = 'SEA';
      if (isLand) {
        // 根据位置分配国家（简单的区域划分）
        const regionX = Math.floor(col / (gridCols / 4));
        const regionY = Math.floor(row / (gridRows / 2));
        const regionIdx = (regionY * 4 + regionX) % landCountries.length;
        countryCode = landCountries[regionIdx].code;
      }

      seeds.push({
        x: sx,
        y: sy,
        provinceId: idCounter,
        isLand,
        countryCode,
      });

      // 注册地块数据
      const [r, g, b] = idToRgb(idCounter);
      const terrains = ['plains', 'hills', 'mountains', 'forest', 'desert', 'tundra'];
      const terrain = isLand ? terrains[Math.floor(rng() * terrains.length)] : 'ocean';

      store.registerProvince({
        id: idCounter,
        name: isLand
          ? `Province ${idCounter}`
          : `Sea Zone ${idCounter}`,
        owner: countryCode,
        type: isLand ? 'land' : 'sea',
        terrain,
        population: isLand ? Math.floor(rng() * 5000000 + 100000) : 0,
        color: [r, g, b],
      });

      idCounter++;
    }
  }

  // 为每个像素找到最近的种子点（Voronoi）
  // 使用简化的方法：为每个像素搜索附近的种子
  // 建立种子的空间索引
  const seedGrid: VoronoiSeed[][][] = [];
  const sgCols = Math.ceil(width / cellW);
  const sgRows = Math.ceil(height / cellH);
  for (let r = 0; r < sgRows; r++) {
    seedGrid[r] = [];
    for (let c = 0; c < sgCols; c++) {
      seedGrid[r][c] = [];
    }
  }
  for (const seed of seeds) {
    const sc = Math.floor(seed.x / cellW);
    const sr = Math.floor(seed.y / cellH);
    if (sr >= 0 && sr < sgRows && sc >= 0 && sc < sgCols) {
      seedGrid[sr][sc].push(seed);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 找附近 3x3 网格内最近的种子
      const gc = Math.floor(x / cellW);
      const gr = Math.floor(y / cellH);

      let minDist = Infinity;
      let closestSeed: VoronoiSeed | null = null;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = gr + dr;
          const nc = gc + dc;
          if (nr < 0 || nr >= sgRows || nc < 0 || nc >= sgCols) continue;
          for (const seed of seedGrid[nr][nc]) {
            const dx = x - seed.x;
            const dy = y - seed.y;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
              minDist = dist;
              closestSeed = seed;
            }
          }
        }
      }

      const idx = (y * width + x) * 4;
      if (closestSeed) {
        const [r, g, b] = idToRgb(closestSeed.provinceId);
        provinceMapData.data[idx] = r;
        provinceMapData.data[idx + 1] = g;
        provinceMapData.data[idx + 2] = b;
        provinceMapData.data[idx + 3] = 255;
      } else {
        // 没有找到种子点，使用 0
        provinceMapData.data[idx] = 0;
        provinceMapData.data[idx + 1] = 0;
        provinceMapData.data[idx + 2] = 0;
        provinceMapData.data[idx + 3] = 255;
      }
    }
  }

  // ===== Step 3: 生成国家颜色 LUT =====
  // 格式：256x(provinceCount/256+1) RGBA 纹理
  // 每个像素存储该 Province 对应国家的颜色
  const lutSize = Math.max(256, idCounter);
  const lutCanvas = document.createElement('canvas');
  lutCanvas.width = lutSize;
  lutCanvas.height = 1;
  const lutCtx = lutCanvas.getContext('2d')!;
  const lutData = lutCtx.createImageData(lutSize, 1);

  for (let i = 0; i < idCounter; i++) {
    const province = store.getProvinceById(i);
    if (province) {
      const country = store.getCountry(province.owner);
      if (country) {
        lutData.data[i * 4] = Math.floor(country.color[0] * 255);
        lutData.data[i * 4 + 1] = Math.floor(country.color[1] * 255);
        lutData.data[i * 4 + 2] = Math.floor(country.color[2] * 255);
        lutData.data[i * 4 + 3] = 255;
      }
    }
  }

  // 写回 canvas
  heightCtx.putImageData(heightmapData, 0, 0);
  provinceCtx.putImageData(provinceMapData, 0, 0);
  lutCtx.putImageData(lutData, 0, 0);

  return {
    heightmapData,
    heightmapCanvas: heightmapCanvas,
    provinceMapData,
    provinceMapCanvas: provinceCanvas,
    countryLutData: lutData,
    countryLutCanvas: lutCanvas,
  };
}

/** Mulberry32 伪随机数生成器（可重复） */
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
