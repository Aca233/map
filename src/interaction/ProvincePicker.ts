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

  /** 用于读取 State LUT 像素的 Canvas 上下文 */
  private stateCtx: CanvasRenderingContext2D | null = null;
  /** 用于读取 Strategic Region LUT 像素的 Canvas 上下文 */
  private strategicRegionCtx: CanvasRenderingContext2D | null = null;

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
  private pickInterval = 40; // ms

  constructor(
    camera: THREE.Camera,
    terrainManager: TerrainManager,
    store: ProvinceStore,
    provinceMapCanvas: HTMLCanvasElement,
    stateLutCanvas?: HTMLCanvasElement,
    strategicRegionLutCanvas?: HTMLCanvasElement
  ) {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = camera;
    this.terrainManager = terrainManager;
    this.store = store;

    this.provinceMapWidth = provinceMapCanvas.width;
    this.provinceMapHeight = provinceMapCanvas.height;
    this.provinceCtx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;

    if (stateLutCanvas) {
      this.stateCtx = stateLutCanvas.getContext('2d', { willReadFrequently: true })!;
    }
    if (strategicRegionLutCanvas) {
      this.strategicRegionCtx = strategicRegionLutCanvas.getContext('2d', { willReadFrequently: true })!;
    }
  }

  /** 更新鼠标位置（归一化到 -1~1） */
  updateMouse(clientX: number, clientY: number): void {
    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
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
        const px = Math.min(Math.floor(uv.x * this.provinceMapWidth), this.provinceMapWidth - 1);
        const py = Math.min(Math.floor(uv.y * this.provinceMapHeight), this.provinceMapHeight - 1);

        if (px >= 0 && px < this.provinceMapWidth && py >= 0 && py < this.provinceMapHeight) {
          const pixel = this.provinceCtx.getImageData(px, py, 1, 1).data;
          const r = pixel[0];
          const g = pixel[1];
          const b = pixel[2];

          // 调试：每次检测打印坐标
          if (force) {
            console.log(`[Pick] UV=(${uv.x.toFixed(4)}, ${uv.y.toFixed(4)}) → px=${px}, py=${py} → RGB=(${r},${g},${b})`);
          }

          const province = this.store.getProvinceByColor(r, g, b);

          if (province && province !== this.hoveredProvince) {
            this.hoveredProvince = province;

            // 查找对应的 State
            const state = province.stateId !== undefined
              ? this.store.getStateById(province.stateId)
              : undefined;
            this.hoveredState = state || null;

            // 查找对应海域（Strategic Region）
            const strategicRegion = this.store.getStrategicRegionByProvinceId(province.id);
            this.hoveredStrategicRegion = strategicRegion || null;

            // 设置 Province 级别悬停（保留）
            this.terrainManager.setHoveredProvince(r, g, b);

            // 设置 State 级别悬停（读取 State LUT 颜色）
            if (this.stateCtx && state) {
              const statePixel = this.stateCtx.getImageData(px, py, 1, 1).data;
              this.terrainManager.setHoveredState(statePixel[0], statePixel[1], statePixel[2]);
            } else {
              this.terrainManager.clearHoveredState();
            }

            if (this.strategicRegionCtx && strategicRegion) {
              const strategicPixel = this.strategicRegionCtx.getImageData(px, py, 1, 1).data;
              this.terrainManager.setHoveredStrategicRegion(strategicPixel[0], strategicPixel[1], strategicPixel[2]);
            } else {
              this.terrainManager.clearHoveredStrategicRegion();
            }

            if (this.onHover) this.onHover(province, this.hoveredState, this.hoveredStrategicRegion);
          } else if (!province && this.hoveredProvince) {
            this.hoveredProvince = null;
            this.hoveredState = null;
            this.hoveredStrategicRegion = null;
            this.terrainManager.clearHoveredProvince();
            this.terrainManager.clearHoveredState();
            this.terrainManager.clearHoveredStrategicRegion();
            if (this.onHover) this.onHover(null, null, null);
          }
        }
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
        // 使用当前 UV 位置读取 State LUT 颜色
        const uv = this._getLastUV();
        if (uv) {
          const px = Math.min(Math.floor(uv.x * this.provinceMapWidth), this.provinceMapWidth - 1);
          const py = Math.min(Math.floor(uv.y * this.provinceMapHeight), this.provinceMapHeight - 1);
          const statePixel = this.stateCtx.getImageData(px, py, 1, 1).data;
          this.terrainManager.setSelectedState(statePixel[0], statePixel[1], statePixel[2]);
        }
      } else {
        this.terrainManager.clearSelectedState();
      }

      if (this.strategicRegionCtx && this.selectedStrategicRegion) {
        // 使用当前 UV 位置读取 Strategic Region LUT 颜色
        const uv = this._getLastUV();
        if (uv) {
          const px = Math.min(Math.floor(uv.x * this.provinceMapWidth), this.provinceMapWidth - 1);
          const py = Math.min(Math.floor(uv.y * this.provinceMapHeight), this.provinceMapHeight - 1);
          const strategicPixel = this.strategicRegionCtx.getImageData(px, py, 1, 1).data;
          this.terrainManager.setSelectedStrategicRegion(strategicPixel[0], strategicPixel[1], strategicPixel[2]);
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
    // 重新执行一次 raycast 来获取 UV
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.terrainManager.getMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0 && intersects[0].uv) {
      return { x: intersects[0].uv.x, y: intersects[0].uv.y };
    }
    return null;
  }
}
