/**
 * 前端菜单管理器 (Front-End Menu Manager)
 * 负责游戏开局的流程控制：主菜单 -> 剧本选择 -> 国家选择 -> 大地图准备 -> 正式游戏
 */

export enum MenuState {
  MAIN_MENU = 'MAIN_MENU',
  SCENARIO_SELECTION = 'SCENARIO_SELECTION',
  COUNTRY_SELECTION = 'COUNTRY_SELECTION',
  MAP_SETUP = 'MAP_SETUP',
  IN_GAME = 'IN_GAME'
}

export type MenuCountryDetails = {
  name: string;
  leader: string;
  ideology: string;
  history: string;
};

export class MainMenuManager {
  private currentState: MenuState = MenuState.MAIN_MENU;
  
  // DOM 元素引用
  private overlay: HTMLElement;
  private bgLayer: HTMLElement;
  private viewMainMenu: HTMLElement;
  private viewScenario: HTMLElement;
  private viewCountry: HTMLElement;
  private viewMapSetup: HTMLElement;

  // 游戏面板元素 (用来在开局期间隐藏它们)
  private gameTopBar: HTMLElement;
  private gameProvincePanel: HTMLElement;
  private gamePoliticalPanel: HTMLElement;
  private gameMapModePanel: HTMLElement;

  // 开局数据
  private selectedScenarioYear: string = '1936';
  private selectedCountryTag: string = 'FRA';
  private selectedCountryName: string = '法兰西';

  // 回调事件：当用户最终点击“开始游戏”时触发，将选中的数据传给主循环
  public onGameStart: ((data: { year: string; countryTag: string; countryName: string }) => void) | null = null;
  public getCountryDetails: ((countryTag: string) => MenuCountryDetails) | null = null;

  constructor() {
    // 获取容器
    this.overlay = document.getElementById('front-end-overlay')!;
    this.bgLayer = document.getElementById('frontend-bg')!;
    this.viewMainMenu = document.getElementById('view-main-menu')!;
    this.viewScenario = document.getElementById('view-scenario')!;
    this.viewCountry = document.getElementById('view-country')!;
    this.viewMapSetup = document.getElementById('view-map-setup')!;

    // 游戏内部 UI
    this.gameTopBar = document.getElementById('top-bar-container')!;
    this.gameProvincePanel = document.getElementById('province-panel')!;
    this.gamePoliticalPanel = document.getElementById('political-panel')!;
    this.gameMapModePanel = document.getElementById('map-mode-panel')!;

    this.initEvents();
    this.setState(MenuState.MAIN_MENU);
  }

