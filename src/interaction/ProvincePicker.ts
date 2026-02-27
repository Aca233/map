/**
 * Province / State 拾取器
 * 通过 Raycaster + Province Color Map 实现地块拾取
 * 支持 State（一级行政区）级别的悬停和选中
 */

import * as THREE from 'three';
import { ProvinceStore, ProvinceData, StateData, StrategicRegionData } from '../data/ProvinceStore';
import { TerrainManager } from '../terrain/TerrainManager';

export class ProvincePicker {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private camera: THREE.Camera;
  private terrainManager: TerrainManager;
  private store: ProvinceStore;

  /** 用于读取 Province Map 像素的 Canvas 上下文 */
  private provinceCtx: CanvasRenderingContext2D;
  private provinceMapWidth: number;
  private provinceMapHeight: number;
  private provincePixels!: Uint8ClampedArray;

  /** 用于读取 State LUT 像素的 Canvas 上下文 */
  private stateCtx: CanvasRenderingContext2D | null = null;
  private stateMapWidth = 0;
  private stateMapHeight = 0;
  private statePixels: Uint8ClampedArray | null = null;

  /** 用于读取 Strategic Region LUT 像素的 Canvas 上下文 */
  private strategicRegionCtx: CanvasRenderingContext2D | null = null;
  private strategicRegionMapWidth = 0;
  private strategicRegionMapHeight = 0;
  private strategicRegionPixels: Uint8ClampedArray | null = null;

  /** 视口尺寸提供器（用于将鼠标坐标归一化） */
  private getViewportSize: () => { width: number; height: number } = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  /** 当前悬停的地块 */
  public hoveredProvince: ProvinceData | null = null;
  /** 当前选中的地块 */
  public selectedProvince: ProvinceData | null = null;
  /** 当前悬停的 State */
  public hoveredState: StateData | null = null;
  /** 当前选中的 State */
  public selectedState: StateData | null = null;
  /** 当前悬停的海域（Strategic Region） */
  public hoveredStrategicRegion: StrategicRegionData | null = null;
  /** 当前选中的海域（Strategic Region） */
  public selectedStrategicRegion: StrategicRegionData | null = null;

  /** 事件回调 */
  public onHover: ((province: ProvinceData | null, state: StateData | null, strategicRegion: StrategicRegionData | null) => void) | null = null;
  public onSelect: ((province: ProvinceData | null, state: StateData | null, strategicRegion: StrategicRegionData | null) => void) | null = null;

  /** 节流控制 */
  private lastPickTime = 0;
  private pickInterval = 60; // ms（帧率优先）
  private readonly colorSampleStride = 2; // 默认拾取：按 2px 网格采样（mousemove 性能优先）

  constructor(
    camera: THREE.Camera,
    terrainManager: TerrainManager,
    store: ProvinceStore,
    provinceMapCanvas: HTMLCanvasElement,
    stateLutCanvas?: HTMLCanvasElement,
    strategicRegionLutCanvas?: HTMLCanvasElement,
    options?: { viewportSize?: () => { width: number; height: number } }
  ) {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = camera;
    this.terrainManager = terrainManager;
    this.store = store;

    this.provinceMapWidth = provinceMapCanvas.width;
    this.provinceMapHeight = provinceMapCanvas.height;
    this.provinceCtx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;
    this.provincePixels = this.provinceCtx.getImageData(0, 0, this.provinceMapWidth, this.provinceMapHeight).data;

    if (stateLutCanvas) {
      this.stateCtx = stateLutCanvas.getContext('2d', { willReadFrequently: true })!;
      this.stateMapWidth = stateLutCanvas.width;
      this.stateMapHeight = stateLutCanvas.height;
      this.statePixels = this.stateCtx.getImageData(0, 0, this.stateMapWidth, this.stateMapHeight).data;
    }
    if (strategicRegionLutCanvas) {
      this.strategicRegionCtx = strategicRegionLutCanvas.getContext('2d', { willReadFrequently: true })!;
      this.strategicRegionMapWidth = strategicRegionLutCanvas.width;
      this.strategicRegionMapHeight = strategicRegionLutCanvas.height;
      this.strategicRegionPixels = this.strategicRegionCtx.getImageData(0, 0, this.strategicRegionMapWidth, this.strategicRegionMapHeight).data;
    }

    if (options?.viewportSize) {
      this.getViewportSize = options.viewportSize;
    }
  }

  /** 更新鼠标位置（归一化到 -1~1） */
  updateMouse(clientX: number, clientY: number): void {
    const viewport = this.getViewportSize();
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);

