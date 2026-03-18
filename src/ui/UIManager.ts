/**
 * UI 管理器
 * 管理地块信息面板、Tooltip、FPS 计数器和地图模式切换
 * 支持 State（一级行政区）信息显示
 */

import { ProvinceData, ProvinceStore, StateData, StrategicRegionData } from '../data/ProvinceStore';

export class UIManager {
  private panel: HTMLElement;
  private panelTitle: HTMLElement;
  private panelId: HTMLElement;
  private panelOwner: HTMLElement;
  private panelCountryColor: HTMLElement;
  private panelCountryName: HTMLElement;
  private panelTerrain: HTMLElement;
  private panelPopulation: HTMLElement;
  private panelStateName: HTMLElement;
  private panelStateCategory: HTMLElement;
  private panelStateManpower: HTMLElement;
  private panelStateCores: HTMLElement;
  private panelStrategicRegion!: HTMLElement;

  private tooltip: HTMLElement;
  private fpsCounter: HTMLElement;

  private store: ProvinceStore;

  /** 地图模式切换回调 */
  public onMapModeChange: ((mode: number) => void) | null = null;
  /** 城市散布显隐切换回调 */
  public onCityScatterVisibilityChange: ((visible: boolean) => void) | null = null;
  /** 建筑显隐切换回调 */
  public onBuildingsVisibilityChange: ((visible: boolean) => void) | null = null;
  /** 城市灯光显隐切换回调 */
  public onCityLightsVisibilityChange: ((visible: boolean) => void) | null = null;

  // FPS 计算
  private frameCount = 0;
  private lastFpsUpdate = 0;

  constructor(store: ProvinceStore) {
    this.store = store;

    this.panel = document.getElementById('province-panel')!;
    this.panelTitle = document.getElementById('panel-title')!;
    this.panelId = document.getElementById('panel-id')!;
    this.panelOwner = document.getElementById('panel-owner')!;
    this.panelCountryColor = document.getElementById('panel-country-color')!;
    this.panelCountryName = document.getElementById('panel-country-name')!;
    this.panelTerrain = document.getElementById('panel-terrain')!;
    this.panelPopulation = document.getElementById('panel-population')!;
    this.panelStateName = document.getElementById('panel-state-name')!;
    this.panelStateCategory = document.getElementById('panel-state-category')!;
    this.panelStateManpower = document.getElementById('panel-state-manpower')!;
    this.panelStateCores = document.getElementById('panel-state-cores')!;
    this.panelStrategicRegion = document.getElementById('panel-strategic-region')!;

    this.tooltip = document.getElementById('tooltip')!;
    this.fpsCounter = document.getElementById('fps-counter')!;

    this.setupMapModeButtons();
    this.setupLayerToggles();
  }

