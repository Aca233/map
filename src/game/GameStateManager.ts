type LawCategory = 'conscription' | 'trade' | 'economy';
type SelectorKey =
  | LawCategory
  | 'political_advisor_1'
  | 'political_advisor_2'
  | 'political_advisor_3'
  | 'political_advisor_4'
  | 'industry_tank'
  | 'industry_naval'
  | 'industry_air'
  | 'industry_materiel'
  | 'industry_corporation'
  | 'industry_theorist'
  | 'military_army_chief'
  | 'military_navy_chief'
  | 'military_air_chief'
  | 'military_high_command_1'
  | 'military_high_command_2'
  | 'military_high_command_3';

type IndustrySelectorKey =
  | 'industry_tank'
  | 'industry_naval'
  | 'industry_air'
  | 'industry_materiel'
  | 'industry_corporation';

type PoliticalSlot = {
  key: SelectorKey;
  title: string;
  value: string;
  icon: string;
  artPath?: string;
  advisorTypeFrame?: number;
  nativeIcon?: boolean;
  filled?: boolean;
};

type CharacterIconEntry = {
  iconPath?: string;
  sprite?: string;
  kind?: string;
  ideaToken?: string;
  traits?: string[];
  description?: string;
};

type SharedTooltipOptions = {
  interactive?: boolean;
  placement?: 'pointer' | 'spirit';
  preserveSpiritAnchor?: boolean;
};

export class GameStateManager {
  private readonly dataAssetVersion = '2026-03-13-politics-l10n-fix-4';
  private pp: number = 150;
  private stability: number = 50;
  private warSupport: number = 50;
  private manpower: number = 1200000;
  private factories: { civilian: number; military: number; naval: number } = { civilian: 15, military: 20, naval: 5 };

  private currentDate: Date = new Date(1936, 0, 1, 12, 0);
  private gameSpeed: number = 1; // 0 = paused, 1-5 = speed
  private isPaused: boolean = false;

  // Data
  private countriesData: Record<string, any> | null = null;
  private startingPoliticsData: Record<string, any> | null = null;
  private localizationData: Record<string, string> = {};
  private localizationDataLower: Record<string, string> = {};
  private politicalTaxonomy: { ideas: Record<string, { category: string; name: string }>; characters: Record<string, { category: string; name: string }> } = { ideas: {}, characters: {} };
  private spiritIconMap: Record<string, { iconPath?: string; picture?: string }> = {};
  private characterIconMap: Record<string, CharacterIconEntry> = {};
  private currentCountryTag: string;
  private readonly fallbackLeaderNames: Record<string, string> = {
    FRA: '爱德华·达拉第',
    USA: '富兰克林·罗斯福',
    ENG: '斯坦利·鲍德温',
    GER: '阿道夫·希特勒',
    ITA: '贝尼托·墨索里尼',
    JAP: '昭和天皇',
    SOV: '约瑟夫·斯大林',
  };

  // UI Elements
  private elPP: HTMLElement | null = null;
  private elStability: HTMLElement | null = null;
  private elWarSupport: HTMLElement | null = null;
  private elManpower: HTMLElement | null = null;
  private elFactories: HTMLElement | null = null;
  private elDate: HTMLElement | null = null;
  private speedBtns: NodeListOf<Element> | null = null;
  private selectorOptionsByKey: Partial<Record<SelectorKey, string[]>> = {};
  private selectorAvailableOptionsByKey: Partial<Record<SelectorKey, Set<string>>> = {};
  private selectedTokenBySelector: Partial<Record<SelectorKey, string>> = {};
  private activeSelectorKey: SelectorKey | null = null;
  private spiritTooltipAnchor: HTMLElement | null = null;
  private spiritTooltipHideTimer: number | null = null;
  private readonly horizontalSplitSpriteFiles = new Set([
    'idea_political_tab.png',
    'idea_military_tab.png',
    'idea_technology_tab.png',
    'idea_entry_bg_2.png',
  ]);

  constructor(initialCountryTag: string = 'GER') {
    this.currentCountryTag = initialCountryTag.toUpperCase();
    this.initUI();
    this.setupTooltipInteractions();
    this.updateCountryBadge();
    this.updateUI();
    this.setupTimeControls();
    this.loadData();
  }

  private resolveAssetPath(path: string): string {
    if (!path) return path;
    if (/^(https?:|data:)/.test(path)) return path;
    const baseUrl = import.meta.env.BASE_URL || '/';
    return `${baseUrl}${path.replace(/^\/+/, '')}`;
  }

  private isHorizontalSplitSpriteAsset(path?: string | null): boolean {
    const normalized = String(path || '')
      .replace(/\\/g, '/')
      .split('?')[0]
      .toLowerCase();
    if (!normalized) return false;
    for (const fileName of this.horizontalSplitSpriteFiles) {
      if (normalized.endsWith(fileName)) {
        return true;
      }
    }
    return false;
  }

  private getCharacterIconAssetPath(token?: string | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const raw = token.trim();
    if (!raw) return null;

    const normalized = this.normalizePoliticalToken(raw);
    const mapped = this.characterIconMap[normalized] || this.characterIconMap[raw];
    return mapped?.iconPath ? this.resolveAssetPath(mapped.iconPath) : null;
  }

  private getCharacterGameDescription(token?: string | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const raw = token.trim();
    if (!raw) return null;

    const normalized = this.normalizePoliticalToken(raw);
    const mapped = this.characterIconMap[normalized] || this.characterIconMap[raw];
    const description = mapped?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : null;
  }

  private getPoliticalIconAssetPath(token?: string | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const raw = token.trim();
    if (!raw) return null;

    const normalized = this.normalizePoliticalToken(raw);
    const candidates = [
      normalized,
      raw,
      raw.replace(/^mio:/i, ''),
    ].filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);

    for (const candidate of candidates) {
      const mapped = this.spiritIconMap[candidate];
      if (mapped?.iconPath) {
        return this.resolveAssetPath(mapped.iconPath);
      }
    }