  private initEvents() {
    // --- 1. 主菜单事件 ---
    document.getElementById('btn-single-player')?.addEventListener('click', () => {
      this.setState(MenuState.SCENARIO_SELECTION);
    });

    // --- 2. 剧本选择事件 ---
    const btnScenarioBack = document.getElementById('btn-scenario-back');
    const btnScenarioNext = document.getElementById('btn-scenario-next');
    btnScenarioBack?.addEventListener('click', () => this.setState(MenuState.MAIN_MENU));
    btnScenarioNext?.addEventListener('click', () => this.setState(MenuState.COUNTRY_SELECTION));

    // 剧本卡片选择
    const scenarioCards = document.querySelectorAll('.scenario-card');
    scenarioCards.forEach(card => {
      card.addEventListener('click', (e) => {
        scenarioCards.forEach(c => c.classList.remove('selected'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('selected');
        this.selectedScenarioYear = target.dataset.year || '1936';
        
        // 更新描述
        const desc = document.getElementById('scenario-desc-text');
        if (desc) {
          desc.textContent = this.selectedScenarioYear === '1936' 
            ? '至暗时刻正在迫近。在欧洲，希特勒巩固了他的权力，并正将目光投向德意志边界之外。新的世界大战一触即发...' 
            : '闪电战的阴云已经笼罩欧洲。德国军队跨越了波兰边界，英法被迫宣战。第二次世界大战正式爆发...';
        }
      });
    });

    // --- 3. 国家选择事件 ---
    const btnCountryBack = document.getElementById('btn-country-back');
    const btnCountryNext = document.getElementById('btn-country-next');
    btnCountryBack?.addEventListener('click', () => this.setState(MenuState.SCENARIO_SELECTION));
    btnCountryNext?.addEventListener('click', () => this.setState(MenuState.MAP_SETUP));

    // 主要国家点击
    const countryList = document.querySelectorAll('.major-country');
    countryList.forEach(item => {
      item.addEventListener('click', (e) => {
        countryList.forEach(c => c.classList.remove('selected'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('selected');
        
        this.selectedCountryTag = target.dataset.tag || 'FRA';
        this.selectedCountryName = target.querySelector('.mc-name')?.textContent || '法兰西';
        
        this.updateCountryDetails(this.selectedCountryTag);
      });
    });

    // --- 4. 地图准备事件 ---
    const btnSetupBack = document.getElementById('btn-setup-back');
    const btnStartGame = document.getElementById('btn-start-game');
    btnSetupBack?.addEventListener('click', () => this.setState(MenuState.MAIN_MENU));
    btnStartGame?.addEventListener('click', () => {
      this.setState(MenuState.IN_GAME);
    });
  }

  private updateCountryDetails(tag: string) {
    const nameEl = document.getElementById('cd-country-name');
    const leaderEl = document.getElementById('cd-leader-name');
    const ideologyEl = document.getElementById('cd-ideology');
    const historyEl = document.getElementById('cd-history');

    if (!nameEl || !leaderEl || !ideologyEl || !historyEl) return;

    const details = this.getCountryDetails?.(tag);
    if (details) {
      nameEl.textContent = details.name || tag;
      leaderEl.textContent = details.leader || '未知';
      ideologyEl.textContent = details.ideology || '未知';
      historyEl.textContent = details.history || '暂无国家历史数据';
      return;
    }

    nameEl.textContent = tag;
    leaderEl.textContent = '未知';
    ideologyEl.textContent = '未知';
    historyEl.textContent = '暂无国家历史数据';
  }

  private hideGameUI() {
    this.gameTopBar.style.display = 'none';
    this.gameProvincePanel.style.display = 'none';
    this.gamePoliticalPanel.style.display = 'none';
    this.gameMapModePanel.style.display = 'none';
  }

  private showGameUI() {
    this.gameTopBar.style.display = 'flex';
    this.gameMapModePanel.style.display = 'flex';
    // Province 和 Political 面板由具体的逻辑控制显隐，这里只重置 display
    this.gameProvincePanel.style.display = '';
    this.gamePoliticalPanel.style.display = '';
  }

  public setState(newState: MenuState) {
    this.currentState = newState;

    // 隐藏所有前端视图
    this.viewMainMenu.classList.remove('active');
    this.viewScenario.classList.remove('active');
    this.viewCountry.classList.remove('active');
    this.viewMapSetup.classList.remove('active');

    switch (newState) {
      case MenuState.MAIN_MENU:
      case MenuState.SCENARIO_SELECTION:
      case MenuState.COUNTRY_SELECTION:
        this.overlay.style.display = 'flex';
        this.bgLayer.style.opacity = '1';
        this.hideGameUI();

        if (newState === MenuState.MAIN_MENU) this.viewMainMenu.classList.add('active');
        if (newState === MenuState.SCENARIO_SELECTION) this.viewScenario.classList.add('active');
        if (newState === MenuState.COUNTRY_SELECTION) {
          this.viewCountry.classList.add('active');
          this.updateCountryDetails(this.selectedCountryTag);
        }
        break;
        
      case MenuState.MAP_SETUP:
        // 隐藏深色背景，露出 3D 地图，但依然保持 overlay 拦截操作
        this.overlay.style.display = 'flex';
        this.overlay.style.pointerEvents = 'none'; // 允许点击底层的地图进行预览
        this.bgLayer.style.opacity = '0'; // 渐变隐藏背景图
        
        this.viewMapSetup.classList.add('active');
        this.viewMapSetup.style.pointerEvents = 'auto'; // UI部分仍可点击
        
        this.hideGameUI();

        // 更新准备界面的数据展示
        const dateEl = document.getElementById('setup-date');
        const scNameEl = document.getElementById('setup-scenario-name');
        const cyNameEl = document.getElementById('setup-country-name');
        if (dateEl) dateEl.textContent = this.selectedScenarioYear === '1936' ? '12:00, 1月1日, 1936' : '12:00, 8月14日, 1939';
        if (scNameEl) scNameEl.textContent = this.selectedScenarioYear === '1936' ? '风暴前夜' : '闪电战';
        if (cyNameEl) cyNameEl.textContent = this.selectedCountryName;
        break;

      case MenuState.IN_GAME:
        // 彻底关闭前端菜单层
        this.overlay.style.display = 'none';
        this.showGameUI();
        
        // 触发外部回调（例如通知 GameStateManager 和地图相机）
        if (this.onGameStart) {
          this.onGameStart({
            year: this.selectedScenarioYear,
            countryTag: this.selectedCountryTag,
            countryName: this.selectedCountryName
          });
        }
        break;
    }
  }
}
