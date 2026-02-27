/**
 * Province 数据仓库（HOI4 数据版本）
 * 从转换后的 JSON 文件加载真实 HOI4 地块和国家数据
 * 增加 State（一级行政区）支持
 */

import { rgbToId } from '../utils/ColorUtils';

export interface ProvinceData {
  id: number;
  name: string;
  owner: string;
  type: 'land' | 'sea' | 'lake';
  terrain: string;
  population: number;
  color: [number, number, number]; // RGB 0-255
  isCoastal: boolean;
  continent: number;
  stateName?: string;
  stateId?: number;
  strategicRegionId?: number;
  strategicRegionName?: string;
}

export interface CountryData {
  code: string;
  name: string;
  color: [number, number, number]; // RGB 0-1 归一化
}

export interface StateData {
  id: number;
  name: string;         // 原始键名 STATE_xxx
  localName: string;    // 中文名
  owner: string;        // 所属国家
  provinces: number[];  // 包含的省份 ID
  manpower: number;     // 人口
  category: string;     // 类别: town/city/metropolis 等
  victoryPoints: Record<number, number>; // 胜利点
  cores: string[];      // 核心领土国家
}

export interface StrategicRegionData {
  id: number;
  name: string;              // 原始键名 STRATEGICREGION_xxx
  localName: string;         // 中文名
  provinces: number[];       // 包含的省份 ID
  navalTerrain: string | null;
  isSeaRegion: boolean;
}

interface RawProvince {
  id: number;
  r: number; g: number; b: number;
  type: string;
  isCoastal: boolean;
  terrain: string;
  continent: number;
}

interface StatesData {
  states: Record<string, {
    id: number; name: string; localName?: string; owner: string;
    provinces: number[]; manpower?: number; category?: string;
    victoryPoints?: Record<string, number>; cores?: string[];
  }>;
  provinceToOwner: Record<string, string>;
  provinceToState: Record<string, number>;
  strategicRegions?: Record<string, {
    id: number;
    name: string;
    localName?: string;
    provinces: number[];
    navalTerrain?: string | null;
    isSeaRegion?: boolean;
  }>;
  provinceToStrategicRegion?: Record<string, number>;
  countries: Record<string, { code: string; name: string; color: [number, number, number] }>;
}

function assetUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}assets/${fileName}`;
}

export class ProvinceStore {
  private provinces = new Map<number, ProvinceData>();
  private colorToId = new Map<number, number>();
  private countries = new Map<string, CountryData>();
  private states = new Map<number, StateData>();
  private provinceToStateMap = new Map<number, number>();
  private strategicRegions = new Map<number, StrategicRegionData>();
  private provinceToStrategicRegionMap = new Map<number, number>();

  /** 异步加载 HOI4 数据 */
  async loadFromHOI4Data(options?: { provincesUrl?: string; statesUrl?: string }): Promise<void> {
    const provincesUrl = options?.provincesUrl || assetUrl('provinces.json');
    const statesUrl = options?.statesUrl || assetUrl('states.json');

    console.log('[ProvinceStore] 正在加载 HOI4 地块数据...', {
      provincesUrl,
      statesUrl,
    });

    // 并行加载 provinces.json 和 states.json
    const [provResponse, statesResponse] = await Promise.all([
      fetch(provincesUrl),
      fetch(statesUrl),
    ]);

    if (!provResponse.ok) {
      throw new Error(`[ProvinceStore] provinces.json 加载失败: ${provResponse.status} ${provResponse.statusText}`);
    }
    if (!statesResponse.ok) {
      throw new Error(`[ProvinceStore] states.json 加载失败: ${statesResponse.status} ${statesResponse.statusText}`);
    }

    const rawProvinces: Record<string, RawProvince> = await provResponse.json();
    const statesData: StatesData = await statesResponse.json();

    // 注册国家
    // 添加海洋/湖泊的"国家"
    this.countries.set('SEA', { code: 'SEA', name: '海洋', color: [0.15, 0.25, 0.45] });
    this.countries.set('LAKE', { code: 'LAKE', name: '湖泊', color: [0.2, 0.35, 0.55] });
    this.countries.set('NONE', { code: 'NONE', name: '无主之地', color: [0.4, 0.4, 0.4] });

    for (const [code, country] of Object.entries(statesData.countries)) {
      this.countries.set(code, {
        code: country.code,
        name: country.name,
        color: country.color as [number, number, number],
      });
    }

    // 注册 States
    for (const [idStr, rawState] of Object.entries(statesData.states)) {
      const stateId = parseInt(idStr);
      const vp: Record<number, number> = {};
      if (rawState.victoryPoints) {
        for (const [k, v] of Object.entries(rawState.victoryPoints)) {
          vp[parseInt(k)] = v as number;
        }
      }
      const state: StateData = {
        id: stateId,
        name: rawState.name,
        localName: rawState.localName || rawState.name,
        owner: rawState.owner,
        provinces: rawState.provinces,
        manpower: rawState.manpower || 0,
        category: rawState.category || 'wasteland',
        victoryPoints: vp,
        cores: rawState.cores || [],
      };
      this.states.set(stateId, state);
    }

    // 建立省份→State 映射
    if (statesData.provinceToState) {
      for (const [provIdStr, stateId] of Object.entries(statesData.provinceToState)) {
        this.provinceToStateMap.set(parseInt(provIdStr), stateId);
      }
    }

    // 注册 Strategic Regions
    if (statesData.strategicRegions) {
      for (const [idStr, rawRegion] of Object.entries(statesData.strategicRegions)) {
        const regionId = parseInt(idStr);
        const region: StrategicRegionData = {
          id: regionId,
          name: rawRegion.name,
          localName: rawRegion.localName || rawRegion.name,
          provinces: rawRegion.provinces,
          navalTerrain: rawRegion.navalTerrain ?? null,
          isSeaRegion: rawRegion.isSeaRegion ?? !!rawRegion.navalTerrain,
        };
        this.strategicRegions.set(regionId, region);
      }
    }

    // 建立省份→Strategic Region 映射
    if (statesData.provinceToStrategicRegion) {
      for (const [provIdStr, regionId] of Object.entries(statesData.provinceToStrategicRegion)) {
        this.provinceToStrategicRegionMap.set(parseInt(provIdStr), regionId);
      }
    }

    // 建立省份→State 名称映射
    const provinceToStateName: Record<number, string> = {};
    for (const state of this.states.values()) {
      for (const provId of state.provinces) {
        provinceToStateName[provId] = state.localName;
      }
    }

    // 建立省份→海域名称映射
    const provinceToStrategicRegionName: Record<number, string> = {};
    for (const region of this.strategicRegions.values()) {
      for (const provId of region.provinces) {
        provinceToStrategicRegionName[provId] = region.localName;
      }
    }

    // 注册所有地块
    let registered = 0;
    for (const raw of Object.values(rawProvinces)) {
      const owner = statesData.provinceToOwner[String(raw.id)] ||
        (raw.type === 'sea' ? 'SEA' : raw.type === 'lake' ? 'LAKE' : 'NONE');

      const stateId = this.provinceToStateMap.get(raw.id);
      const strategicRegionId = this.provinceToStrategicRegionMap.get(raw.id);

      const province: ProvinceData = {
        id: raw.id,
        name: provinceToStateName[raw.id] || `Province ${raw.id}`,
        owner,
        type: raw.type as 'land' | 'sea' | 'lake',
        terrain: raw.terrain,
        population: 0, // HOI4 需要从其他文件读取，暂时设为 0
        color: [raw.r, raw.g, raw.b],
        isCoastal: raw.isCoastal,
        continent: raw.continent,
        stateName: provinceToStateName[raw.id],
        stateId,
        strategicRegionId,
        strategicRegionName: provinceToStrategicRegionName[raw.id],
      };

      this.provinces.set(raw.id, province);
      const colorKey = rgbToId(raw.r, raw.g, raw.b);
      this.colorToId.set(colorKey, raw.id);
      registered++;
    }

    console.log(`[ProvinceStore] 已加载 ${registered} 个地块, ${this.countries.size} 个国家, ${this.states.size} 个行政区, ${this.strategicRegions.size} 个海域`);
  }

  getProvinceByColor(r: number, g: number, b: number): ProvinceData | undefined {
    const key = rgbToId(r, g, b);
    const id = this.colorToId.get(key);
    if (id === undefined) return undefined;
    return this.provinces.get(id);
  }

  getProvinceById(id: number): ProvinceData | undefined {
    return this.provinces.get(id);
  }

  getCountry(code: string): CountryData | undefined {
    return this.countries.get(code);
  }

  getAllCountries(): CountryData[] {
    return Array.from(this.countries.values());
  }

  getAllProvinces(): ProvinceData[] {
    return Array.from(this.provinces.values());
  }

  getLandCountries(): CountryData[] {
    return this.getAllCountries().filter(c => c.code !== 'SEA' && c.code !== 'LAKE' && c.code !== 'NONE');
  }

  // ===== State 相关方法 =====

  getStateById(id: number): StateData | undefined {
    return this.states.get(id);
  }

  getStateByProvinceId(provId: number): StateData | undefined {
    const stateId = this.provinceToStateMap.get(provId);
    if (stateId === undefined) return undefined;
    return this.states.get(stateId);
  }

  getAllStates(): StateData[] {
    return Array.from(this.states.values());
  }

  getStatesByCountry(countryCode: string): StateData[] {
    return this.getAllStates().filter(s => s.owner === countryCode);
  }

  // ===== Strategic Region 相关方法 =====

  getStrategicRegionById(id: number): StrategicRegionData | undefined {
    return this.strategicRegions.get(id);
  }

  getStrategicRegionByProvinceId(provId: number): StrategicRegionData | undefined {
    const regionId = this.provinceToStrategicRegionMap.get(provId);
    if (regionId === undefined) return undefined;
    return this.strategicRegions.get(regionId);
  }

  getAllStrategicRegions(): StrategicRegionData[] {
    return Array.from(this.strategicRegions.values());
  }

  /**
   * 为 ID 生成唯一确定性颜色（用于 LUT 纹理）
   * 直接将 ID 编码到 R/G 通道，B 通道固定为 128 作为标记
   * 保证 ID 0-65535 范围内无碰撞
   */
  private encodeIdToColor(id: number): [number, number, number] {
    const r = (id >> 8) & 0xFF;   // 高 8 位
    const g = id & 0xFF;          // 低 8 位
    const b = 128;                // 固定标记
    return [r, g, b];
  }

  /**
   * 生成 State LUT 纹理（与 province map 同尺寸）
   * 每个像素颜色 = 该省份所属 State 的唯一颜色
   * 用于着色器中检测 State 边界和 State 模式着色
   */
  generateStateLUT(provinceMapCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const w = provinceMapCanvas.width;
    const h = provinceMapCanvas.height;
    const ctx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, w, h);

    const lutCanvas = document.createElement('canvas');
    lutCanvas.width = w;
    lutCanvas.height = h;
    const lutCtx = lutCanvas.getContext('2d')!;
    const lutData = lutCtx.createImageData(w, h);

    // 缓存 State 颜色（避免重复计算）
    const stateColorCache = new Map<number, [number, number, number]>();
    for (const state of this.states.values()) {
      stateColorCache.set(state.id, this.encodeIdToColor(state.id));
    }

    let mappedCount = 0;
    let unmappedCount = 0;

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      const province = this.getProvinceByColor(r, g, b);
      if (province && province.stateId !== undefined) {
        const stateColor = stateColorCache.get(province.stateId);
        if (stateColor) {
          lutData.data[i] = stateColor[0];
          lutData.data[i + 1] = stateColor[1];
          lutData.data[i + 2] = stateColor[2];
          lutData.data[i + 3] = 255;
          mappedCount++;
          continue;
        }
      }

      // 海洋/未知 → 使用特殊颜色（0,0,0 = 无 State）
      lutData.data[i] = 0;
      lutData.data[i + 1] = 0;
      lutData.data[i + 2] = 0;
      lutData.data[i + 3] = 255;
      unmappedCount++;
    }

    lutCtx.putImageData(lutData, 0, 0);
    console.log(`[ProvinceStore] State LUT 生成完成: ${mappedCount} 已映射, ${unmappedCount} 未映射`);
    return lutCanvas;
  }

  /**
   * 生成 Strategic Region LUT 纹理（与 province map 同尺寸）
   * 每个像素颜色 = 该省份所属 Strategic Region 的唯一颜色
   * 用于海域边界检测与海域级高亮
   */
  generateStrategicRegionLUT(provinceMapCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const w = provinceMapCanvas.width;
    const h = provinceMapCanvas.height;
    const ctx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, w, h);

    const lutCanvas = document.createElement('canvas');
    lutCanvas.width = w;
    lutCanvas.height = h;
    const lutCtx = lutCanvas.getContext('2d')!;
    const lutData = lutCtx.createImageData(w, h);

    // 缓存 Strategic Region 颜色（避免重复计算）
    const regionColorCache = new Map<number, [number, number, number]>();
    for (const region of this.strategicRegions.values()) {
      regionColorCache.set(region.id, this.encodeIdToColor(region.id));
    }

    let mappedCount = 0;
    let unmappedCount = 0;

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      const province = this.getProvinceByColor(r, g, b);
      if (province && province.strategicRegionId !== undefined) {
        const regionColor = regionColorCache.get(province.strategicRegionId);
        if (regionColor) {
          lutData.data[i] = regionColor[0];
          lutData.data[i + 1] = regionColor[1];
          lutData.data[i + 2] = regionColor[2];
          lutData.data[i + 3] = 255;
          mappedCount++;
          continue;
        }
      }

      // 未知区域 → 使用特殊颜色（0,0,0 = 无 Strategic Region）
      lutData.data[i] = 0;
      lutData.data[i + 1] = 0;
      lutData.data[i + 2] = 0;
      lutData.data[i + 3] = 255;
      unmappedCount++;
    }

    lutCtx.putImageData(lutData, 0, 0);
    console.log(`[ProvinceStore] Strategic Region LUT 生成完成: ${mappedCount} 已映射, ${unmappedCount} 未映射`);
    return lutCanvas;
  }

  /** 为 Shader 生成国家颜色 LUT 纹理数据 */
  generateCountryLUT(provinceMapCanvas: HTMLCanvasElement): HTMLCanvasElement {
    // 使用 province map 中的所有像素颜色，为每个 province 生成对应国家颜色
    // 由于 province ID 可能很大（上万），我们不能直接用 ID 作为纹理坐标
    // 改为使用 RGB 直接映射的方式在 Shader 中查找

    // 创建一个 256x256x3 的查找表纹理
    // 索引: R=高字节, G+B 编码为 Y 坐标
    // 这样任何 RGB 颜色都可以找到对应的国家颜色

    // 更简单的方案：生成一个与 province map 同尺寸的"国家颜色图"
    const w = provinceMapCanvas.width;
    const h = provinceMapCanvas.height;
    const ctx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, w, h);

    const lutCanvas = document.createElement('canvas');
    lutCanvas.width = w;
    lutCanvas.height = h;
    const lutCtx = lutCanvas.getContext('2d')!;
    const lutData = lutCtx.createImageData(w, h);

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      const province = this.getProvinceByColor(r, g, b);
      if (province) {
        const country = this.getCountry(province.owner);
        if (country) {
          lutData.data[i] = Math.floor(country.color[0] * 255);
          lutData.data[i + 1] = Math.floor(country.color[1] * 255);
          lutData.data[i + 2] = Math.floor(country.color[2] * 255);
          lutData.data[i + 3] = 255;
        } else {
          lutData.data[i] = 100;
          lutData.data[i + 1] = 100;
          lutData.data[i + 2] = 100;
          lutData.data[i + 3] = 255;
        }
      } else {
        // 海洋或未知
        lutData.data[i] = 38;
        lutData.data[i + 1] = 64;
        lutData.data[i + 2] = 115;
        lutData.data[i + 3] = 255;
      }
    }

    lutCtx.putImageData(lutData, 0, 0);
    return lutCanvas;
  }

  /**
   * 生成海陆掩码纹理（与 province map 同尺寸）
   * R 通道: 0 = 海洋/湖泊, 255 = 陆地
   * 用于着色器中精确判断海陆（替代高度图判断）
   * 对于无法识别的像素（省份边界线等），根据高度图值作为 fallback
   */
  generateSeaLandMask(
    provinceMapCanvas: HTMLCanvasElement,
    heightmapCanvas: HTMLCanvasElement,
    seaLevel: number
  ): HTMLCanvasElement {
    const w = provinceMapCanvas.width;
    const h = provinceMapCanvas.height;
    const ctx = provinceMapCanvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, w, h);

    // 加载高度图用于 fallback
    const hmW = heightmapCanvas.width;
    const hmH = heightmapCanvas.height;
    const hmCtx = heightmapCanvas.getContext('2d', { willReadFrequently: true })!;
    const hmData = hmCtx.getImageData(0, 0, hmW, hmH);
    const seaLevelByte = Math.round(seaLevel * 255);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskData = maskCtx.createImageData(w, h);

    let seaCount = 0;
    let landCount = 0;
    let fallbackCount = 0;

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      const province = this.getProvinceByColor(r, g, b);
      let isLand: boolean;

      if (province) {
        if (province.type === 'sea' || province.type === 'lake') {
          isLand = false;
          seaCount++;
        } else {
          isLand = true;
          landCount++;
        }
      } else {
        // 无法识别的像素（边界线等）→ 用高度图判断
        const pixelIndex = i / 4;
        const px = pixelIndex % w;
        const py = Math.floor(pixelIndex / w);
        const hmX = Math.min(Math.floor((px / w) * hmW), hmW - 1);
        const hmY = Math.min(Math.floor((py / h) * hmH), hmH - 1);
        const hmIdx = (hmY * hmW + hmX) * 4;
        const heightVal = hmData.data[hmIdx];
        isLand = heightVal >= seaLevelByte;
        fallbackCount++;
        if (isLand) landCount++; else seaCount++;
      }

      const val = isLand ? 255 : 0;
      maskData.data[i] = val;
      maskData.data[i + 1] = val;
      maskData.data[i + 2] = val;
      maskData.data[i + 3] = 255;
    }

    maskCtx.putImageData(maskData, 0, 0);
    console.log(`[ProvinceStore] 海陆掩码生成完成: ${landCount} 陆地, ${seaCount} 海洋, ${fallbackCount} fallback 像素`);
    return maskCanvas;
  }

  /**
   * 使用海陆掩码修正高度图，确保 3D 地形几何体与掩码对齐
   * - 掩码=海洋的区域 → heightmap 强制低于海平面
   * - 掩码=陆地的区域 → heightmap 强制高于海平面
   */
  correctHeightmapWithMask(
    heightmapCanvas: HTMLCanvasElement,
    seaLandMaskCanvas: HTMLCanvasElement,
    seaLevel: number
  ): void {
    const hmW = heightmapCanvas.width;
    const hmH = heightmapCanvas.height;
    const maskW = seaLandMaskCanvas.width;
    const maskH = seaLandMaskCanvas.height;

    const hmCtx = heightmapCanvas.getContext('2d', { willReadFrequently: true })!;
    const hmData = hmCtx.getImageData(0, 0, hmW, hmH);

    const maskCtx = seaLandMaskCanvas.getContext('2d', { willReadFrequently: true })!;
    const maskData = maskCtx.getImageData(0, 0, maskW, maskH);

    const seaLevelByte = Math.round(seaLevel * 255);
    let correctedSea = 0;
    let correctedLand = 0;

    for (let y = 0; y < hmH; y++) {
      for (let x = 0; x < hmW; x++) {
        // 将高度图坐标映射到掩码坐标
        const maskX = Math.min(Math.floor((x / hmW) * maskW), maskW - 1);
        const maskY = Math.min(Math.floor((y / hmH) * maskH), maskH - 1);

        const maskIdx = (maskY * maskW + maskX) * 4;
        const isLand = maskData.data[maskIdx] > 128; // R > 128 = 陆地

        const hmIdx = (y * hmW + x) * 4;
        const currentHeight = hmData.data[hmIdx];

        if (!isLand && currentHeight >= seaLevelByte) {
          // 海洋区域但高度图偏高 → 强制下压到海平面以下
          const newHeight = seaLevelByte - 3;
          hmData.data[hmIdx] = newHeight;
          hmData.data[hmIdx + 1] = newHeight;
          hmData.data[hmIdx + 2] = newHeight;
          correctedSea++;
        } else if (isLand && currentHeight < seaLevelByte) {
          // 陆地区域但高度图偏低 → 强制上提到海平面以上
          const newHeight = seaLevelByte + 1;
          hmData.data[hmIdx] = newHeight;
          hmData.data[hmIdx + 1] = newHeight;
          hmData.data[hmIdx + 2] = newHeight;
          correctedLand++;
        }
      }
    }

    hmCtx.putImageData(hmData, 0, 0);
    console.log(`[ProvinceStore] 高度图修正完成: ${correctedSea} 海洋像素下压, ${correctedLand} 陆地像素上提`);
  }
}