    return null;
  }

  private showSharedTooltip(
    title: string,
    description: string,
    anchor: HTMLElement,
    event?: MouseEvent,
    options: SharedTooltipOptions = {},
  ): void {
    const tooltipEl = document.getElementById('tooltip') as HTMLElement | null;
    if (!tooltipEl) return;

    if (!options.preserveSpiritAnchor) {
      this.cancelSpiritTooltipHide();
      this.spiritTooltipAnchor = null;
    }

    const cleanTitle = String(title || '').trim();
    const cleanDescription = String(description || '').trim();
    if (!cleanTitle && !cleanDescription) {
      this.hideSharedTooltip();
      return;
    }

    tooltipEl.replaceChildren();
    tooltipEl.dataset.owner = 'shared';
    tooltipEl.classList.add('tooltip-panel');
    tooltipEl.classList.toggle('tooltip-interactive', Boolean(options.interactive));

    if (cleanTitle) {
      const titleEl = document.createElement('div');
      titleEl.className = 'tooltip-title';
      titleEl.textContent = cleanTitle;
      tooltipEl.appendChild(titleEl);
    }

    if (cleanDescription) {
      const dividerEl = document.createElement('div');
      dividerEl.className = 'tooltip-divider';
      tooltipEl.appendChild(dividerEl);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'tooltip-body';
      bodyEl.textContent = cleanDescription;
      tooltipEl.appendChild(bodyEl);
    }

    tooltipEl.classList.add('visible');
    this.positionSharedTooltip(anchor, event, options);
  }

  private positionSharedTooltip(anchor: HTMLElement, event?: MouseEvent, options: SharedTooltipOptions = {}): void {
    const tooltipEl = document.getElementById('tooltip') as HTMLElement | null;
    if (!tooltipEl || !tooltipEl.classList.contains('visible')) return;

    const margin = 12;
    const offset = 16;
    const anchorRect = anchor.getBoundingClientRect();
    const width = tooltipEl.offsetWidth || 280;
    const height = tooltipEl.offsetHeight || 120;
    let left = 0;
    let top = 0;

    if (options.placement === 'spirit') {
      const gap = 18;
      const rightCandidate = anchorRect.right + gap;
      const leftCandidate = anchorRect.left - width - gap;
      const fitsRight = rightCandidate + width <= window.innerWidth - margin;
      const fitsLeft = leftCandidate >= margin;

      if (fitsRight || (!fitsLeft && window.innerWidth - anchorRect.right >= anchorRect.left)) {
        left = Math.min(window.innerWidth - margin - width, rightCandidate);
      } else {
        left = Math.max(margin, leftCandidate);
      }

      top = Math.max(margin, Math.min(anchorRect.top, window.innerHeight - margin - height));
    } else {
      const pointX = event?.clientX ?? (anchorRect.left + Math.min(anchorRect.width * 0.5, 120));
      const pointY = event?.clientY ?? anchorRect.top;
      left = pointX + offset;
      top = pointY + offset;

      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, pointX - width - offset);
      }
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, pointY - height - offset);
      }
    }

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  private hideSharedTooltip(): void {
    this.cancelSpiritTooltipHide();
    this.spiritTooltipAnchor = null;

    const tooltipEl = document.getElementById('tooltip') as HTMLElement | null;
    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
    tooltipEl.classList.remove('tooltip-panel');
    tooltipEl.classList.remove('tooltip-interactive');
    delete tooltipEl.dataset.owner;
    tooltipEl.replaceChildren();
  }

  private setupTooltipInteractions(): void {
    const tooltipEl = document.getElementById('tooltip') as HTMLElement | null;
    if (!tooltipEl) return;

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!tooltipEl.classList.contains('visible')) return;
      this.hideSharedTooltip();
    });
  }

  private cancelSpiritTooltipHide(): void {
    if (this.spiritTooltipHideTimer === null) return;
    window.clearTimeout(this.spiritTooltipHideTimer);
    this.spiritTooltipHideTimer = null;
  }

  private scheduleSpiritTooltipHide(): void {
    this.cancelSpiritTooltipHide();
    this.spiritTooltipHideTimer = window.setTimeout(() => {
      const anchorHovered = Boolean(this.spiritTooltipAnchor?.matches(':hover'));
      if (anchorHovered) {
        return;
      }
      this.hideSharedTooltip();
    }, 100);
  }

  private showSpiritTooltip(title: string, description: string, anchor: HTMLElement): void {
    this.cancelSpiritTooltipHide();
    this.spiritTooltipAnchor = anchor;
    this.showSharedTooltip(title, description, anchor, undefined, {
      placement: 'spirit',
      preserveSpiritAnchor: true,
    });
  }

  private getLeaderPortraitAssetPath(countryTag: string): string | null {
    const supported = new Set(['FRA', 'USA', 'ENG', 'GER', 'ITA', 'JAP', 'SOV']);
    const tag = (countryTag || '').toUpperCase();
    if (!supported.has(tag)) return null;
    return this.resolveAssetPath(`assets/leaders/hoi4/${tag}.png`);
  }

  public collapsePoliticalSelectorPanel(): void {
    this.activeSelectorKey = null;
    this.renderPoliticalSelectors();
  }

  public setCurrentCountryTag(countryTag: string) {
    if (!countryTag) return;
    this.currentCountryTag = countryTag.toUpperCase();
    this.updateCountryBadge();
    this.applyCountryData();
  }

  public getCountryDetails(countryTag: string): {
    name: string;
    leader: string;
    ideology: string;
    party: string;
    history: string;
  } {
    const tag = (countryTag || this.currentCountryTag).toUpperCase();
    const previousTag = this.currentCountryTag;
    this.currentCountryTag = tag;

    try {
      const country = this.countriesData?.[tag] || null;
      const politics = this.startingPoliticsData?.[tag] || null;

      const fallbackIdeologyNames: Record<string, string> = {
        FRA: '民主主义',
        USA: '民主主义',
        ENG: '民主主义',
        GER: '法西斯主义',
        ITA: '法西斯主义',
        JAP: '法西斯主义',
        SOV: '共产主义',
      };

      const leader = this.resolveLeaderNameFromHistory(politics)
        || this.fallbackLeaderNames[tag]
        || tag;

      const rulingParty = politics?.set_politics?.ruling_party;
      const ideology = this.translateIdeology(rulingParty)
        || fallbackIdeologyNames[tag]
        || '未知';

      const party = this.resolvePartyNameFromHistory(politics, rulingParty)
        || `${ideology}阵营`;

      const localizedCountryName = this.localizeToken(tag);
      const countryName = localizedCountryName
        || this.localizeToken(country?.name)
        || String(country?.name || tag).replace(/"/g, '');

      const history = this.buildCountryHistorySummary(politics);

      return {
        name: countryName,
        leader: String(leader).replace(/"/g, ''),
        ideology,
        party,
        history,
      };
    } finally {
      this.currentCountryTag = previousTag;
    }
  }

  private updateCountryBadge(country?: any, ideology?: string | null) {
    const flagEl = document.getElementById('player-flag') as HTMLElement | null;
    const flagFaceEl = document.getElementById('player-flag-face') as HTMLElement | null;
    if (!flagEl) return;

    const localizedCountryName = this.localizeToken(this.currentCountryTag) || this.currentCountryTag;
    flagEl.setAttribute('title', localizedCountryName);

    const setFlagPalette = (rr: number, gg: number, bb: number) => {
      flagEl.style.setProperty('--flag-primary', `rgb(${rr}, ${gg}, ${bb})`);
      flagEl.style.setProperty(
        '--flag-secondary',
        `rgb(${Math.max(0, Math.round(rr * 0.58))}, ${Math.max(0, Math.round(gg * 0.58))}, ${Math.max(0, Math.round(bb * 0.58))})`
      );
      if (flagFaceEl) {
        flagFaceEl.style.background = `linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 40%), linear-gradient(180deg, rgb(${rr}, ${gg}, ${bb}) 0%, rgb(${Math.max(0, Math.round(rr * 0.58))}, ${Math.max(0, Math.round(gg * 0.58))}, ${Math.max(0, Math.round(bb * 0.58))}) 100%)`;
      }
    };

    const rawColor = country?.color;
    if (Array.isArray(rawColor) && rawColor.length >= 3) {
      const [r, g, b] = rawColor;
      const rr = r <= 1 ? Math.round(r * 255) : Math.round(r);
      const gg = g <= 1 ? Math.round(g * 255) : Math.round(g);
      const bb = b <= 1 ? Math.round(b * 255) : Math.round(b);
      setFlagPalette(rr, gg, bb);
    } else {
      setFlagPalette(164, 37, 37);
    }

    const normalizedIdeology = ideology && ['democratic', 'fascism', 'communism', 'neutrality'].includes(ideology)
      ? ideology
      : null;
    const flagAsset = normalizedIdeology
      ? this.resolveAssetPath(`assets/flags/hoi4/${this.currentCountryTag}_${normalizedIdeology}.png`)
      : null;
    if (flagFaceEl && flagAsset) {
      flagFaceEl.style.background = `url('${flagAsset}') center / 100% 100% no-repeat`;
    }
  }

  private async loadData() {
    try {
      // Use relative paths or import.meta.env.BASE_URL to handle Vite's base path
      const baseUrl = import.meta.env.BASE_URL || '/';
      const dataUrl = (fileName: string): string => `${baseUrl}assets/data/${fileName}?v=${this.dataAssetVersion}`;
      const [countriesRes, politicsRes, localizationRes, taxonomyRes, spiritIconMapRes, characterIconMapRes] = await Promise.all([
        fetch(dataUrl('countries.json')),
        fetch(dataUrl('starting_politics.json')),
        fetch(dataUrl('localization.json')),
        fetch(dataUrl('political_taxonomy.json')),
        fetch(dataUrl('spirit_icon_map.json')),
        fetch(dataUrl('character_icon_map.json'))
      ]);

      if (countriesRes.ok) {
        const countries = await countriesRes.json();
        if (countries && typeof countries === 'object' && !Array.isArray(countries)) {
          this.countriesData = countries;
        } else {
          console.warn('countries.json 格式不正确，已降级为默认 HUD 数据');
        }
      } else {
        console.error("Failed to load countries.json:", countriesRes.statusText);
      }

      if (politicsRes.ok) {
        const politics = await politicsRes.json();
        if (politics && typeof politics === 'object' && !Array.isArray(politics)) {
          this.startingPoliticsData = politics;
        } else {
          console.warn('starting_politics.json 格式不正确，已降级为默认 HUD 数据');
        }
      } else {
        console.error("Failed to load starting_politics.json:", politicsRes.statusText);
      }

      if (localizationRes.ok) {
        const localization = await localizationRes.json();
        if (localization && typeof localization === 'object' && !Array.isArray(localization)) {
          this.localizationData = localization;
          this.localizationDataLower = {};
          for (const [k, v] of Object.entries(localization)) {
            if (typeof v === 'string') {
              this.localizationDataLower[k.toLowerCase()] = v;
            }
          }
        }
      } else {
        console.warn('localization.json 未找到，使用 token 格式化回退显示');
      }

      if (taxonomyRes.ok) {
        const taxonomy = await taxonomyRes.json();
        if (taxonomy && typeof taxonomy === 'object') {
          this.politicalTaxonomy = {
            ideas: (taxonomy.ideas && typeof taxonomy.ideas === 'object') ? taxonomy.ideas : {},
            characters: (taxonomy.characters && typeof taxonomy.characters === 'object') ? taxonomy.characters : {},
          };
        }
      } else {
        console.warn('political_taxonomy.json 未找到，使用关键词分类回退逻辑');
      }

      if (spiritIconMapRes.ok) {
        const iconMap = await spiritIconMapRes.json();
        if (iconMap && typeof iconMap === 'object' && !Array.isArray(iconMap)) {
          this.spiritIconMap = iconMap;
        }
      } else {
        console.warn('spirit_icon_map.json 未找到，国家精神图标将回退为通用占位图');
      }

      if (characterIconMapRes.ok) {
        const iconMap = await characterIconMapRes.json();
        if (iconMap && typeof iconMap === 'object' && !Array.isArray(iconMap)) {
          this.characterIconMap = iconMap;
        }
      } else {
        console.warn('character_icon_map.json 未找到，人物候选图标将回退为通用顾问框');
      }

      this.applyCountryData();
    } catch (error) {
      console.error("Failed to load HOI4 data:", error);
    }
  }

  private applyCountryData() {
    const fallbackIdeologyNames: Record<string, string> = {
      FRA: '民主主义',
      USA: '民主主义',
      ENG: '民主主义',
      GER: '法西斯主义',
      ITA: '法西斯主义',
      JAP: '法西斯主义',
      SOV: '共产主义',
    };

    const country = this.countriesData?.[this.currentCountryTag];
    const politics = this.startingPoliticsData?.[this.currentCountryTag];

    const leaderNameEl = document.getElementById('ui-leader-name');
    const leaderPortraitFrameEl = document.getElementById('ui-leader-portrait-frame') as HTMLElement | null;
    const partyNameEl = document.getElementById('ui-party-name');
    const ideologyEl = document.getElementById('ui-ideology-name');
    const electionInfoEl = document.getElementById('ui-election-info');
    const leaderPortraitEl = document.getElementById('ui-leader-portrait');
    const leaderTraitsEl = document.getElementById('ui-leader-traits');

    const fallbackLeader = this.fallbackLeaderNames[this.currentCountryTag] || this.currentCountryTag;
    const fallbackIdeology = fallbackIdeologyNames[this.currentCountryTag] || '未知';

    const rulingParty = politics?.set_politics?.ruling_party;
    const ideologyName = this.translateIdeology(rulingParty) || fallbackIdeology;
    const leaderName = politics ? this.resolveLeaderNameFromHistory(politics) : null;
    const resolvedLeaderName = String(leaderName || fallbackLeader).replace(/"/g, '');
    const resolvedCountryName = this.localizeToken(this.currentCountryTag)
      || this.localizeToken(country?.name)
      || this.currentCountryTag;

    this.updateCountryBadge(country, rulingParty);

    if (leaderNameEl) {
      leaderNameEl.textContent = resolvedLeaderName;
    }
    if (partyNameEl) {
      const partyName = this.resolvePartyNameFromHistory(politics, rulingParty);
      partyNameEl.textContent = partyName || `${ideologyName}阵营`;
    }
    if (ideologyEl) {
      ideologyEl.textContent = ideologyName;
    }
    if (electionInfoEl) {
      electionInfoEl.textContent = this.buildElectionInfoText(politics?.set_politics);
    }
    if (leaderPortraitFrameEl) {
      const portraitAsset = this.getLeaderPortraitAssetPath(this.currentCountryTag);
      leaderPortraitFrameEl.style.backgroundImage = portraitAsset
        ? `linear-gradient(180deg, rgba(33, 36, 39, 0.22) 0%, rgba(8, 10, 12, 0.45) 100%), url('${portraitAsset}')`
        : "linear-gradient(180deg, rgba(33, 36, 39, 0.35) 0%, rgba(8, 10, 12, 0.55) 100%), url('assets/hoi4_ui/gfx/leaders/leader_unknown.png')";
      leaderPortraitFrameEl.style.backgroundPosition = 'center, center top';
      leaderPortraitFrameEl.style.backgroundSize = 'cover, cover';
      leaderPortraitFrameEl.style.backgroundRepeat = 'no-repeat, no-repeat';
    }
    if (leaderPortraitEl) {
      leaderPortraitEl.textContent = this.currentCountryTag;
      const portraitTitle = `${resolvedCountryName} · ${resolvedLeaderName}`;
      leaderPortraitEl.setAttribute('title', portraitTitle);
      leaderPortraitEl.parentElement?.setAttribute('title', portraitTitle);
    }
    if (leaderTraitsEl) {
      const trait = this.getLeaderTraitByIdeology(rulingParty);
      leaderTraitsEl.textContent = trait.icon;
      leaderTraitsEl.setAttribute('title', trait.title);
    }

    this.renderIdeologyChart(politics?.set_popularities);

    const ideaTokens = this.extractIdeaTokens(politics);
    const recruitTokens = this.extractRecruitTokens(politics);

    this.prepareSelectorData(ideaTokens, recruitTokens, politics);

    this.renderNationalSpirits(ideaTokens);
    this.activeSelectorKey = null;
    this.renderPoliticalSelectors();
    requestAnimationFrame(() => this.syncPoliticalOverviewLayout());
  }

  public syncPoliticalOverviewLayout(): void {
    const politicalPanelEl = document.getElementById('political-panel') as HTMLElement | null;
    const focusButtonEl = document.querySelector('.leader-focus-tree-btn') as HTMLElement | null;
    const leaderSidebarEl = document.querySelector('.leader-sidebar') as HTMLElement | null;
    const portraitContainerEl = document.querySelector('.leader-portrait-container') as HTMLElement | null;
    const countryInfoContainerEl = document.querySelector('.country-info-container') as HTMLElement | null;
    if (!politicalPanelEl?.classList.contains('visible') || !focusButtonEl || !leaderSidebarEl || !portraitContainerEl || !countryInfoContainerEl) {
      return;
    }

    focusButtonEl.style.height = '';
    focusButtonEl.style.minHeight = '';

    const sidebarStyle = window.getComputedStyle(leaderSidebarEl);
    const sidebarGap = Number.parseFloat(sidebarStyle.rowGap || sidebarStyle.gap || '0') || 0;
    const portraitHeight = Math.ceil(portraitContainerEl.getBoundingClientRect().height);
    const countryInfoHeight = Math.ceil(countryInfoContainerEl.getBoundingClientRect().height);
    const focusButtonHeight = Math.max(54, countryInfoHeight - portraitHeight - sidebarGap);

    if (focusButtonHeight > 0) {
      focusButtonEl.style.height = `${focusButtonHeight}px`;
      focusButtonEl.style.minHeight = `${focusButtonHeight}px`;
    }
  }

  private resolveLeaderNameFromHistory(politics: any): string | null {
    const normalizeCharacterId = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;

      const localized = this.localizeToken(trimmed);
      if (localized) return localized;

      const withoutTag = trimmed.startsWith(`${this.currentCountryTag}_`)
        ? trimmed.slice(this.currentCountryTag.length + 1)
        : trimmed;
      if (!withoutTag) return null;
      return withoutTag
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    };

    const promoted = normalizeCharacterId(politics?.promote_character);
    if (promoted) return promoted;

    const recruit = politics?.recruit_character;
    if (!Array.isArray(recruit) || recruit.length === 0) return null;

    const ideology = politics?.set_politics?.ruling_party;
    const ideologyLeaderHints: Record<string, string[]> = {
      democratic: ['roosevelt', 'chamberlain', 'daladier'],
      fascism: ['hitler', 'mussolini', 'hirohito'],
      communism: ['stalin', 'lenin'],
      neutrality: ['king', 'regent', 'emperor'],
    };

    const ids = recruit.filter((v: unknown): v is string => typeof v === 'string');
    const byTag = ids.filter((id) => id.startsWith(`${this.currentCountryTag}_`));
    const pool = byTag.length > 0 ? byTag : ids;

    const hints = ideologyLeaderHints[ideology as string] || [];
    for (const hint of hints) {
      const matched = pool.find((id) => id.toLowerCase().includes(hint));
      const name = normalizeCharacterId(matched);
      if (name) return name;
    }

    return normalizeCharacterId(pool[0]);
  }

  private translateIdeology(ideology?: string): string {
    const map: Record<string, string> = {
      democratic: '民主主义',
      fascism: '法西斯主义',
      communism: '共产主义',
      neutrality: '中立主义',
    };
    return ideology ? (map[ideology] || ideology) : '';
  }

  private buildElectionInfoText(setPolitics: any): string {
    if (!setPolitics) return '暂无选举数据';
    const electionsAllowed = setPolitics.elections_allowed === 'yes';
    if (!electionsAllowed) return '没有选举';
    const last = typeof setPolitics.last_election === 'string' ? setPolitics.last_election : '未知';
    const freq = Number(setPolitics.election_frequency);
    return Number.isFinite(freq) ? `上次选举: ${last}（每${freq}个月）` : `上次选举: ${last}`;
  }

  private getLeaderTraitByIdeology(ideology?: string): { icon: string; title: string } {
    const map: Record<string, { icon: string; title: string }> = {
      democratic: { icon: '🗳️', title: '议会政治' },
      fascism: { icon: '⚔️', title: '极权动员' },
      communism: { icon: '☭', title: '先锋党领导' },
      neutrality: { icon: '👑', title: '中立统治' },
    };
    return map[ideology || ''] || { icon: '•', title: '暂无特质' };
  }

  private renderIdeologyChart(popularities: any): void {
    const chartEl = document.getElementById('ui-ideology-chart');
    const breakdownEl = document.getElementById('ui-ideology-breakdown');
    if (!chartEl) return;

    if (!popularities || typeof popularities !== 'object') {
      chartEl.setAttribute('title', '暂无意识形态数据');
      if (breakdownEl) {
        breakdownEl.innerHTML = '<div class="ideology-breakdown-empty">暂无支持度</div>';
      }
      return;
    }

    const entries = Object.entries(popularities)
      .map(([key, value]) => ({ key, value: Number(value) }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => b.value - a.value);

    const lines = entries.map((entry) => `${this.translateIdeology(entry.key)}: ${entry.value}%`);

    chartEl.setAttribute('title', lines.length > 0 ? lines.join('\n') : '暂无意识形态数据');

    if (breakdownEl) {
      breakdownEl.innerHTML = '';
      if (entries.length === 0) {
        breakdownEl.innerHTML = '<div class="ideology-breakdown-empty">暂无支持度</div>';
      } else {
        for (const entry of entries.slice(0, 4)) {
          const row = document.createElement('div');
          row.className = 'ideology-breakdown-row';
          row.style.setProperty('--ideology-fill', String(Math.max(0, Math.min(1, entry.value / 100))));
          row.style.setProperty('--ideology-accent', this.getIdeologyAccent(entry.key));

          const label = document.createElement('span');
          label.className = 'ideology-breakdown-label';
          label.textContent = this.translateIdeology(entry.key);

          const value = document.createElement('span');
          value.className = 'ideology-breakdown-value';
          value.textContent = `${this.formatSupportValue(entry.value)}%`;

          row.appendChild(label);
          row.appendChild(value);
          breakdownEl.appendChild(row);
        }
      }
    }
  }

  private formatSupportValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  private getIdeologyAccent(ideology: string): string {
    const accents: Record<string, string> = {
      democratic: 'rgba(43, 108, 176, 0.9)',
      fascism: 'rgba(197, 48, 48, 0.9)',
      communism: 'rgba(185, 78, 28, 0.9)',
      neutrality: 'rgba(122, 133, 150, 0.9)',
    };
    return accents[ideology] || 'rgba(160, 174, 192, 0.7)';
  }

  private extractIdeaTokens(politics: any): string[] {
    return this.collectStringTokensByKey(politics, 'add_ideas');
  }

  private extractRecruitTokens(politics: any): string[] {
    return this.collectStringTokensByKey(politics, 'recruit_character');
  }

  private extractDesignTeamAssignments(politics: any): Array<{ token: string; category: IndustrySelectorKey }> {
    const out: Array<{ token: string; category: IndustrySelectorKey }> = [];
    const isDatedHistoryKey = (key: string): boolean => /^\d{3,4}\.\d{1,2}\.\d{1,2}$/.test(key);

    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const record = node as Record<string, unknown>;
      const designTeam = typeof record.design_team === 'string' ? record.design_team : null;
      if (designTeam) {
        const token = this.normalizePoliticalToken(designTeam);
        const category = this.classifyDesignTeamCategory(token, record.type);
        if (token && category) {
          out.push({ token, category });
        }
      }

      for (const [k, value] of Object.entries(record)) {
        if (isDatedHistoryKey(k)) continue;
        walk(value);
      }
    };

    walk(politics);
    return out;
  }

  private collectStringTokensByKey(source: any, keyName: string): string[] {
    const out: string[] = [];

    const collectFromValue = (value: unknown) => {
      if (typeof value === 'string') {
        out.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          collectFromValue(item);
        }
      }
    };

    const isDatedHistoryKey = (key: string): boolean => /^\d{3,4}\.\d{1,2}\.\d{1,2}$/.test(key);

    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const record = node as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(record, keyName)) {
        collectFromValue(record[keyName]);
      }

      for (const [k, value] of Object.entries(record)) {
        // 跳过按日期触发的历史脚本块，避免把后续年份法案误当作开局法案
        if (isDatedHistoryKey(k)) continue;
        walk(value);
      }
    };

    walk(source);
    return Array.from(new Set(out));
  }

  private resolveLocalizationValue(value: string, depth: number = 0): string {
    if (!value) return value;
    let text = value.trim().replace(/§./g, '');

    const fullRef = text.match(/^\$([^$]+)\$$/);
    if (fullRef && depth < 6) {
      const nested = this.localizeToken(fullRef[1]);
      if (nested) return nested;
    }

    if (depth < 6 && text.includes('$')) {
      text = text.replace(/\$([^$]+)\$/g, (_m, refKey) => {
        const nested = this.localizeToken(String(refKey));
        return nested || String(refKey);
      });
    }

    return text.trim();
  }

  private lookupLocalizationEntry(keys: Iterable<string>): string | null {
    for (const key of keys) {
      const direct = this.localizationData[key];
      if (typeof direct === 'string' && direct.trim()) {
        const resolved = this.resolveLocalizationValue(direct, 0);
        if (/^\[[^\]]+\]$/.test(resolved)) {
          continue;
        }
        return resolved;
      }

      const lower = this.localizationDataLower[key.toLowerCase()];
      if (typeof lower === 'string' && lower.trim()) {
        const resolved = this.resolveLocalizationValue(lower, 0);
        if (/^\[[^\]]+\]$/.test(resolved)) {
          continue;
        }
        return resolved;
      }
    }

    return null;
  }

  private getCurrentCountryIdeology(): string | null {
    const rulingParty = this.startingPoliticsData?.[this.currentCountryTag]?.set_politics?.ruling_party;
    return typeof rulingParty === 'string' && rulingParty.trim() ? rulingParty.trim().toLowerCase() : null;
  }

  private collectTokenStemCandidates(token: string | undefined | null): string[] {
    if (!token || typeof token !== 'string') return [];

    const seeds = [
      token.trim(),
      token.trim().replace(/^mio:/i, ''),
      this.normalizePoliticalToken(token.trim()),
    ].filter(Boolean);

    const queue: string[] = [];
    const seen = new Set<string>();
    const out: string[] = [];

    const push = (value: string | undefined | null) => {
      const clean = String(value || '').trim().replace(/^mio:/i, '');
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
      queue.push(clean);
    };

    seeds.forEach(push);

    while (queue.length > 0) {
      const current = queue.shift()!;

      const withoutTag = current.match(/^[A-Z0-9]{3}_(.+)$/);
      if (withoutTag) push(withoutTag[1]);

      const organizationSuffix = current.match(/^(.*)_organization$/i);
      if (organizationSuffix) push(organizationSuffix[1]);

      const lifecycleSuffix = current.match(/^(.*)_(?:final|improved)$/i);
      if (lifecycleSuffix) push(lifecycleSuffix[1]);

      const numericSuffix = current.match(/^(.*)_\d+(?:_\d+)*$/);
      if (numericSuffix) push(numericSuffix[1]);

      const branchSuffix = current.match(/^(.*)_(?:usa|eng|ger|jap|sov|fra|ita|bra|arg|civ|mil|dock)$/i);
      if (branchSuffix) push(branchSuffix[1]);

      const dlcSuffix = current.match(/^(.*?)_(?:no_[a-z0-9]+|aat|nsb|bba|mtg|lr|la|tfv|dod|wtt)$/i);
      if (dlcSuffix) push(dlcSuffix[1]);

      const specialtySuffix = current.match(
        /^(.*)_(?:artillery|small_arms|infantry|armor|armour|tank|naval|aircraft|fighter|bomber|cas|motorized|mechanized|electronic|electronics)$/i
      );
      if (specialtySuffix) push(specialtySuffix[1]);
    }

    return out;
  }

  private formatTokenLabel(token: string): string {
    const normalized = this.normalizePoliticalToken(token);
    const lawNameMap: Record<string, string> = {
      disarmed_nation: '解除武装的国家',
      volunteer_only: '仅限志愿兵',
      limited_conscription: '有限征兵',
      extensive_conscription: '广泛征兵',
      service_by_requirement: '按要求服兵役',
      all_adults_serve: '全民服役',
      scraping_the_barrel: '榨干人力',
      free_trade: '自由贸易',
      export_focus: '出口导向',
      limited_exports: '限制出口',
      closed_economy: '封闭经济',
      civilian_economy: '民用经济',
      early_mobilization: '初步动员',
      partial_mobilization: '部分动员',
      war_economy: '战时经济',
      total_mobilization: '全面动员',
    };

    if (lawNameMap[normalized]) {
      return lawNameMap[normalized];
    }

    const overrideLabel = this.getTokenLabelOverride(normalized) || this.getTokenLabelOverride(token);
    if (overrideLabel) return overrideLabel;

    const localized = this.localizeToken(normalized) || this.localizeToken(token);
    if (localized) return localized;

    const taxonomyName = this.politicalTaxonomy.ideas[normalized]?.name || this.politicalTaxonomy.characters[normalized]?.name;
    if (taxonomyName && taxonomyName !== normalized) return taxonomyName;

    const cleaned = normalized
      .replace(/^mio:/i, '')
      .replace(/_organization$/i, '');
    const withoutTag = cleaned.replace(/^[A-Z0-9]{3}_/, '');
    return withoutTag
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private renderNationalSpirits(ideas: string[]): void {
    const spiritListEl = document.getElementById('ui-national-spirits');
    if (!spiritListEl) return;

    this.hideSharedTooltip();
    spiritListEl.innerHTML = '';

    const spiritIdeas = ideas.filter((token) => this.getIdeaCategory(token) === 'spirit');
    const top = spiritIdeas.slice(0, 8);
    if (top.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'spirit-empty';
      empty.textContent = '暂无国家精神';
      spiritListEl.appendChild(empty);
      return;
    }

    for (const idea of top) {
      const label = this.formatTokenLabel(idea);
      const visual = this.getNationalSpiritVisual(idea);
      const description = this.getNationalSpiritDescription(idea);
      const tooltipText = [label, description]
        .filter((part) => typeof part === 'string' && part.trim().length > 0)
        .join('\n');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spirit-icon';
      button.setAttribute('aria-label', label);
      if (tooltipText) {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showSpiritTooltip(label, description, button);
        });
        button.addEventListener('mouseenter', () => {
          this.showSpiritTooltip(label, description, button);
        });
        button.addEventListener('mouseleave', () => {
          this.scheduleSpiritTooltipHide();
        });
        button.addEventListener('focus', () => {
          this.showSpiritTooltip(label, description, button);
        });
        button.addEventListener('blur', () => {
          this.scheduleSpiritTooltipHide();
        });
      }

      const art = document.createElement('span');
      art.className = 'spirit-icon-art';
      art.style.backgroundImage = visual.nativeIcon
        ? `url('${visual.artPath}')`
        : `linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(6,6,8,0.36) 100%), url('${visual.artPath}')`;
      if (visual.nativeIcon) {
        button.dataset.nativeIcon = 'true';
        art.dataset.nativeIcon = 'true';
      }
      if (this.isHorizontalSplitSpriteAsset(visual.artPath)) {
        art.dataset.splitSprite = 'true';
      }

      button.appendChild(art);
      if (visual.badge) {
        const badge = document.createElement('span');
        badge.className = 'spirit-icon-badge';
        badge.textContent = visual.badge;
        button.appendChild(badge);
      }
      spiritListEl.appendChild(button);
    }
  }

  private getNationalSpiritVisual(token: string): { badge?: string; artPath: string; categoryLabel: string; nativeIcon?: boolean } {
    const mappedIcon = this.getPoliticalIconAssetPath(token);
    if (mappedIcon) {
      return {
        artPath: mappedIcon,
        categoryLabel: '',
        nativeIcon: true,
      };
    }

    return {
      artPath: this.resolveAssetPath('assets/hoi4_ui/gfx/interface/ideas_icon.png'),
      categoryLabel: '国家精神',
    };
  }

  private getNationalSpiritDescription(token: string): string {
    return this.getTokenGameDescription(token) || '';
  }

  private renderPoliticalSelectors(): void {
    this.renderSelectorRow('ui-government-row', this.buildGovernmentSlots());
    this.renderSelectorRow('ui-industry-row', this.buildIndustrySlots());
    this.renderSelectorRow('ui-military-row', this.buildMilitarySlots());
    this.renderSelectorPanel();
  }

  private renderSelectorRow(containerId: string, slots: PoliticalSlot[]): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    for (const slot of slots) {
      const options = this.selectorOptionsByKey[slot.key] || [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'politics-slot';
      button.dataset.selectorKey = slot.key;

      if (slot.filled) {
        button.classList.add('filled');
      } else {
        button.classList.add('empty');
      }

      if (this.activeSelectorKey === slot.key) {
        button.classList.add('active');
      }

      if (options.length === 0) {
        button.disabled = true;
      }

      const frame = document.createElement('span');
      frame.className = 'politics-slot-frame';
      if (slot.artPath) {
        frame.style.backgroundImage = `url('${slot.artPath}')`;
        if (slot.nativeIcon) {
          frame.dataset.nativeIcon = 'true';
          button.dataset.nativeIcon = 'true';
        }
        if (this.isHorizontalSplitSpriteAsset(slot.artPath)) {
          frame.dataset.splitSprite = 'true';
        }
      }

      // Only fall back to a text badge when we truly have no slot artwork.
      if (!slot.nativeIcon && !slot.artPath) {
        const badge = document.createElement('span');
        badge.className = 'politics-slot-badge';
        badge.textContent = slot.icon;
        frame.appendChild(badge);
      }

      if (!slot.nativeIcon && slot.advisorTypeFrame) {
        const advisorTypeIcon = document.createElement('span');
        advisorTypeIcon.className = 'politics-slot-advisor-type-icon';
        advisorTypeIcon.style.setProperty('--advisor-type-frame', String(slot.advisorTypeFrame - 1));
        frame.appendChild(advisorTypeIcon);
      }

      const title = document.createElement('span');
      title.className = 'politics-slot-title';
      title.textContent = slot.title;

      const value = document.createElement('span');
      value.className = 'politics-slot-value';
      value.textContent = slot.value;

      button.appendChild(frame);
      button.appendChild(title);
      button.appendChild(value);

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (options.length === 0) return;
        this.activeSelectorKey = this.activeSelectorKey === slot.key ? null : slot.key;
        this.renderPoliticalSelectors();
      });

      container.appendChild(button);
    }
  }

  private renderSelectorPanel(): void {
    const panelEl = document.getElementById('ui-selector-panel') as HTMLElement | null;
    const politicalPanelEl = document.getElementById('political-panel') as HTMLElement | null;
    const contentEl = document.getElementById('ui-selector-content') as HTMLElement | null;
    const kickerEl = document.getElementById('ui-selector-kicker') as HTMLElement | null;
    const titleEl = document.getElementById('ui-selector-title') as HTMLElement | null;
    const subtitleEl = document.getElementById('ui-selector-subtitle') as HTMLElement | null;
    const currentEl = document.getElementById('ui-selector-current') as HTMLElement | null;
    const optionsEl = document.getElementById('ui-selector-options') as HTMLElement | null;

    this.hideSharedTooltip();

    if (!panelEl || !contentEl || !kickerEl || !titleEl || !subtitleEl || !currentEl || !optionsEl) {
      return;
    }

    const key = this.activeSelectorKey;
    const options = key ? (this.selectorOptionsByKey[key] || []) : [];
    if (!key || options.length === 0) {
      politicalPanelEl?.classList.remove('selector-open');
      panelEl.hidden = true;
      contentEl.hidden = true;
      optionsEl.innerHTML = '';
      return;
    }

    const descriptor = this.getSelectorDescriptor(key);
    const currentToken = this.selectedTokenBySelector[key];
    const availableSet = this.selectorAvailableOptionsByKey[key] || new Set<string>();

    politicalPanelEl?.classList.add('selector-open');
    panelEl.hidden = false;
    contentEl.hidden = false;

    kickerEl.textContent = descriptor.group;
    titleEl.textContent = descriptor.title;
    subtitleEl.textContent = descriptor.subtitle;
    currentEl.textContent = currentToken
      ? `当前选择: ${this.formatTokenLabel(currentToken)}`
      : '当前槽位为空，点击下方候选进行任命。';

    optionsEl.innerHTML = '';

    for (const token of options) {
      const state = this.getSelectorOptionState(key, token, availableSet);
      const optionLabel = this.formatTokenLabel(token);
      const optionDescription = this.getSelectorOptionDescription(key, token);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `selector-option ${state.kind}`;
      button.setAttribute('aria-disabled', String(!state.selectable));
      button.setAttribute('aria-label', optionLabel);
      button.tabIndex = state.selectable ? 0 : -1;

      const icon = document.createElement('span');
      icon.className = 'selector-option-icon';
      const nativeOptionArtPath = this.getCharacterIconAssetPath(token) || this.getPoliticalIconAssetPath(token);
      const optionArtPath = nativeOptionArtPath || this.getSelectorListArtPath(key, token);
      icon.style.backgroundImage = `url('${optionArtPath}')`;
      if (nativeOptionArtPath) {
        icon.dataset.nativeIcon = 'true';
        button.dataset.nativeIcon = 'true';
      }
      if (this.isHorizontalSplitSpriteAsset(optionArtPath)) {
        icon.dataset.splitSprite = 'true';
      }

      if (!nativeOptionArtPath) {
        const iconGlyph = document.createElement('span');
        iconGlyph.className = 'selector-option-icon-glyph';
        iconGlyph.textContent = descriptor.icon;
        icon.appendChild(iconGlyph);
      }

      const copy = document.createElement('span');
      copy.className = 'selector-option-copy';

      const optionTitle = document.createElement('span');
      optionTitle.className = 'selector-option-title';
      optionTitle.textContent = optionLabel;

      copy.appendChild(optionTitle);
      if (optionDescription) {
        const optionMeta = document.createElement('span');
        optionMeta.className = 'selector-option-meta';
        optionMeta.textContent = optionDescription;
        copy.appendChild(optionMeta);
      }

      const aside = document.createElement('span');
      aside.className = 'selector-option-aside';

      const status = document.createElement('span');
      status.className = 'selector-option-state';
      status.textContent = state.label;

      const cost = document.createElement('span');
      cost.className = 'selector-option-cost';
      cost.textContent = state.kind === 'current'
        ? '已生效'
        : this.getSelectorOptionCost(key, token);

      aside.appendChild(status);
      aside.appendChild(cost);

      button.appendChild(icon);
      button.appendChild(copy);
      button.appendChild(aside);

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!state.selectable) return;
        this.hideSharedTooltip();
        this.selectSelectorOption(key, token);
      });

      optionsEl.appendChild(button);
    }
  }

  private getSelectorOptionState(
    key: SelectorKey,
    token: string,
    availableSet: Set<string>
  ): { kind: 'current' | 'available' | 'disabled' | 'occupied'; label: string; selectable: boolean } {
    const current = this.selectedTokenBySelector[key];
    if (current === token) {
      return { kind: 'current', label: '当前', selectable: false };
    }

    if (!availableSet.has(token)) {
      return { kind: 'disabled', label: '锁定', selectable: false };
    }

    if (this.isTokenOccupiedBySibling(key, token)) {
      return { kind: 'occupied', label: '已任用', selectable: false };
    }

    return { kind: 'available', label: '可选', selectable: true };
  }

  private isTokenOccupiedBySibling(key: SelectorKey, token: string): boolean {
    return this.getExclusiveSelectorGroup(key)
      .some((otherKey) => otherKey !== key && this.selectedTokenBySelector[otherKey] === token);
  }

  private getExclusiveSelectorGroup(key: SelectorKey): SelectorKey[] {
    switch (key) {
      case 'political_advisor_1':
      case 'political_advisor_2':
      case 'political_advisor_3':
      case 'political_advisor_4':
        return ['political_advisor_1', 'political_advisor_2', 'political_advisor_3', 'political_advisor_4'];
      case 'military_high_command_1':
      case 'military_high_command_2':
      case 'military_high_command_3':
        return ['military_high_command_1', 'military_high_command_2', 'military_high_command_3'];
      default:
        return [];
    }
  }

  private selectSelectorOption(key: SelectorKey, token: string): void {
    const availableSet = this.selectorAvailableOptionsByKey[key] || new Set<string>();
    if (!availableSet.has(token)) return;
    if (this.isTokenOccupiedBySibling(key, token)) return;

    this.selectedTokenBySelector[key] = token;
    this.renderPoliticalSelectors();
  }

  private getIdeaCategory(token: string): string {
    const normalized = this.normalizePoliticalToken(token);
    return this.politicalTaxonomy.ideas[normalized]?.category || this.classifyFallbackIdeaCategory(normalized);
  }

  private getCharacterCategory(token: string): string {
    const normalized = this.normalizePoliticalToken(token);
    return this.politicalTaxonomy.characters[normalized]?.category || '';
  }

  private dedupeTokens(tokens: Array<string | null | undefined>): string[] {
    return Array.from(new Set(tokens.filter((token): token is string => typeof token === 'string' && token.length > 0)));
  }

  private isForeignTaggedToken(token: string): boolean {
    return /^[A-Z0-9]{3}_/i.test(token) && !token.toUpperCase().startsWith(`${this.currentCountryTag}_`);
  }

  private isLawTokenForCurrentCountry(token: string): boolean {
    const upper = token.toUpperCase();
    // TAG_ 前缀仅允许当前国家
    if (/^[A-Z0-9]{3}_/.test(upper)) {
      return upper.startsWith(`${this.currentCountryTag}_`);
    }

    // 允许通用法案 token（无 TAG 前缀）
    return true;
  }

  private tokenMatchesCurrentCountry(token: string): boolean {
    const lowerTag = this.currentCountryTag.toLowerCase();
    const lowerToken = token.toLowerCase();
    return lowerToken.startsWith(`${lowerTag}_`) || lowerToken.endsWith(`_${lowerTag}`) || lowerToken.includes(`_${lowerTag}_`);
  }

  private isHiddenScriptCharacterToken(token: string): boolean {
    const normalized = this.normalizePoliticalToken(token);
    const lower = normalized.toLowerCase();

    if (/(^|_)random_[a-z0-9_]*minister(?:_|$)/i.test(lower)) return true;
    if (/(^|_)placeholder(?:_|$)/i.test(lower)) return true;
    if (/(^|_)dummy(?:_|$)/i.test(lower)) return true;

    return false;
  }

  private filterVisibleCharacterTokens(tokens: string[]): string[] {
    return this.dedupeTokens(tokens).filter((token) => !this.isHiddenScriptCharacterToken(token));
  }

  private pickFirstNonEmptyPools(...pools: string[][]): string[] {
    for (const pool of pools) {
      if (pool.length > 0) return pool;
    }
    return [];
  }

  private getCountryTokenAliases(): Record<string, string> {
    switch (this.currentCountryTag) {
      case 'FRA':
        return {
          FRA_renault_organization: 'renault_fra',
          FRA_hotchkiss_organization: 'FRA_hotchkiss',
          FRA_panhard_organization: 'FRA_panhard',
          FRA_saint_etienne_arsenal_organization: 'FRA_mas_organization',
          FRA_bretagne_shipyard_organization: 'FRA_aeb_organization',
          FRA_loire_shipyard_organization: 'FRA_acl_organization',
          FRA_compagnie_francaise_de_radio_organization: 'sfr',
        };
      default:
        return {};
    }
  }

  private getCountryTokenLabelOverrides(): Record<string, string> {
    switch (this.currentCountryTag) {
      case 'FRA':
        return {
          FRA_acf_organization: '法兰西造船厂',
          FRA_fcm_organization: '地中海冶金和造船厂',
          FRA_aeb_organization: '布列塔尼造船厂',
          FRA_acl_organization: '卢瓦尔造船厂',
          FRA_bloch_organization: '布洛克',
          FRA_amiot_organization: '阿米奥',
          FRA_levasseur_organization: '莱维塞尔',
          FRA_somua_organization: '索玛',
          FRA_mas_organization: '圣艾蒂安兵工厂',
          FRA_schneider_organization: '施耐德',
          famh: 'FAMH公司',
          sfr: '法兰西无线电公司',
        };
      default:
        return {};
    }
  }

  private getTokenLabelOverride(token: string | undefined | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const overrides = this.getCountryTokenLabelOverrides();
    return overrides[token] || null;
  }

  private getCountryIndustrySpecialtyOverrides(): Partial<Record<IndustrySelectorKey, Record<string, string>>> {
    switch (this.currentCountryTag) {
      case 'FRA':
        return {
          industry_tank: {
            renault_fra: '步兵坦克设计商',
            FRA_hotchkiss: '快速坦克设计商',
            FRA_APX: '中型坦克设计商',
            FRA_AMX: '标准化生产',
          },
          industry_naval: {
            FRA_fcm_organization: '护航舰造船厂',
            FRA_aeb_organization: '特遣舰队舰船建造方',
            FRA_acl_organization: '战列线舰船建造方',
            FRA_acf_organization: '突破舰造船厂',
          },
          industry_air: {
            morane_saulnier: '轻型飞机设计商',
            FRA_bloch_organization: '中型飞机设计商',
            FRA_amiot_organization: '重型飞机设计商',
            FRA_levasseur_organization: '舰载飞机设计商',
          },
          industry_materiel: {
            FRA_panhard: '装甲车设计商',
            FRA_somua_organization: '机动车辆制造商',
            FRA_mas_organization: '步兵武器制造商',
            FRA_schneider_organization: '火炮制造商',
          },
          industry_corporation: {
            famh: '工业集团',
            sfr: '电子集团',
          },
        };
      default:
        return {};
    }
  }

  private getIndustrySpecialtyLabel(key: SelectorKey, token: string): string | null {
    if (
      key !== 'industry_tank'
      && key !== 'industry_naval'
      && key !== 'industry_air'
      && key !== 'industry_materiel'
      && key !== 'industry_corporation'
    ) {
      return null;
    }

    const normalized = this.normalizePoliticalToken(token);
    const overrides = this.getCountryIndustrySpecialtyOverrides()[key];
    if (overrides?.[normalized]) {
      return overrides[normalized];
    }

    const label = `${normalized} ${this.formatTokenLabel(normalized)}`.toLowerCase();
    switch (key) {
      case 'industry_tank':
        if (/(light|轻|renault|hotchkiss)/.test(label)) return '轻型坦克设计商';
        if (/(medium|中型|apx|somua)/.test(label)) return '中型坦克设计商';
        if (/(heavy|重型|amx|armor|armour)/.test(label)) return '重型坦克设计商';
        return '装甲载具设计商';
      case 'industry_naval':
        if (/(sub|潜艇)/.test(label)) return '潜艇建造方';
        if (/(escort|destroyer|轻巡|护航)/.test(label)) return '护航舰造船厂';
        if (/(capital|battleship|battlecruiser|carrier|战列|主力舰)/.test(label)) return '主力舰造船厂';
        return '舰船建造方';
      case 'industry_air':
        if (/(light|fighter|轻型|morane)/.test(label)) return '轻型飞机设计商';
        if (/(medium|bomber|中型|bloch)/.test(label)) return '中型飞机设计商';
        if (/(heavy|large|重型|amiot)/.test(label)) return '重型飞机设计商';
        if (/(carrier|naval|cv|舰载|levasseur)/.test(label)) return '舰载飞机设计商';
        return '航空设计商';
      case 'industry_materiel':
        if (/(armored_car|装甲车|panhard)/.test(label)) return '装甲车设计商';
        if (/(motor|vehicle|机动车|somua)/.test(label)) return '机动车辆制造商';
        if (/(infantry|small_arms|步兵|saint_etienne)/.test(label)) return '步兵武器制造商';
        if (/(artillery|gun|火炮|schneider)/.test(label)) return '火炮制造商';
        return '军需装备制造商';
      case 'industry_corporation':
        if (/(radio|electronic|电子)/.test(label)) return '电子集团';
        return '工业集团';
      default:
        return null;
    }
  }

  private getCountryFallbackIndustryCatalog(): Partial<Record<IndustrySelectorKey, string[]>> {
    switch (this.currentCountryTag) {
      case 'FRA':
        return {
          industry_tank: ['renault_fra', 'FRA_hotchkiss', 'FRA_APX', 'FRA_AMX'],
          industry_naval: [
            'FRA_fcm_organization',
            'FRA_aeb_organization',
            'FRA_acl_organization',
            'FRA_acf_organization',
          ],
          industry_air: ['morane_saulnier', 'FRA_bloch_organization', 'FRA_amiot_organization', 'FRA_levasseur_organization'],
          industry_materiel: [
            'FRA_panhard',
            'FRA_somua_organization',
            'FRA_mas_organization',
            'FRA_schneider_organization',
          ],
          industry_corporation: ['famh', 'sfr'],
        };
      case 'ENG':
        return {
          industry_tank: ['vickers_armstrong_eng', 'vauxhall'],
          industry_naval: ['john_brown_company', 'yarrow_shipbuilders', 'harland_wolff', 'cammell_laird'],
          industry_air: ['hawker', 'supermarine', 'de_havilland', 'fairey_aviation', 'avro'],
          industry_materiel: ['royal_arsenal', 'rsaf_enfield'],
          industry_corporation: ['english_electric'],
        };
      default:
        return {};
    }
  }

  private filterIndustryPoolByCatalogOwnership(tokens: string[], category: IndustrySelectorKey): string[] {
    const catalog = this.getCountryFallbackIndustryCatalog();
    const owners = new Map<string, IndustrySelectorKey>();

    for (const [ownerCategory, ownerTokens] of Object.entries(catalog) as Array<[IndustrySelectorKey, string[] | undefined]>) {
      for (const token of ownerTokens || []) {
        owners.set(this.normalizePoliticalToken(token), ownerCategory);
      }
    }

    return tokens.filter((token) => {
      const owner = owners.get(this.normalizePoliticalToken(token));
      return !owner || owner === category;
    });
  }

  private normalizePoliticalToken(token: string): string {
    if (!token) return token;
    const rawToken = token.replace(/^mio:/i, '');
    const aliasedToken = this.getCountryTokenAliases()[rawToken] || rawToken;
    if (this.politicalTaxonomy.ideas[aliasedToken] || this.politicalTaxonomy.characters[aliasedToken]) {
      return aliasedToken;
    }

    const upperTag = this.currentCountryTag.toUpperCase();
    if (!/^[A-Z0-9]{3}_/i.test(aliasedToken)) {
      const countryScopedToken = `${upperTag}_${aliasedToken}`;
      if (this.politicalTaxonomy.ideas[countryScopedToken] || this.politicalTaxonomy.characters[countryScopedToken]) {
        return countryScopedToken;
      }
    }

    return aliasedToken;
  }

  private classifyFallbackIdeaCategory(token: string): string {
    const label = `${token} ${this.localizeToken(token) || ''}`.toLowerCase();

    if (/(tank|armor|armour|panzer|renault|hotchkiss|panhard|amx|装甲|坦克)/.test(label)) {
      return 'industry_tank';
    }
    if (/(morane|bloch|dewoitine|caudron|amiot|latecoere|breguet|liore|levasseur|aviation|aircraft|fighter|bomber|cas|飞机|航空|空军)/.test(label)) {
      return 'industry_air';
    }
    if (/(naval|ship|dock|fleet|carrier|destroyer|submarine|cruiser|海军|舰|船厂|船坞)/.test(label)) {
      return 'industry_naval';
    }
    if (/(famh|arsenal|ordnance|armament|weapon|munitions|equipment|arms|factory|works|company|集团|工业|公司|兵工|军需|武器|装备|工厂)/.test(label)) {
      return 'industry_corporation';
    }

    return '';
  }

  private classifyDesignTeamCategory(token: string, equipmentType: unknown): IndustrySelectorKey | null {
    const type = typeof equipmentType === 'string' ? equipmentType.toLowerCase() : '';
    const label = `${token} ${this.localizeToken(token) || ''}`.toLowerCase();

    if (/(tank|armor|armour)/.test(type)) return 'industry_tank';
    if (/(ship|submarine|destroyer|cruiser|battleship|battlecruiser|carrier|hull)/.test(type)) return 'industry_naval';
    if (/(plane|airframe|fighter|bomber|cas|transport_plane)/.test(type)) return 'industry_air';
    if (/(infantry|artillery|anti_air|anti_tank|truck|motorized|mechanized|support|rocket|train|rifle|gun)/.test(type)) {
      return 'industry_materiel';
    }

    if (/(tank|armor|armour|panzer|renault|hotchkiss|panhard|amx|okmo|morozov|vauxhall|daimler|benz)/.test(label)) {
      return 'industry_tank';
    }
    if (/(naval|dock|ship|fleet|submarine|carrier|cruiser|destroyer|john_brown|yarrow|cammell|harland|wolff|acf)/.test(label)) {
      return 'industry_naval';
    }
    if (/(air|aviation|aircraft|fighter|bomber|hawker|supermarine|de_havilland|fairey|avro|junkers|dornier|messerschmitt|ilyushin)/.test(label)) {
      return 'industry_air';
    }
    if (/(arsenal|ordnance|armament|weapon|munitions|equipment|small_arms|artillery|famh|enfield)/.test(label)) {
      return 'industry_materiel';
    }

    return 'industry_corporation';
  }

  private rankTokensByFrequency(tokens: string[]): string[] {
    const counts = new Map<string, number>();
    const firstSeen = new Map<string, number>();

    tokens.forEach((token, index) => {
      counts.set(token, (counts.get(token) || 0) + 1);
      if (!firstSeen.has(token)) {
        firstSeen.set(token, index);
      }
    });

    return Array.from(counts.keys()).sort((a, b) => {
      const countDelta = (counts.get(b) || 0) - (counts.get(a) || 0);
      if (countDelta !== 0) return countDelta;
      return (firstSeen.get(a) || 0) - (firstSeen.get(b) || 0);
    });
  }

  private pickCurrentSelection(options: string[], activeTokens: string[]): string | undefined {
    const activeSet = new Set(activeTokens);
    return options.find((token) => activeSet.has(token));
  }

  private pickCurrentSelectionByDisplay(options: string[], activeTokens: string[]): string | undefined {
    const activeKeys = new Set(
      activeTokens
        .map((token) => this.getTokenDisplayDedupKey(token))
        .filter(Boolean)
    );
    return options.find((token) => activeKeys.has(this.getTokenDisplayDedupKey(token)));
  }

  private getTokenDisplayDedupKey(token: string): string {
    const localized = this.localizeToken(token);
    if (localized) {
      return localized.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const stems = this.collectTokenStemCandidates(token);
    const fallback = stems[stems.length - 1] || this.normalizePoliticalToken(token);
    return fallback.toLowerCase();
  }

  private scoreIndustryTokenRepresentative(token: string): number {
    const normalized = this.normalizePoliticalToken(token).replace(/^mio:/i, '');
    const uppercaseTagCount = (normalized.match(/(?:^|_)[A-Z0-9]{3}(?=_)/g) || []).length;
    let score = normalized.length + normalized.split('_').length * 8;

    if (/_organization$/i.test(normalized)) score += 40;
    if (/_(?:final|improved)$/i.test(normalized)) score += 30;
    if (/_\d+(?:_\d+)*$/i.test(normalized)) score += 24;
    if (uppercaseTagCount > 1) score += (uppercaseTagCount - 1) * 18;

    return score;
  }

  private collapseIndustryTokenVariants(tokens: string[]): string[] {
    const selected = new Map<string, string>();

    for (const token of tokens) {
      const key = this.getTokenDisplayDedupKey(token);
      const existing = selected.get(key);
      if (!existing) {
        selected.set(key, token);
        continue;
      }

      if (this.scoreIndustryTokenRepresentative(token) < this.scoreIndustryTokenRepresentative(existing)) {
        selected.set(key, token);
      }
    }

    return Array.from(selected.values());
  }

  private getCountryLawCandidates(category: LawCategory): string[] {
    const allIdeaEntries = Object.entries(this.politicalTaxonomy.ideas || {});
    const countryTagUpper = this.currentCountryTag.toUpperCase();

    const filtered = allIdeaEntries
      .filter(([, meta]) => meta?.category === category)
      .map(([token]) => token)
      .filter((token) => {
        const upper = token.toUpperCase();
        if (!/^[A-Z0-9]{3}_/.test(upper)) return true;
        return upper.startsWith(`${countryTagUpper}_`);
      });

    return this.dedupeTokens(filtered);
  }

  private getCountryTaggedIdeaCandidates(category: 'industry_tank' | 'industry_naval' | 'industry_air' | 'industry_corporation'): string[] {
    const tagPrefix = `${this.currentCountryTag.toUpperCase()}_`;
    return this.dedupeTokens(
      Object.entries(this.politicalTaxonomy.ideas || {})
        .filter(([token, meta]) => {
          if (meta?.category !== category) return false;
          const upper = token.toUpperCase();
          if (upper.startsWith(tagPrefix)) return true;
          if (/^[A-Z0-9]{3}_/.test(upper)) return false;
          return this.tokenMatchesCurrentCountry(token);
        })
        .map(([token]) => token)
    );
  }

  private pickLawLikeTokens(tokens: string[], category: LawCategory): string[] {
    const loweredCategory = category.toLowerCase();
    const keywordMap: Record<LawCategory, RegExp> = {
      conscription: /(conscription|service|scraping|volunteer|recruit)/i,
      trade: /(trade|export|import|market|embargo|tariff|free[_-]?trade)/i,
      economy: /(economy|economic|mobilization|civilian|war[_-]?economy|industry|industrial)/i,
    };

    const keyed = tokens.filter((token) => {
      const lower = token.toLowerCase();
      if (lower.includes(`${loweredCategory}_law`)) return true;
      if (lower.startsWith(`${loweredCategory}_`)) return true;
      return keywordMap[category].test(lower);
    });

    return this.dedupeTokens(keyed);
  }

  private pickStableLawDefault(options: string[], category: LawCategory): string | undefined {
    if (options.length === 0) return undefined;

    const preferredRegex: Record<LawCategory, RegExp[]> = {
      conscription: [
        /^limited_conscription$/i,
        /^volunteer_only$/i,
        /^disarmed_nation$/i,
      ],
      trade: [
        /^export_focus$/i,
        /^free_trade$/i,
        /^limited_exports$/i,
      ],
      economy: [
        /^civilian_economy$/i,
        /^early_mobilization$/i,
        /^partial_mobilization$/i,
      ],
    };

    for (const regex of preferredRegex[category]) {
      const matched = options.find((token) => regex.test(token));
      if (matched) return matched;
    }

    return options[0];
  }

  private getVanillaLawTrack(category: LawCategory): string[] {
    const tracks: Record<LawCategory, string[]> = {
      conscription: [
        'disarmed_nation',
        'volunteer_only',
        'limited_conscription',
        'extensive_conscription',
        'service_by_requirement',
        'all_adults_serve',
        'scraping_the_barrel',
      ],
      trade: [
        'free_trade',
        'export_focus',
        'limited_exports',
        'closed_economy',
      ],
      economy: [
        'civilian_economy',
        'early_mobilization',
        'partial_mobilization',
        'war_economy',
        'total_mobilization',
      ],
    };

    return tracks[category];
  }

  private constrainToVanillaLawTrack(options: string[], category: LawCategory): string[] {
    const track = this.getVanillaLawTrack(category);
    const available = new Set(options);
    return track.filter((token) => available.has(token));
  }

  private prepareSelectorData(ideas: string[], recruits: string[], politics?: any): void {
    const normalizedIdeas = this.dedupeTokens(ideas.map((token) => this.normalizePoliticalToken(token)));
    const normalizedRecruits = this.filterVisibleCharacterTokens(recruits.map((token) => this.normalizePoliticalToken(token)));
    const designTeamAssignments = politics ? this.extractDesignTeamAssignments(politics) : [];
    const fallbackIndustryCatalog = this.getCountryFallbackIndustryCatalog();

    const tagIdeaPool = this.dedupeTokens(
      Object.keys(this.politicalTaxonomy.ideas || {}).filter((token) => token.startsWith(`${this.currentCountryTag}_`))
    );
    const globalIdeaPool = this.dedupeTokens(Object.keys(this.politicalTaxonomy.ideas || {}));

    const allRecruitPool = normalizedRecruits;
    const tagRecruitPool = this.filterVisibleCharacterTokens(normalizedRecruits.filter((r) => r.startsWith(`${this.currentCountryTag}_`)));
    const taxonomyTagRecruitPool = this.filterVisibleCharacterTokens(
      Object.keys(this.politicalTaxonomy.characters || {}).filter((token) => token.startsWith(`${this.currentCountryTag}_`))
    );

    const crossTagTokens = this.filterVisibleCharacterTokens(
      allRecruitPool.filter((token) => this.isForeignTaggedToken(token) && this.tokenMatchesCurrentCountry(token))
    );

    const recruitPool = this.dedupeTokens([
      ...tagRecruitPool,
      ...crossTagTokens,
      ...allRecruitPool.filter((token) => !this.isForeignTaggedToken(token)),
    ]);

    const conscriptionOptions = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'conscription')
    );

    const tradeOptions = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'trade')
    );

    const economyOptions = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'economy')
    );

    const conscriptionPoolRaw = this.dedupeTokens([
      ...this.pickLawLikeTokens(conscriptionOptions, 'conscription'),
      ...this.getCountryLawCandidates('conscription'),
      ...this.pickLawLikeTokens(tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'conscription'), 'conscription'),
      ...this.pickLawLikeTokens(globalIdeaPool.filter((token) => this.getIdeaCategory(token) === 'conscription'), 'conscription'),
    ]).filter((token) => this.isLawTokenForCurrentCountry(token));
    const conscriptionAvailable = this.constrainToVanillaLawTrack(conscriptionPoolRaw, 'conscription');
    const conscriptionPool = this.getVanillaLawTrack('conscription');

    const tradePoolRaw = this.dedupeTokens([
      ...this.pickLawLikeTokens(tradeOptions, 'trade'),
      ...this.getCountryLawCandidates('trade'),
      ...this.pickLawLikeTokens(tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'trade'), 'trade'),
      ...this.pickLawLikeTokens(globalIdeaPool.filter((token) => this.getIdeaCategory(token) === 'trade'), 'trade'),
    ]).filter((token) => this.isLawTokenForCurrentCountry(token));
    const tradeAvailable = this.constrainToVanillaLawTrack(tradePoolRaw, 'trade');
    const tradePool = this.getVanillaLawTrack('trade');

    const economyPoolRaw = this.dedupeTokens([
      ...this.pickLawLikeTokens(economyOptions, 'economy'),
      ...this.getCountryLawCandidates('economy'),
      ...this.pickLawLikeTokens(tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'economy'), 'economy'),
      ...this.pickLawLikeTokens(globalIdeaPool.filter((token) => this.getIdeaCategory(token) === 'economy'), 'economy'),
    ]).filter((token) => this.isLawTokenForCurrentCountry(token));
    const economyAvailable = this.constrainToVanillaLawTrack(economyPoolRaw, 'economy');
    const economyPool = this.getVanillaLawTrack('economy');


    const activeIndustryTankPool = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'industry_tank')
    );
    const activeIndustryNavalPool = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'industry_naval')
    );
    const activeIndustryAirPool = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'industry_air')
    );
    const activeIndustryCorporationPool = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getIdeaCategory(token) === 'industry_corporation')
    );
    const activeDesignTeamTankPool = this.rankTokensByFrequency(
      designTeamAssignments.filter(({ category }) => category === 'industry_tank').map(({ token }) => token)
    );
    const activeDesignTeamNavalPool = this.rankTokensByFrequency(
      designTeamAssignments.filter(({ category }) => category === 'industry_naval').map(({ token }) => token)
    );
    const activeDesignTeamAirPool = this.rankTokensByFrequency(
      designTeamAssignments.filter(({ category }) => category === 'industry_air').map(({ token }) => token)
    );
    const activeDesignTeamMaterielPool = this.rankTokensByFrequency(
      designTeamAssignments.filter(({ category }) => category === 'industry_materiel').map(({ token }) => token)
    );
    const activeDesignTeamCorporationPool = this.rankTokensByFrequency(
      designTeamAssignments.filter(({ category }) => category === 'industry_corporation').map(({ token }) => token)
    );
    const activePoliticalSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token) === 'political')
    );
    const activeTheoristSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token) === 'theorist')
    );
    const activeArmyChiefSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token) === 'army')
    );
    const activeNavyChiefSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token) === 'navy')
    );
    const activeAirChiefSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token) === 'air')
    );
    const activeHighCommandSelections = this.dedupeTokens(
      normalizedIdeas.filter((token) => this.getCharacterCategory(token).startsWith('high_command'))
    );

    const countryIndustryTankPool = this.collapseIndustryTokenVariants(this.filterIndustryPoolByCatalogOwnership(this.dedupeTokens([
      ...(fallbackIndustryCatalog.industry_tank || []),
      ...activeDesignTeamTankPool,
      ...activeIndustryTankPool,
      ...this.getCountryTaggedIdeaCandidates('industry_tank'),
      ...tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'industry_tank'),
    ]), 'industry_tank'));
    const countryIndustryNavalPool = this.collapseIndustryTokenVariants(this.filterIndustryPoolByCatalogOwnership(this.dedupeTokens([
      ...(fallbackIndustryCatalog.industry_naval || []),
      ...activeDesignTeamNavalPool,
      ...activeIndustryNavalPool,
      ...this.getCountryTaggedIdeaCandidates('industry_naval'),
      ...tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'industry_naval'),
    ]), 'industry_naval'));
    const countryIndustryAirPool = this.collapseIndustryTokenVariants(this.filterIndustryPoolByCatalogOwnership(this.dedupeTokens([
      ...(fallbackIndustryCatalog.industry_air || []),
      ...activeDesignTeamAirPool,
      ...activeIndustryAirPool,
      ...this.getCountryTaggedIdeaCandidates('industry_air'),
      ...tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'industry_air'),
    ]), 'industry_air'));
    const countryIndustryCorporationIdeaPool = this.collapseIndustryTokenVariants(this.dedupeTokens([
      ...activeIndustryCorporationPool,
      ...this.getCountryTaggedIdeaCandidates('industry_corporation'),
      ...tagIdeaPool.filter((token) => this.getIdeaCategory(token) === 'industry_corporation'),
    ]));

    const industryTankPool = countryIndustryTankPool;
    const industryNavalPool = countryIndustryNavalPool;
    const industryAirPool = countryIndustryAirPool;
    const splitCorporationPool = this.partitionIndustryCorporationPools(countryIndustryCorporationIdeaPool);
    const industryMaterielPool = this.collapseIndustryTokenVariants(this.filterIndustryPoolByCatalogOwnership(this.dedupeTokens([
      ...(fallbackIndustryCatalog.industry_materiel || []),
      ...activeDesignTeamMaterielPool,
      ...splitCorporationPool.materiel,
    ]), 'industry_materiel'));
    const industryCorporationPool = this.collapseIndustryTokenVariants(this.filterIndustryPoolByCatalogOwnership(this.dedupeTokens([
      ...(fallbackIndustryCatalog.industry_corporation || []),
      ...activeDesignTeamCorporationPool,
      ...splitCorporationPool.corporation,
    ]), 'industry_corporation'));
    const splitCorporationSelected = this.partitionIndustryCorporationPools(activeIndustryCorporationPool);

    const theoristPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'theorist')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'theorist'))
    );
    const politicalPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'political')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'political'))
    );

    const armyChiefPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'army')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'army'))
    );
    const navyChiefPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'navy')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'navy'))
    );
    const airChiefPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'air')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'air'))
    );

    const armyHighCommandPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_army')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_army')),
      armyChiefPool
    );
    const navyHighCommandPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_navy')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_navy')),
      navyChiefPool
    );
    const airHighCommandPool = this.pickFirstNonEmptyPools(
      this.filterVisibleCharacterTokens(recruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_air')),
      this.filterVisibleCharacterTokens(taxonomyTagRecruitPool.filter((r: string) => this.getCharacterCategory(r) === 'high_command_air')),
      airChiefPool
    );
    const combinedHighCommandPool = this.dedupeTokens([
      ...armyHighCommandPool,
      ...navyHighCommandPool,
      ...airHighCommandPool,
    ]);

    const initialSelections: Partial<Record<SelectorKey, string>> = {
      conscription:
        this.pickCurrentSelection(conscriptionPool, conscriptionOptions) ||
        this.pickStableLawDefault(conscriptionAvailable, 'conscription') ||
        conscriptionPool[0],
      trade:
        this.pickCurrentSelection(tradePool, tradeOptions) ||
        this.pickStableLawDefault(tradeAvailable, 'trade') ||
        tradePool[0],
      economy:
        this.pickCurrentSelection(economyPool, economyOptions) ||
        this.pickStableLawDefault(economyAvailable, 'economy') ||
        economyPool[0],
      political_advisor_1: activePoliticalSelections[0],
      political_advisor_2: activePoliticalSelections[1],
      political_advisor_3: activePoliticalSelections[2],
      political_advisor_4: activePoliticalSelections[3],
      industry_tank: this.pickCurrentSelectionByDisplay(industryTankPool, activeIndustryTankPool),
      industry_naval: this.pickCurrentSelectionByDisplay(industryNavalPool, activeIndustryNavalPool),
      industry_air: this.pickCurrentSelectionByDisplay(industryAirPool, activeIndustryAirPool),
      industry_materiel: this.pickCurrentSelectionByDisplay(industryMaterielPool, splitCorporationSelected.materiel),
      industry_corporation: this.pickCurrentSelectionByDisplay(industryCorporationPool, splitCorporationSelected.corporation),
      industry_theorist: this.pickCurrentSelection(theoristPool, activeTheoristSelections),
      military_army_chief: this.pickCurrentSelection(armyChiefPool, activeArmyChiefSelections),
      military_navy_chief: this.pickCurrentSelection(navyChiefPool, activeNavyChiefSelections),
      military_air_chief: this.pickCurrentSelection(airChiefPool, activeAirChiefSelections),
      military_high_command_1: this.pickCurrentSelection(combinedHighCommandPool, activeHighCommandSelections),
      military_high_command_2: activeHighCommandSelections[1],
      military_high_command_3: activeHighCommandSelections[2],
    };

    this.selectorOptionsByKey = {
      conscription: conscriptionPool,
      trade: tradePool,
      economy: economyPool,
      political_advisor_1: politicalPool,
      political_advisor_2: politicalPool,
      political_advisor_3: politicalPool,
      political_advisor_4: politicalPool,
      industry_tank: industryTankPool,
      industry_naval: industryNavalPool,
      industry_air: industryAirPool,
      industry_materiel: industryMaterielPool,
      industry_corporation: industryCorporationPool,
      industry_theorist: theoristPool,
      military_army_chief: armyChiefPool,
      military_navy_chief: navyChiefPool,
      military_air_chief: airChiefPool,
      military_high_command_1: combinedHighCommandPool,
      military_high_command_2: combinedHighCommandPool,
      military_high_command_3: combinedHighCommandPool,
    };

    this.selectorAvailableOptionsByKey = {
      // 法案链允许完整切换，贴近 HOI4 法案浏览/切换体验
      conscription: new Set(conscriptionPool),
      trade: new Set(tradePool),
      economy: new Set(economyPool),
      political_advisor_1: new Set(politicalPool),
      political_advisor_2: new Set(politicalPool),
      political_advisor_3: new Set(politicalPool),
      political_advisor_4: new Set(politicalPool),
      // 工业顾问：仅保留当前国家显式池和初始已挂载的机构，避免把别国机构混进可选列表
      industry_tank: new Set(countryIndustryTankPool),
      industry_naval: new Set(countryIndustryNavalPool),
      industry_air: new Set(countryIndustryAirPool),
      industry_materiel: new Set(industryMaterielPool),
      industry_corporation: new Set(industryCorporationPool),
      industry_theorist: new Set(theoristPool),
      military_army_chief: new Set(armyChiefPool),
      military_navy_chief: new Set(navyChiefPool),
      military_air_chief: new Set(airChiefPool),
      military_high_command_1: new Set(combinedHighCommandPool),
      military_high_command_2: new Set(combinedHighCommandPool),
      military_high_command_3: new Set(combinedHighCommandPool),
    };

    const allKeys: SelectorKey[] = [
      'conscription',
      'trade',
      'economy',
      'political_advisor_1',
      'political_advisor_2',
      'political_advisor_3',
      'political_advisor_4',
      'industry_tank',
      'industry_naval',
      'industry_air',
      'industry_materiel',
      'industry_corporation',
      'industry_theorist',
      'military_army_chief',
      'military_navy_chief',
      'military_air_chief',
      'military_high_command_1',
      'military_high_command_2',
      'military_high_command_3',
    ];

    for (const key of allKeys) {
      const options = this.selectorOptionsByKey[key] || [];
      const current = this.selectedTokenBySelector[key];
      if (!current || !options.includes(current)) {
        const initialSelection = initialSelections[key];
        if (initialSelection && options.includes(initialSelection)) {
          this.selectedTokenBySelector[key] = initialSelection;
          continue;
        }

        if (key === 'conscription' || key === 'trade' || key === 'economy') {
          if (options.length > 0) {
            this.selectedTokenBySelector[key] = options[0];
          } else {
            delete this.selectedTokenBySelector[key];
          }
          continue;
        }

        delete this.selectedTokenBySelector[key];
      }
    }
  }

  private partitionIndustryCorporationPools(tokens: string[]): { materiel: string[]; corporation: string[] } {
    const keywordMatchers = [
      /materiel/i,
      /equipment/i,
      /weapon/i,
      /small_arms/i,
      /arms/i,
      /ordnance/i,
      /infantry/i,
      /rifle/i,
      /mauser/i,
      /walther/i,
      /arsenal/i,
      /munitions/i,
      /ammunition/i,
      /gun/i,
      /军需/,
      /兵器/,
      /武器/,
      /枪/,
      /炮/,
    ];

    const materiel: string[] = [];
    const corporation: string[] = [];

    for (const token of tokens) {
      const label = `${token} ${this.formatTokenLabel(token)}`;
      const isMateriel = keywordMatchers.some((regex) => regex.test(label));
      if (isMateriel) {
        materiel.push(token);
      } else {
        corporation.push(token);
      }
    }

    if (materiel.length === 0 && corporation.length > 1) {
      materiel.push(corporation.shift()!);
    }

    return {
      materiel: this.dedupeTokens(materiel),
      corporation: this.dedupeTokens(corporation),
    };
  }

  private buildGovernmentSlots(): PoliticalSlot[] {
    return [
      this.createPoliticalSlot('征兵法案', '征', 'conscription'),
      this.createPoliticalSlot('贸易法案', '贸', 'trade'),
      this.createPoliticalSlot('政治顾问 I', '政1', 'political_advisor_1'),
      this.createPoliticalSlot('政治顾问 II', '政2', 'political_advisor_2'),
      this.createPoliticalSlot('政治顾问 III', '政3', 'political_advisor_3'),
      this.createPoliticalSlot('政治顾问 IV', '政4', 'political_advisor_4'),
    ];
  }

  private buildIndustrySlots(): PoliticalSlot[] {
    return [
      this.createPoliticalSlot('坦克军工机构', '甲', 'industry_tank'),
      this.createPoliticalSlot('舰艇军工机构', '舰', 'industry_naval'),
      this.createPoliticalSlot('飞机军工机构', '机', 'industry_air'),
      this.createPoliticalSlot('军需品装备', '械', 'industry_materiel'),
      this.createPoliticalSlot('工业集团', '工', 'industry_corporation'),
      this.createPoliticalSlot('理论家', '学', 'industry_theorist'),
    ];
  }

  private buildMilitarySlots(): PoliticalSlot[] {
    return [
      this.createPoliticalSlot('陆军部长', '陆', 'military_army_chief'),
      this.createPoliticalSlot('海军部长', '海', 'military_navy_chief'),
      this.createPoliticalSlot('空军部长', '空', 'military_air_chief'),
      this.createPoliticalSlot('总司令 I', '统1', 'military_high_command_1'),
      this.createPoliticalSlot('总司令 II', '统2', 'military_high_command_2'),
      this.createPoliticalSlot('总司令 III', '统3', 'military_high_command_3'),
    ];
  }

  private createPoliticalSlot(title: string, icon: string, key: SelectorKey): PoliticalSlot {
    const options = this.selectorOptionsByKey[key] || [];
    const selected = this.selectedTokenBySelector[key];
    const nativeArtPath = this.getCharacterIconAssetPath(selected) || this.getPoliticalIconAssetPath(selected);
    const value = selected
      ? this.formatTokenLabel(selected)
      : (options.length > 0 ? '空缺' : '暂无人选');

    return {
      key,
      title,
      icon,
      artPath: nativeArtPath || this.getSelectorArtPath(key, selected),
      advisorTypeFrame: !nativeArtPath ? this.getAdvisorTypeFrame(key) : undefined,
      nativeIcon: !!nativeArtPath,
      value,
      filled: !!selected,
    };
  }

  private getAdvisorTypeFrame(key: SelectorKey): number | undefined {
    switch (key) {
      case 'military_high_command_1':
      case 'military_high_command_2':
      case 'military_high_command_3':
        return 1;
      case 'military_navy_chief':
        return 2;
      case 'military_army_chief':
        return 3;
      case 'military_air_chief':
        return 4;
      case 'industry_theorist':
        return 5;
      case 'political_advisor_1':
      case 'political_advisor_2':
      case 'political_advisor_3':
      case 'political_advisor_4':
        return 6;
      default:
        return undefined;
    }
  }

  private getSelectorArtPath(key: SelectorKey, token?: string): string {
    const normalized = token ? this.normalizePoliticalToken(token) : '';
    const mappedIcon = token ? this.getPoliticalIconAssetPath(token) : null;
    const specificArtPaths: Record<string, string> = {
      volunteer_only: 'assets/hoi4_ui/gfx/interface/ideas/idea_volunteer_only.png',
      extensive_conscription: 'assets/hoi4_ui/gfx/interface/ideas/idea_extensive_conscription.png',
    };

    if (mappedIcon) {
      return mappedIcon;
    }

    return this.resolveAssetPath((normalized && specificArtPaths[normalized]) || this.getSelectorDescriptor(key).artPath);
  }

  private getSelectorListArtPath(key: SelectorKey, token?: string): string {
    const normalized = token ? this.normalizePoliticalToken(token) : '';
    const mappedIcon = token ? this.getPoliticalIconAssetPath(token) : null;
    const squareLawArtPaths: Record<string, string> = {
      volunteer_only: 'assets/hoi4_ui/gfx/interface/ideas/idea_volunteer_only.png',
      extensive_conscription: 'assets/hoi4_ui/gfx/interface/ideas/idea_extensive_conscription.png',
    };

    if (mappedIcon) {
      return mappedIcon;
    }

    if (normalized && squareLawArtPaths[normalized]) {
      return this.resolveAssetPath(squareLawArtPaths[normalized]);
    }

    switch (key) {
      case 'conscription':
      case 'trade':
      case 'economy':
        return this.resolveAssetPath('assets/hoi4_ui/gfx/interface/add_pol_idea_button.png');
      case 'political_advisor_1':
      case 'political_advisor_2':
      case 'political_advisor_3':
      case 'political_advisor_4':
      case 'industry_theorist':
      case 'military_army_chief':
      case 'military_navy_chief':
      case 'military_air_chief':
      case 'military_high_command_1':
      case 'military_high_command_2':
      case 'military_high_command_3':
        return this.resolveAssetPath('assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png');
      default:
        return this.getSelectorArtPath(key, token);
    }
  }

  private getSelectorDescriptor(key: SelectorKey): {
    group: string;
    title: string;
    subtitle: string;
    icon: string;
    artPath: string;
  } {
    switch (key) {
      case 'conscription':
        return {
          group: '法律与政府',
          title: '征兵法案',
          subtitle: '调整征召等级与可用人力池。',
          icon: '征',
          artPath: 'assets/hoi4_ui/gfx/interface/add_pol_idea_button.png',
        };
      case 'trade':
        return {
          group: '法律与政府',
          title: '贸易法案',
          subtitle: '调整资源出口比例与对外贸易方向。',
          icon: '贸',
          artPath: 'assets/hoi4_ui/gfx/interface/add_pol_idea_button.png',
        };
      case 'economy':
        return {
          group: '法律与政府',
          title: '经济法案',
          subtitle: '调整总动员与工业经济体制。',
          icon: '经',
          artPath: 'assets/hoi4_ui/gfx/interface/add_pol_idea_button.png',
        };
      case 'political_advisor_1':
        return {
          group: '法律与政府',
          title: '政治顾问 I',
          subtitle: '任命政治顾问，提供内政与政治修正。',
          icon: '政1',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'political_advisor_2':
        return {
          group: '法律与政府',
          title: '政治顾问 II',
          subtitle: '任命政治顾问，提供内政与政治修正。',
          icon: '政2',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'political_advisor_3':
        return {
          group: '法律与政府',
          title: '政治顾问 III',
          subtitle: '任命政治顾问，提供内政与政治修正。',
          icon: '政3',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'political_advisor_4':
        return {
          group: '法律与政府',
          title: '政治顾问 IV',
          subtitle: '任命政治顾问，提供内政与政治修正。',
          icon: '政4',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'industry_tank':
        return {
          group: '研究与生产',
          title: '坦克军工机构',
          subtitle: '装甲装备设计商，强化装甲研发与生产。',
          icon: '甲',
          artPath: 'assets/hoi4_ui/gfx/interface/idea_slot_tank_manufacturer.png',
        };
      case 'industry_naval':
        return {
          group: '研究与生产',
          title: '舰艇军工机构',
          subtitle: '海军设计商，强化舰艇研发与生产。',
          icon: '舰',
          artPath: 'assets/hoi4_ui/gfx/interface/idea_slot_naval_manufacturer.png',
        };
      case 'industry_air':
        return {
          group: '研究与生产',
          title: '飞机军工机构',
          subtitle: '航空设计商，强化飞机研发与生产。',
          icon: '机',
          artPath: 'assets/hoi4_ui/gfx/interface/idea_slot_aircraft_manufacturer.png',
        };
      case 'industry_materiel':
        return {
          group: '研究与生产',
          title: '军需品装备',
          subtitle: '军需品制造商，负责轻武器与装备体系。',
          icon: '械',
          artPath: 'assets/hoi4_ui/gfx/interface/idea_slot_materiel_manufacturer.png',
        };
      case 'industry_corporation':
        return {
          group: '研究与生产',
          title: '工业集团',
          subtitle: '工业集团，提供总体工业与建设支持。',
          icon: '工',
          artPath: 'assets/hoi4_ui/gfx/interface/idea_slot_industrial_concern.png',
        };
      case 'industry_theorist':
        return {
          group: '研究与生产',
          title: '理论家',
          subtitle: '理论家将带来军种学说与研究增益。',
          icon: '学',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_army_chief':
        return {
          group: '军事参谋',
          title: '陆军部长',
          subtitle: '任命陆军部长，提供陆军体系修正。',
          icon: '陆',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_navy_chief':
        return {
          group: '军事参谋',
          title: '海军部长',
          subtitle: '任命海军部长，提供海军体系修正。',
          icon: '海',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_air_chief':
        return {
          group: '军事参谋',
          title: '空军部长',
          subtitle: '任命空军部长，提供空军体系修正。',
          icon: '空',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_high_command_1':
        return {
          group: '军事参谋',
          title: '总司令 I',
          subtitle: '任命总司令，获得战术与作战条令加成。',
          icon: '统1',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_high_command_2':
        return {
          group: '军事参谋',
          title: '总司令 II',
          subtitle: '任命总司令，获得战术与作战条令加成。',
          icon: '统2',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      case 'military_high_command_3':
        return {
          group: '军事参谋',
          title: '总司令 III',
          subtitle: '任命总司令，获得战术与作战条令加成。',
          icon: '统3',
          artPath: 'assets/hoi4_ui/gfx/interface/officer_corp/select_advisor.png',
        };
      default:
        return {
          group: '政治',
          title: '未知槽位',
          subtitle: '暂无说明。',
          icon: '?',
          artPath: 'assets/hoi4_ui/gfx/interface/add_pol_idea_button.png',
        };
    }
  }

  private getSelectorOptionDescription(key: SelectorKey, token: string): string {
    return this.getCharacterGameDescription(token) || this.getTokenGameDescription(token) || '';
  }

  private getTokenGameDescription(token: string | undefined | null): string | null {
    if (!token || typeof token !== 'string') return null;

    const raw = token.trim();
    if (!raw) return null;

    const candidates = new Set<string>();
    for (const stem of this.collectTokenStemCandidates(raw)) {
      candidates.add(`${stem}_desc`);
      candidates.add(`${stem}_tooltip`);
      candidates.add(`${stem}_long`);
      candidates.add(`${stem}_1_desc`);
      candidates.add(`${stem}_1_tooltip`);
      candidates.add(`${stem}_1_long`);
      candidates.add(`${stem.toLowerCase()}_desc`);
      candidates.add(`${stem.toLowerCase()}_tooltip`);
      candidates.add(`${stem.toLowerCase()}_long`);
      candidates.add(`${stem.toLowerCase()}_1_desc`);
      candidates.add(`${stem.toLowerCase()}_1_tooltip`);
      candidates.add(`${stem.toLowerCase()}_1_long`);
    }

    return this.lookupLocalizationEntry(candidates);
  }

  private getSelectorOptionCost(key: SelectorKey, token: string): string {
    switch (key) {
      case 'conscription': {
        const costMap: Record<string, string> = {
          disarmed_nation: '300 PP',
          volunteer_only: '150 PP',
          limited_conscription: '150 PP',
          extensive_conscription: '150 PP',
          service_by_requirement: '300 PP',
          all_adults_serve: '450 PP',
          scraping_the_barrel: '600 PP',
        };
        return costMap[token] || '150 PP';
      }
      case 'trade': {
        const costMap: Record<string, string> = {
          free_trade: '150 PP',
          export_focus: '150 PP',
          limited_exports: '150 PP',
          closed_economy: '300 PP',
        };
        return costMap[token] || '150 PP';
      }
      case 'economy': {
        const costMap: Record<string, string> = {
          civilian_economy: '150 PP',
          early_mobilization: '150 PP',
          partial_mobilization: '150 PP',
          war_economy: '150 PP',
          total_mobilization: '300 PP',
        };
        return costMap[token] || '150 PP';
      }
      default:
        return '150 PP';
    }
  }

  private describeConscriptionLaw(token: string): string {
    const map: Record<string, string> = {
      disarmed_nation: '征兵比例 +1.0%，和平状态下最低动员级别。',
      volunteer_only: '征兵比例 +1.5%，以志愿兵为核心。',
      limited_conscription: '征兵比例 +2.5%，开局常见的稳定方案。',
      extensive_conscription: '征兵比例 +5.0%，显著扩大征兵池。',
      service_by_requirement: '征兵比例 +10.0%，战争时期常用。',
      all_adults_serve: '征兵比例 +20.0%，全面征调成年人口。',
      scraping_the_barrel: '征兵比例 +25.0%，极限压榨国家人力。',
    };
    return map[token] || '调整征兵等级与可用人力规模。';
  }

  private describeTradeLaw(token: string): string {
    const map: Record<string, string> = {
      free_trade: '高出口，高研究与建造收益，国内资源保留最少。',
      export_focus: '中高出口，兼顾科研收益和资源保留。',
      limited_exports: '中低出口，保留更多国内战略资源。',
      closed_economy: '几乎不出口，最大化本国资源保留。',
    };
    return map[token] || '调整出口比例与工业开放度。';
  }

  private describeEconomyLaw(token: string): string {
    const map: Record<string, string> = {
      civilian_economy: '民用经济，军工建设能力受限。',
      early_mobilization: '初步动员，逐步转向战时生产。',
      partial_mobilization: '部分动员，提高军工建设速度。',
      war_economy: '战时经济，大幅倾斜战争生产。',
      total_mobilization: '全面动员，达到极限生产潜力。',
    };
    return map[token] || '调整国家经济动员体制。';
  }

  private localizeToken(token: string | undefined | null): string | null {
    if (!token || typeof token !== 'string') return null;

    const raw = token.trim();
    if (!raw) return null;
    const normalized = this.normalizePoliticalToken(raw);

    const override = this.getTokenLabelOverride(normalized) || this.getTokenLabelOverride(raw);
    if (override) return override;

    const labelCandidates = new Set<string>();
    const descFallbackCandidates = new Set<string>();
    const ideologyCandidates: string[] = [];
    const currentIdeology = this.getCurrentCountryIdeology();

    for (const stem of this.collectTokenStemCandidates(raw)) {
      labelCandidates.add(stem);
      labelCandidates.add(`${stem}_1`);
      labelCandidates.add(stem.toLowerCase());
      labelCandidates.add(`${stem.toLowerCase()}_1`);
      labelCandidates.add(`${stem}_name`);
      labelCandidates.add(`${stem}_long`);
      labelCandidates.add(`${stem}_1_name`);
      labelCandidates.add(`${stem}_1_long`);
      labelCandidates.add(`${stem}_company`);
      labelCandidates.add(`${stem}_manufacturer`);
      labelCandidates.add(`${stem.toLowerCase()}_name`);
      labelCandidates.add(`${stem.toLowerCase()}_long`);
      labelCandidates.add(`${stem.toLowerCase()}_1_name`);
      labelCandidates.add(`${stem.toLowerCase()}_1_long`);
      descFallbackCandidates.add(`${stem}_desc`);
      descFallbackCandidates.add(`${stem}_1_desc`);
      descFallbackCandidates.add(`${stem.toLowerCase()}_desc`);
      descFallbackCandidates.add(`${stem.toLowerCase()}_1_desc`);

      if (currentIdeology) {
        ideologyCandidates.push(`${stem}_${currentIdeology}`);
        ideologyCandidates.push(`${stem.toLowerCase()}_${currentIdeology}`);
      }
      ideologyCandidates.push(`${stem}_fascist`);
      ideologyCandidates.push(`${stem}_neutral`);
      ideologyCandidates.push(`${stem}_democratic`);
      ideologyCandidates.push(`${stem}_communism`);
      ideologyCandidates.push(`${stem.toLowerCase()}_fascist`);
      ideologyCandidates.push(`${stem.toLowerCase()}_neutral`);
      ideologyCandidates.push(`${stem.toLowerCase()}_democratic`);
      ideologyCandidates.push(`${stem.toLowerCase()}_communism`);
    }

    const lowerTag = this.currentCountryTag.toLowerCase();
    labelCandidates.add(`${normalized.replace(/^[A-Z0-9]{3}_/, '')}_${lowerTag}`);
    ideologyCandidates.forEach((candidate) => labelCandidates.add(candidate));

    const localizedLabel = this.lookupLocalizationEntry(labelCandidates);
    if (localizedLabel) return localizedLabel;

    const localizedDescFallback = this.lookupLocalizationEntry(descFallbackCandidates);
    if (localizedDescFallback) return localizedDescFallback;

    const tokenRef = raw.match(/^\$([^$]+)\$$/);
    if (tokenRef) {
      return this.localizeToken(tokenRef[1]);
    }

    return null;
  }

  private resolvePartyNameFromHistory(politics: any, rulingParty?: string): string | null {
    if (!politics) return null;

    const partyNameSource = politics.set_party_name;
    if (Array.isArray(partyNameSource)) {
      const exact = partyNameSource.find((p: any) => p?.ideology === rulingParty);
      const candidate = exact || partyNameSource[0];
      const localized = this.localizeToken(candidate?.long_name) || this.localizeToken(candidate?.name);
      if (localized) return localized;
      if (typeof candidate?.name === 'string') return this.formatTokenLabel(candidate.name);
    } else if (partyNameSource && typeof partyNameSource === 'object') {
      const localized = this.localizeToken(partyNameSource.long_name) || this.localizeToken(partyNameSource.name);
      if (localized) return localized;
      if (typeof partyNameSource.name === 'string') return this.formatTokenLabel(partyNameSource.name);
    }

    if (rulingParty) {
      const localized = this.localizeToken(`${this.currentCountryTag}_${rulingParty}_party`)
        || this.localizeToken(`${this.currentCountryTag}_${rulingParty}_party_long`)
        || this.localizeToken(`${rulingParty}_party`);
      if (localized) return localized;
    }

    return null;
  }

  private buildCountryHistorySummary(politics: any): string {
    if (!politics || typeof politics !== 'object') {
      return '暂无国家历史数据';
    }

    const fragments: string[] = [];

    const rulingParty = politics?.set_politics?.ruling_party;
    if (rulingParty) {
      fragments.push(`执政意识形态：${this.translateIdeology(rulingParty) || rulingParty}`);
    }

    const election = this.buildElectionInfoText(politics?.set_politics);
    if (election && election !== '暂无选举数据') {
      fragments.push(election);
    }

    const ideas = this.extractIdeaTokens(politics)
      .slice(0, 4)
      .map((token) => this.formatTokenLabel(token));
    if (ideas.length > 0) {
      fragments.push(`国家精神：${ideas.join('、')}`);
    }

    const recruits = this.extractRecruitTokens(politics)
      .slice(0, 3)
      .map((token) => this.formatTokenLabel(token));
    if (recruits.length > 0) {
      fragments.push(`核心人物：${recruits.join('、')}`);
    }

    return fragments.length > 0 ? fragments.join('。') + '。' : '暂无国家历史数据';
  }

  private initUI() {
    this.elPP = document.getElementById('res-pp');
    this.elStability = document.getElementById('res-stability');
    this.elWarSupport = document.getElementById('res-war-support');
    this.elManpower = document.getElementById('res-manpower');
    this.elFactories = document.getElementById('res-factories');
    this.elDate = document.getElementById('game-date');
    this.speedBtns = document.querySelectorAll('.speed-btn');
  }

  private setupTimeControls() {
    if (!this.speedBtns) return;

    this.speedBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const id = target.id;

        // Update active state
        this.speedBtns?.forEach(b => b.classList.remove('active'));
        target.classList.add('active');

        if (id === 'speed-pause') {
          this.isPaused = true;
        } else {
          this.isPaused = false;
          this.gameSpeed = parseInt(id.replace('speed-', ''), 10);
        }
      });
    });
  }

  public update(deltaTime: number) {
    if (this.isPaused) return;

    // Simple time progression based on game speed
    // Speed 1: 1 hour per second
    // Speed 5: 24 hours per second
    const hoursToAdvance = this.gameSpeed * this.gameSpeed * deltaTime;
    this.currentDate.setTime(this.currentDate.getTime() + hoursToAdvance * 60 * 60 * 1000);
    
    this.updateDateUI();
  }

  private formatManpower(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    return `${year}年${month}月${day}日 ${hours}:00`;
  }

  private updateDateUI() {
    if (this.elDate) {
      this.elDate.textContent = this.formatDate(this.currentDate);
    }
  }

  private updateUI() {
    if (this.elPP) this.elPP.textContent = Math.floor(this.pp).toString();
    if (this.elStability) this.elStability.textContent = `${Math.floor(this.stability)}%`;
    if (this.elWarSupport) this.elWarSupport.textContent = `${Math.floor(this.warSupport)}%`;
    if (this.elManpower) this.elManpower.textContent = this.formatManpower(this.manpower);
    if (this.elFactories) this.elFactories.textContent = `${this.factories.civilian}/${this.factories.military}/${this.factories.naval}`;
    this.updateDateUI();
  }
}