    this.mouse.x = (clientX / width) * 2 - 1;
    this.mouse.y = -(clientY / height) * 2 + 1;
  }

  /** 执行拾取（在 mousemove 中调用，带节流） */
  pick(timestamp: number, force: boolean = false): void {
    if (!force && timestamp - this.lastPickTime < this.pickInterval) return;
    this.lastPickTime = timestamp;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = this.terrainManager.getMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const uv = hit.uv;

      if (uv) {
        const rawPx = Math.min(Math.floor(uv.x * this.provinceMapWidth), this.provinceMapWidth - 1);
        const rawPy = Math.min(Math.floor(uv.y * this.provinceMapHeight), this.provinceMapHeight - 1);
        const resolved = this._resolveProvincePixel(rawPx, rawPy, force);

        if (resolved) {
          const { province, px, py, r, g, b } = resolved;
          const sampleU = (px + 0.5) / this.provinceMapWidth;
          const sampleV = (py + 0.5) / this.provinceMapHeight;
          this.lastUV = { x: sampleU, y: sampleV };

          // 调试：点击时打印原始像素与纠偏后像素
          if (force) {
            console.log(`[Pick] UV=(${uv.x.toFixed(4)}, ${uv.y.toFixed(4)}) raw=(${rawPx},${rawPy}) -> resolved=(${px},${py}) RGB=(${r},${g},${b}) province=${province.id}`);
          }

          // force=true（点击前强制 pick）时即使省份未变化也刷新一次，避免边界附近点击反馈滞后
          const shouldRefreshHover = force || province !== this.hoveredProvince;
          if (shouldRefreshHover) {
            this.hoveredProvince = province;

            const isSeaProvince = province.type === 'sea' || province.type === 'lake';

            // 查找对应的 State（仅陆地）
            const state = !isSeaProvince && province.stateId !== undefined
              ? this.store.getStateById(province.stateId)
              : undefined;
            this.hoveredState = state || null;

            // 查找对应海域（Strategic Region，仅海域）
            const strategicRegion = isSeaProvince
              ? this.store.getStrategicRegionByProvinceId(province.id)
              : undefined;
            this.hoveredStrategicRegion = strategicRegion || null;

            // 设置 Province 级别悬停（保留）
            this.terrainManager.setHoveredProvince(r, g, b);

            const lutSampleStride = force ? 1 : this.colorSampleStride;

            // 设置 State 级别悬停（读取 State LUT 缓存像素）
            if (this.stateCtx && state) {
              const stateRgb = this._sampleRgbFromPixels(
                this.statePixels,
                this.stateMapWidth,
                this.stateMapHeight,
                sampleU,
                sampleV,
                lutSampleStride
              );
              if (stateRgb) {
                this.terrainManager.setHoveredState(stateRgb[0], stateRgb[1], stateRgb[2]);
              } else {
                this.terrainManager.clearHoveredState();
              }
            } else {
              this.terrainManager.clearHoveredState();
            }

            if (this.strategicRegionCtx && isSeaProvince && strategicRegion) {
              const strategicRgb = this._sampleRgbFromPixels(
                this.strategicRegionPixels,
                this.strategicRegionMapWidth,
                this.strategicRegionMapHeight,
                sampleU,
                sampleV,
                lutSampleStride
              );
              if (strategicRgb) {
                this.terrainManager.setHoveredStrategicRegion(strategicRgb[0], strategicRgb[1], strategicRgb[2]);
              } else {
                this.terrainManager.clearHoveredStrategicRegion();
              }
            } else {
              this.terrainManager.clearHoveredStrategicRegion();
            }

            // 以 Province 高亮作为主反馈源，避免 clearHoveredState/StrategicRegion 把 hoverTarget 拉回 0
            this.terrainManager.setHoveredProvince(r, g, b);

            if (this.onHover) this.onHover(province, this.hoveredState, this.hoveredStrategicRegion);
          }
        } else if (this.hoveredProvince) {
          this.hoveredProvince = null;
          this.hoveredState = null;
          this.hoveredStrategicRegion = null;
          this.terrainManager.clearHoveredProvince();
          this.terrainManager.clearHoveredState();
          this.terrainManager.clearHoveredStrategicRegion();
          if (this.onHover) this.onHover(null, null, null);
        }
      } else {
        this.lastUV = null;
      }
    } else {
      if (this.hoveredProvince) {
        this.hoveredProvince = null;
        this.hoveredState = null;
        this.hoveredStrategicRegion = null;
        this.terrainManager.clearHoveredProvince();
        this.terrainManager.clearHoveredState();
        this.terrainManager.clearHoveredStrategicRegion();
        if (this.onHover) this.onHover(null, null, null);
      }
      this.lastUV = null;
    }
  }

  /** 点击选中 */
  select(): void {
    if (this.hoveredProvince) {
      this.selectedProvince = this.hoveredProvince;
      this.selectedState = this.hoveredState;
      this.selectedStrategicRegion = this.hoveredStrategicRegion;
      const [r, g, b] = this.selectedProvince.color;
      this.terrainManager.setSelectedProvince(r, g, b);

      // 设置 State 级别选中
      if (this.stateCtx && this.selectedState) {
        // 使用缓存的 UV 位置读取 State LUT 颜色
        const uv = this._getLastUV();
        if (uv) {
          const stateRgb = this._sampleRgbFromPixels(
            this.statePixels,
            this.stateMapWidth,
            this.stateMapHeight,
            uv.x,
            uv.y,
            1
          );
          if (stateRgb) {
            this.terrainManager.setSelectedState(stateRgb[0], stateRgb[1], stateRgb[2]);
          } else {
            this.terrainManager.clearSelectedState();
          }
        } else {
          this.terrainManager.clearSelectedState();
        }
      } else {
        this.terrainManager.clearSelectedState();
      }

      if (this.strategicRegionCtx && this.selectedStrategicRegion && this.selectedProvince.type !== 'land') {
        // 使用缓存的 UV 位置读取 Strategic Region LUT 颜色
        const uv = this._getLastUV();
        if (uv) {
          const strategicRgb = this._sampleRgbFromPixels(
            this.strategicRegionPixels,
            this.strategicRegionMapWidth,
            this.strategicRegionMapHeight,
            uv.x,
            uv.y,
            1
          );
          if (strategicRgb) {
            this.terrainManager.setSelectedStrategicRegion(strategicRgb[0], strategicRgb[1], strategicRgb[2]);
          } else {
            this.terrainManager.clearSelectedStrategicRegion();
          }
        } else {
          this.terrainManager.clearSelectedStrategicRegion();
        }
      } else {
        this.terrainManager.clearSelectedStrategicRegion();
      }

      if (this.onSelect) this.onSelect(this.selectedProvince, this.selectedState, this.selectedStrategicRegion);
    } else {
      this.selectedProvince = null;
      this.selectedState = null;
      this.selectedStrategicRegion = null;
      this.terrainManager.clearSelectedProvince();
      this.terrainManager.clearSelectedState();
      this.terrainManager.clearSelectedStrategicRegion();
      if (this.onSelect) this.onSelect(null, null, null);
    }
  }

  /** 缓存最后一次拾取的 UV */
  private lastUV: { x: number; y: number } | null = null;

  private _getLastUV(): { x: number; y: number } | null {
    return this.lastUV;
  }

  private _sampleRgbFromPixels(
    pixels: Uint8ClampedArray | null,
    width: number,
    height: number,
    u: number,
    v: number,
    sampleStride: number = this.colorSampleStride
  ): [number, number, number] | null {
    if (!pixels || width <= 0 || height <= 0) return null;

    const rawPx = Math.max(0, Math.min(width - 1, Math.floor(u * width)));
    const rawPy = Math.max(0, Math.min(height - 1, Math.floor(v * height)));
    const px = this._quantizePixel(rawPx, width, sampleStride);
    const py = this._quantizePixel(rawPy, height, sampleStride);
    const idx = (py * width + px) * 4;

    return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
  }

  private _resolveProvincePixel(
    rawPx: number,
    rawPy: number,
    force: boolean
  ): { province: ProvinceData; px: number; py: number; r: number; g: number; b: number } | null {
    const x = Math.max(0, Math.min(this.provinceMapWidth - 1, rawPx));
    const y = Math.max(0, Math.min(this.provinceMapHeight - 1, rawPy));

    const sampleAt = (sx: number, sy: number): { province: ProvinceData; px: number; py: number; r: number; g: number; b: number } | null => {
      const cx = Math.max(0, Math.min(this.provinceMapWidth - 1, sx));
      const cy = Math.max(0, Math.min(this.provinceMapHeight - 1, sy));
      const idx = (cy * this.provinceMapWidth + cx) * 4;
      const r = this.provincePixels[idx];
      const g = this.provincePixels[idx + 1];
      const b = this.provincePixels[idx + 2];
      const province = this.store.getProvinceByColor(r, g, b);
      if (!province) return null;
      return { province, px: cx, py: cy, r, g, b };
    };

    // 常规拾取：保持 stride 量化（性能优先）
    if (!force) {
      const px = this._quantizePixel(x, this.provinceMapWidth, this.colorSampleStride);
      const py = this._quantizePixel(y, this.provinceMapHeight, this.colorSampleStride);
      return sampleAt(px, py);
    }

    // 强制拾取（点击）：优先中心像素，避免小陆地省份被邻域多数像素“吞掉”
    const center = sampleAt(x, y);
    if (center) return center;

    // 若中心像素无有效省份（边界/异常像素），再按距离从近到远搜索
    const maxRadius = 3;
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best: { province: ProvinceData; px: number; py: number; r: number; g: number; b: number } | null = null;
      let bestDist2 = Number.POSITIVE_INFINITY;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const hit = sampleAt(x + dx, y + dy);
          if (!hit) continue;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < bestDist2) {
            bestDist2 = dist2;
            best = hit;
          }
        }
      }

      if (best) return best;
    }

    return null;
  }

  private _quantizePixel(value: number, size: number, sampleStride: number = this.colorSampleStride): number {
    const stride = sampleStride;
    if (stride <= 1) return Math.max(0, Math.min(size - 1, value));
    const q = Math.floor(value / stride) * stride;
    return Math.max(0, Math.min(size - 1, q));
  }
}
