/**
 * UI 管理器
 * 管理地块信息面板、Tooltip、FPS 计数器和地图模式切换
 * 支持 State（一级行政区）信息显示
 */

import { ProvinceData, ProvinceStore, StateData, StrategicRegionData } from '../data/ProvinceStore';

type CountryPoliticalInfo = {
  name: string;
  leader: string;
  ideology: string;
  party: string;
};

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
  private stateBuildingTypeCounts = new Map<number, Record<string, number>>();
  private cityCountByState = new Map<number, number>();
  private topCitiesByState = new Map<number, Array<{ name: string; value: number }>>();
  private countryPoliticalInfoProvider: ((countryTag: string) => CountryPoliticalInfo | null) | null = null;

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

  setStateBuildingsData(items: Array<{ stateId: number; type: string }>): void {
    this.stateBuildingTypeCounts.clear();
    for (const item of items) {
      if (!item || !Number.isFinite(item.stateId) || !item.type) continue;
      const stateId = item.stateId;
      const normalizedType = this.normalizeBuildingType(item.type);
      let counts = this.stateBuildingTypeCounts.get(stateId);
      if (!counts) {
        counts = {};
        this.stateBuildingTypeCounts.set(stateId, counts);
      }
      counts[normalizedType] = (counts[normalizedType] || 0) + 1;
    }
  }

  setStateBuildingLevels(byState: Record<string, Record<string, number>>): void {
    this.stateBuildingTypeCounts.clear();

    for (const [stateIdStr, levels] of Object.entries(byState || {})) {
      const stateId = parseInt(stateIdStr, 10);
      if (!Number.isFinite(stateId) || !levels) continue;

      const counts: Record<string, number> = {};
      for (const [rawType, rawLevel] of Object.entries(levels)) {
        const level = Number(rawLevel);
        if (!Number.isFinite(level) || level <= 0) continue;

        const type = this.normalizeBuildingType(rawType);
        counts[type] = (counts[type] || 0) + level;
      }

      this.stateBuildingTypeCounts.set(stateId, counts);
    }
  }

  setStateCitySummary(byState: Record<number, { count: number; top: Array<{ name: string; value: number }> }>): void {
    this.cityCountByState.clear();
    this.topCitiesByState.clear();

    for (const [stateIdRaw, summary] of Object.entries(byState || {})) {
      const stateId = Number(stateIdRaw);
      if (!Number.isFinite(stateId) || !summary) continue;
      this.cityCountByState.set(stateId, Number(summary.count) || 0);
      this.topCitiesByState.set(stateId, Array.isArray(summary.top) ? summary.top.slice(0, 3) : []);
    }
  }

  setCountryPoliticalInfoProvider(provider: ((countryTag: string) => CountryPoliticalInfo | null) | null): void {
    this.countryPoliticalInfoProvider = provider;
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
    
    // 阻止点击地图模式面板时触发地图拾取
    const mapModePanel = document.getElementById('map-mode-panel');
    if (mapModePanel) {
      mapModePanel.addEventListener('mousedown', (e) => e.stopPropagation());
    }
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

    let title = '';
    if (isSeaProvince) {
      title = regionName || province.name;
    } else if (stateName) {
      title = `属于${stateName}的${this.translateTerrain(province.terrain)}省份`;
    } else {
      title = province.name;
    }

    // 构建 HOI4 风格的 Tooltip HTML
    this.tooltip.innerHTML = `
      <div class="tooltip-title">📍 ${title}</div>
      <div class="tooltip-owner">拥有国: 🏳️ <span style="color: #f7fafc; font-weight: bold;">${countryName}</span></div>
      <div class="tooltip-weather">天气: ☀️ 晴朗 (7°C)</div>
      <div class="tooltip-time">当地时间: 🌙 19:00</div>
      <div class="tooltip-divider"></div>
      <div class="tooltip-action">点击查看地区。</div>
      <div class="tooltip-shortcut">Ctrl+Alt+点击 向盟友发送信号。</div>
    `;

    this.tooltip.dataset.owner = 'map';
    this.tooltip.classList.remove('tooltip-panel');
    this.tooltip.style.left = `${mouseX + 15}px`;
    this.tooltip.style.top = `${mouseY + 15}px`; // 稍微往下移一点，避免遮挡鼠标
    this.tooltip.classList.add('visible');
  }

  /** 隐藏悬浮提示 */
  hideTooltip(): void {
    if (this.tooltip.dataset.owner === 'shared' || this.tooltip.classList.contains('tooltip-panel')) {
      return;
    }
    this.tooltip.classList.remove('visible');
    this.tooltip.classList.remove('tooltip-panel');
    delete this.tooltip.dataset.owner;
  }

  /** 显示选中地块的信息面板 */
  showPanel(province: ProvinceData, state: StateData | null, strategicRegion: StrategicRegionData | null): void {
    const isSeaProvince = province.type === 'sea' || province.type === 'lake';
    const country = this.store.getCountry(province.owner);
    const countryName = country ? country.name : province.owner;
    const politicalInfo = this.countryPoliticalInfoProvider?.(province.owner) || null;

    const stateName = !isSeaProvince
      ? (state?.localName || province.stateName || '--')
      : '--';
    const regionName = strategicRegion?.localName || province.strategicRegionName || '--';

    this.panelTitle.textContent = isSeaProvince
      ? (regionName !== '--' ? regionName : province.name)
      : (stateName !== '--' ? stateName : province.name);

    this.panelId.textContent = `#${province.id}`;
    this.panelTerrain.textContent = this.translateTerrain(province.terrain);

    const ownerFlag = document.getElementById('panel-owner-flag');
    const controllerFlag = document.getElementById('panel-controller-flag');

    if (country) {
      const colorStr = `rgb(${Math.floor(country.color[0] * 255)}, ${Math.floor(country.color[1] * 255)}, ${Math.floor(country.color[2] * 255)})`;
      if (ownerFlag) ownerFlag.style.backgroundColor = colorStr;
      if (controllerFlag) controllerFlag.style.backgroundColor = colorStr;
    } else {
      if (ownerFlag) ownerFlag.style.backgroundColor = '#666';
      if (controllerFlag) controllerFlag.style.backgroundColor = '#666';
    }

    const panelSubOwner = document.getElementById('panel-sub-owner');
    const panelSubState = document.getElementById('panel-sub-state');
    const ownerTitle = this.panel.querySelector('.owner-box .box-title') as HTMLElement | null;
    const claimTitle = this.panel.querySelector('.claim-box .box-title') as HTMLElement | null;
    const stateMeta = document.getElementById('panel-state-meta');
    const slotsTitle = this.panel.querySelector('.slots-title') as HTMLElement | null;
    const buildingGrid = this.panel.querySelector('.building-grid') as HTMLElement | null;

    const stateBuildings = state ? (this.stateBuildingTypeCounts.get(state.id) || {}) : {};

    if (isSeaProvince) {
      if (panelSubOwner) {
        panelSubOwner.textContent = `控制方: ${countryName}`;
      }
      if (panelSubState) {
        panelSubState.textContent = `战略区: ${regionName}`;
      }
      if (ownerTitle) {
        ownerTitle.textContent = '海域控制方';
      }
      if (claimTitle) {
        claimTitle.textContent = `海域信息: ${regionName}`;
      }

      const navalTerrain = strategicRegion?.navalTerrain || '未知';
      const seaType = strategicRegion?.isSeaRegion ? '海域' : '内陆水域';
      if (stateMeta) {
        stateMeta.textContent = `类型: ${seaType} ｜ 海军地形: ${navalTerrain}`;
      }
      if (slotsTitle) {
        slotsTitle.textContent = '海域无州建筑槽位';
      }

      this.updateInfrastructureDisplay({});
      this.updateLocalBuildingDisplay({});
      if (buildingGrid) {
        buildingGrid.innerHTML = '';
        for (let i = 0; i < 15; i++) {
          const slot = document.createElement('div');
          slot.className = 'building-slot';
          slot.textContent = '—';
          buildingGrid.appendChild(slot);
        }
        buildingGrid.title = `战略区: ${regionName} ｜ 海军地形: ${navalTerrain}`;
      }

      this.panel.classList.add('visible');
      return;
    }

    if (panelSubOwner) {
      const leader = politicalInfo?.leader || '未知';
      panelSubOwner.textContent = `拥有国: ${countryName} ｜ 领袖: ${leader}`;
    }
    if (panelSubState) {
      const ideology = politicalInfo?.ideology || '未知';
      panelSubState.textContent = `州: ${stateName} ｜ 政体: ${ideology}`;
    }
    if (ownerTitle) {
      ownerTitle.textContent = '地区拥有国';
    }
    if (claimTitle) {
      claimTitle.textContent = `战略区: ${regionName}`;
    }

    const slotExcludedTypes = new Set(['infrastructure', 'air_base', 'anti_air_building', 'radar_station', 'railway', 'supply_node', 'naval_base', 'bunker', 'coastal_bunker']);
    const slotBuildings = Object.fromEntries(
      Object.entries(stateBuildings).filter(([type]) => !slotExcludedTypes.has(type))
    );
    const totalBuildings = Object.values(stateBuildings).reduce((sum, n) => sum + n, 0);
    const totalSlots = Object.values(slotBuildings).reduce((sum, n) => sum + n, 0);

    const category = state?.category ? this.translateCategory(state.category) : '--';
    const manpower = state?.manpower ? state.manpower.toLocaleString('zh-CN') : '--';

    const vpEntries = Object.entries(state?.victoryPoints || {})
      .map(([provinceId, value]) => ({ provinceId: Number(provinceId), value: Number(value) }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
      .sort((a, b) => b.value - a.value);
    const totalVp = vpEntries.reduce((sum, entry) => sum + entry.value, 0);
    const topVp = vpEntries.slice(0, 3).map((entry) => `${entry.provinceId}:${entry.value}`).join('，') || '--';

    const cityCount = state ? (this.cityCountByState.get(state.id) || 0) : 0;
    const topCities = state ? (this.topCitiesByState.get(state.id) || []) : [];
    const topCitiesText = topCities.length > 0
      ? topCities.map((city) => `${city.name}×${city.value}`).join('，')
      : '--';

    const party = politicalInfo?.party || '--';
    if (stateMeta) {
      stateMeta.textContent = `州: ${stateName} ｜ 类别: ${category} ｜ 人力: ${manpower} ｜ VP总值: ${totalVp} ｜ 城市簇: ${cityCount} ｜ 执政党: ${party}`;
    }

    if (slotsTitle) {
      const shownSlots = Math.min(totalSlots, 15);
      slotsTitle.textContent = `已建建筑：${shownSlots}/15（建筑总等级 ${totalBuildings}）`;
    }

    this.updateInfrastructureDisplay(stateBuildings);
    this.updateLocalBuildingDisplay(stateBuildings);

    if (buildingGrid) {
      const slots: string[] = [];
      const sorted = Object.entries(slotBuildings).sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sorted) {
        const icon = this.getBuildingTypeIcon(type);
        for (let i = 0; i < count; i++) {
          slots.push(icon);
          if (slots.length >= 15) break;
        }
        if (slots.length >= 15) break;
      }

      buildingGrid.innerHTML = '';
      for (let i = 0; i < 15; i++) {
        const slot = document.createElement('div');
        const built = i < slots.length;
        slot.className = built ? 'building-slot built' : 'building-slot';
        slot.textContent = built ? slots[i] : '🔒';
        buildingGrid.appendChild(slot);
      }

      const summary = sorted
        .slice(0, 5)
        .map(([type, count]) => `${this.translateBuildingType(type)}×${count}`)
        .join('，');
      const politicalSummary = politicalInfo
        ? `国家: ${politicalInfo.name} ｜ 领袖: ${politicalInfo.leader} ｜ 意识形态: ${politicalInfo.ideology}`
        : `国家: ${countryName}`;
      buildingGrid.title = `建筑: ${summary || '无'} ｜ VP: ${topVp} ｜ 城市Top: ${topCitiesText} ｜ ${politicalSummary}`;
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

  private updateInfrastructureDisplay(stateBuildings: Record<string, number>): void {
    const mapping: Array<{ title: string; type: string; max: number }> = [
      { title: '基础设施', type: 'infrastructure', max: 5 },
      { title: '空军基地', type: 'air_base', max: 10 },
      { title: '防空火炮', type: 'anti_air_building', max: 5 },
      { title: '雷达站', type: 'radar_station', max: 6 },
      { title: '铁路', type: 'railway', max: 5 },
    ];

    const infraItems = Array.from(this.panel.querySelectorAll('.infra-item')) as HTMLElement[];
    for (const item of infraItems) {
      const title = item.getAttribute('title') || '';
      const valueEl = item.querySelector('.infra-value') as HTMLElement | null;
      const config = mapping.find((entry) => entry.title === title);
      if (!valueEl || !config) continue;
      const value = stateBuildings[config.type] || 0;
      valueEl.textContent = `${value}/${config.max}`;
    }
  }

  private updateLocalBuildingDisplay(stateBuildings: Record<string, number>): void {
    const mapping: Array<{ title: string; type: string; max: number }> = [
      { title: '补给中心', type: 'supply_node', max: 1 },
      { title: '海军基地', type: 'naval_base', max: 10 },
      { title: '陆上要塞', type: 'bunker', max: 10 },
      { title: '海岸要塞', type: 'coastal_bunker', max: 10 },
    ];

    const localItems = Array.from(this.panel.querySelectorAll('.local-building-item')) as HTMLElement[];
    for (const item of localItems) {
      const title = item.getAttribute('title') || '';
      const valueEl = item.querySelector('.local-building-value') as HTMLElement | null;
      const config = mapping.find((entry) => entry.title === title);
      if (!valueEl || !config) continue;
      const value = stateBuildings[config.type] || 0;
      valueEl.textContent = `${value}/${config.max}`;
    }
  }

  private getBuildingTypeIcon(type: string): string {
    const map: Record<string, string> = {
      arms_factory: '🏭',
      industrial_complex: '🏢',
      dockyard: '⚓',
      naval_base: '🛳️',
      bunker: '🧱',
      coastal_bunker: '🛡️',
      anti_air_building: '💥',
      air_base: '✈️',
      radar_station: '📡',
      fuel_silo: '⛽',
      rocket_site: '🚀',
      nuclear_reactor: '☢️',
      synthetic_refinery: '🧪',
      infrastructure: '🛣️',
      supply_node: '📦',
      railway: '🛤️',
      floating_harbor: '⚓',
      naval_headquarters: '🧭',
      naval_supply_hub: '📦',
      stronghold_network: '🧱',
      dam: '🏞️',
      landmark: '🏛️',
      locks: '🌉',
      special_project_facility: '🧪',
    };
    return map[type] || '🏗️';
  }

  private normalizeBuildingType(type: string): string {
    if (type.endsWith('_spawn')) {
      return type.slice(0, -6);
    }
    return type;
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

  private translateBuildingType(type: string): string {
    const map: Record<string, string> = {
      arms_factory: '军工厂',
      industrial_complex: '民用工厂',
      dockyard: '海军船坞',
      naval_base: '海军基地',
      bunker: '陆上要塞',
      coastal_bunker: '海岸要塞',
      anti_air_building: '防空炮',
      air_base: '空军基地',
      radar_station: '雷达站',
      fuel_silo: '燃料筒仓',
      rocket_site: '火箭基地',
      nuclear_reactor: '核反应堆',
      synthetic_refinery: '合成炼油厂',
      infrastructure: '基础设施',
      supply_node: '补给中心',
      railway: '铁路',
      floating_harbor: '浮动港口',
    };
    return map[type] || type;
  }
}
