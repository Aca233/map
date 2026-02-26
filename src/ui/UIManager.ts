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

  /** 显示悬浮提示 */
  showTooltip(
    province: ProvinceData,
    state: StateData | null,
    strategicRegion: StrategicRegionData | null,
    mouseX: number,
    mouseY: number
  ): void {
    const country = this.store.getCountry(province.owner);
    const countryName = country ? country.name : province.owner;
    const stateName = state ? state.localName : (province.stateName || '');
    const regionName = strategicRegion ? strategicRegion.localName : (province.strategicRegionName || '');

    let text = '';
    if (province.type === 'sea' || province.type === 'lake') {
      text = regionName ? `${regionName} · ${countryName}` : `${province.name} (${countryName})`;
    } else if (stateName) {
      text = `${stateName} · ${countryName}`;
    } else {
      text = `${province.name} (${countryName})`;
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
    const country = this.store.getCountry(province.owner);

    // 标题优先显示海域名（海洋）/State名（陆地）
    if ((province.type === 'sea' || province.type === 'lake') && strategicRegion) {
      this.panelTitle.textContent = strategicRegion.localName;
    } else {
      this.panelTitle.textContent = state ? state.localName : province.name;
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

    // State 信息
    if (state) {
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
      this.panelStateName.textContent = '--';
      this.panelStateCategory.textContent = '--';
      this.panelStateManpower.textContent = '--';
      this.panelStateCores.textContent = '--';
    }

    // 海域信息
    if (strategicRegion) {
      this.panelStrategicRegion.textContent = strategicRegion.localName;
    } else if (province.strategicRegionName) {
      this.panelStrategicRegion.textContent = province.strategicRegionName;
    } else {
      this.panelStrategicRegion.textContent = '--';
    }

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