  private setupMapModeButtons(): void {
    const buttons = document.querySelectorAll('.map-mode-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        // 移除所有 active
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.getAttribute('data-mode');
        let modeIndex = 0;
        if (mode === 'terrain') modeIndex = 1;
        else if (mode === 'heightmap') modeIndex = 2;
        else if (mode === 'state') modeIndex = 3;

        if (this.onMapModeChange) {
          this.onMapModeChange(modeIndex);
        }
      });
    });
  }

  private setupLayerToggles(): void {
    const cityScatterToggle = document.getElementById('toggle-city-scatter') as HTMLInputElement | null;
    if (cityScatterToggle) {
      cityScatterToggle.addEventListener('change', () => {
        if (this.onCityScatterVisibilityChange) {
          this.onCityScatterVisibilityChange(cityScatterToggle.checked);
        }
      });
      if (this.onCityScatterVisibilityChange) {
        this.onCityScatterVisibilityChange(cityScatterToggle.checked);
      }
    }

    const buildingsToggle = document.getElementById('toggle-buildings') as HTMLInputElement | null;
    if (buildingsToggle) {
      buildingsToggle.addEventListener('change', () => {
        if (this.onBuildingsVisibilityChange) {
          this.onBuildingsVisibilityChange(buildingsToggle.checked);
        }
      });
      if (this.onBuildingsVisibilityChange) {
        this.onBuildingsVisibilityChange(buildingsToggle.checked);
      }
    }

    const cityLightsToggle = document.getElementById('toggle-city-lights') as HTMLInputElement | null;
    if (cityLightsToggle) {
      cityLightsToggle.addEventListener('change', () => {
        if (this.onCityLightsVisibilityChange) {
          this.onCityLightsVisibilityChange(cityLightsToggle.checked);
        }
      });
      if (this.onCityLightsVisibilityChange) {
        this.onCityLightsVisibilityChange(cityLightsToggle.checked);
      }
    }
  }

  /** 显示悬浮提示 */
  showTooltip(
    province: ProvinceData,
    state: StateData | null,
    strategicRegion: StrategicRegionData | null,
    mouseX: number,
    mouseY: number
  ): void {
    const isSeaProvince = province.type === 'sea' || province.type === 'lake';
    const country = this.store.getCountry(province.owner);
    const countryName = country ? country.name : province.owner;

    // 陆地优先 State；海域优先 Strategic Region
    const stateName = !isSeaProvince
      ? (state?.localName || province.stateName || '')
      : '';
    const regionName = isSeaProvince
      ? (strategicRegion?.localName || province.strategicRegionName || '')
      : '';

    let text = '';
    if (isSeaProvince) {
      const seaTitle = regionName || province.name;
      text = `${seaTitle} · ${countryName}`;
    } else if (stateName) {
      text = `${stateName} · ${countryName}`;
    } else {
      text = `${province.name} · ${countryName}`;
    }

    this.tooltip.textContent = text;
    this.tooltip.style.left = `${mouseX + 15}px`;
    this.tooltip.style.top = `${mouseY - 10}px`;
    this.tooltip.classList.add('visible');
  }

  /** 隐藏悬浮提示 */
  hideTooltip(): void {
    this.tooltip.classList.remove('visible');
  }

  /** 显示选中地块的信息面板 */
  showPanel(province: ProvinceData, state: StateData | null, strategicRegion: StrategicRegionData | null): void {
    const isSeaProvince = province.type === 'sea' || province.type === 'lake';
    const country = this.store.getCountry(province.owner);

    const stateName = !isSeaProvince
      ? (state?.localName || province.stateName || '--')
      : '--';
    const regionName = isSeaProvince
      ? (strategicRegion?.localName || province.strategicRegionName || '--')
      : '--';

    // 标题优先：海域 -> Strategic Region；陆地 -> State
    if (isSeaProvince) {
      this.panelTitle.textContent = regionName !== '--' ? regionName : province.name;
    } else {
      this.panelTitle.textContent = stateName !== '--' ? stateName : province.name;
    }

    this.panelId.textContent = `#${province.id}`;
    this.panelTerrain.textContent = this.translateTerrain(province.terrain);
    this.panelPopulation.textContent = province.population > 0
      ? province.population.toLocaleString('zh-CN')
      : '--';

    if (country) {
      this.panelCountryName.textContent = country.name;
      this.panelCountryColor.style.backgroundColor = `rgb(${Math.floor(country.color[0] * 255)}, ${Math.floor(country.color[1] * 255)}, ${Math.floor(country.color[2] * 255)})`;
    } else {
      this.panelCountryName.textContent = province.owner;
      this.panelCountryColor.style.backgroundColor = '#666';
    }

    // State 信息（仅陆地展示有效值）
    if (!isSeaProvince && state) {
      this.panelStateName.textContent = state.localName;
      this.panelStateCategory.textContent = this.translateCategory(state.category);
      this.panelStateManpower.textContent = state.manpower > 0
        ? state.manpower.toLocaleString('zh-CN')
        : '--';
      // 核心领土：显示国家代码列表
      this.panelStateCores.textContent = state.cores.length > 0
        ? state.cores.map(c => {
            const cn = this.store.getCountry(c);
            return cn ? cn.name : c;
          }).join(', ')
        : '--';
    } else {
      this.panelStateName.textContent = stateName;
      this.panelStateCategory.textContent = '--';
      this.panelStateManpower.textContent = '--';
      this.panelStateCores.textContent = '--';
    }

    // 海域信息（仅海域展示有效值）
    this.panelStrategicRegion.textContent = regionName;

    this.panel.classList.add('visible');
  }

  /** 隐藏信息面板 */
  hidePanel(): void {
    this.panel.classList.remove('visible');
  }

  /** 更新 FPS 显示 */
  updateFPS(timestamp: number): void {
    this.frameCount++;
    if (timestamp - this.lastFpsUpdate >= 1000) {
      const fps = this.frameCount;
      this.fpsCounter.textContent = `FPS: ${fps}`;
      this.frameCount = 0;
      this.lastFpsUpdate = timestamp;
    }
  }

  /** 地形类型翻译 */
  private translateTerrain(terrain: string): string {
    const map: Record<string, string> = {
      plains: '平原',
      hills: '丘陵',
      mountain: '山地',
      mountains: '山地',
      forest: '森林',
      desert: '沙漠',
      tundra: '冻原',
      urban: '城市',
      ocean: '海洋',
      marsh: '沼泽',
      jungle: '丛林',
      lakes: '湖泊',
      unknown: '未知',
    };
    return map[terrain] || terrain;
  }

  /** State 类别翻译 */
  private translateCategory(category: string): string {
    const map: Record<string, string> = {
      wasteland: '荒地',
      enclave: '飞地',
      tiny_island: '小岛',
      small_island: '岛屿',
      pastoral: '牧区',
      rural: '乡村',
      town: '城镇',
      large_town: '大城镇',
      city: '城市',
      large_city: '大城市',
      metropolis: '大都市',
      megalopolis: '特大都市',
    };
    return map[category] || category;
  }
}
