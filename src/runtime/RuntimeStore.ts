import type { ProvinceStore } from '../data/ProvinceStore';
import type {
  RuntimeProvinceRecord,
  RuntimeStateRecord,
  RuntimeStoreSnapshot,
} from './RuntimeTypes';

const RUNTIME_STORE_VERSION = 1;
const DEFAULT_SUPPLY_STOCKPILE = 40;

type IndustryBaseline = {
  civilianFactories: number;
  militaryFactories: number;
  infrastructure: number;
};

const CATEGORY_BASELINES: Record<string, IndustryBaseline> = {
  enclave: { civilianFactories: 1, militaryFactories: 0, infrastructure: 0.38 },
  pastoral: { civilianFactories: 1, militaryFactories: 0, infrastructure: 0.42 },
  rural: { civilianFactories: 1, militaryFactories: 0, infrastructure: 0.45 },
  large_town: { civilianFactories: 2, militaryFactories: 1, infrastructure: 0.52 },
  town: { civilianFactories: 2, militaryFactories: 1, infrastructure: 0.52 },
  city: { civilianFactories: 3, militaryFactories: 2, infrastructure: 0.6 },
  large_city: { civilianFactories: 4, militaryFactories: 3, infrastructure: 0.68 },
  metropolis: { civilianFactories: 5, militaryFactories: 4, infrastructure: 0.75 },
  megalopolis: { civilianFactories: 6, militaryFactories: 5, infrastructure: 0.82 },
  wasteland: { civilianFactories: 0, militaryFactories: 0, infrastructure: 0.2 },
};

function normalizeFiniteNumber(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function clampInfrastructure(value: number): number {
  return Math.max(0.1, Math.min(1.0, value));
}

function resolveIndustryBaseline(category: string): IndustryBaseline {
  const normalized = category.trim().toLowerCase();
  return CATEGORY_BASELINES[normalized] ?? {
    civilianFactories: 1,
    militaryFactories: 0,
    infrastructure: 0.45,
  };
}

export class RuntimeStore {
  private readonly provinces = new Map<number, RuntimeProvinceRecord>();
  private readonly states = new Map<number, RuntimeStateRecord>();
  private tick = 0;

  static fromProvinceStore(source: ProvinceStore): RuntimeStore {
    const runtimeStore = new RuntimeStore();

    for (const state of source.getAllStates()) {
      const baseline = resolveIndustryBaseline(state.category);
      runtimeStore.states.set(state.id, {
        stateId: state.id,
        owner: state.owner,
        category: state.category,
        manpower: Math.max(0, normalizeFiniteNumber(state.manpower)),
        civilianFactories: baseline.civilianFactories,
        militaryFactories: baseline.militaryFactories,
        infrastructure: clampInfrastructure(baseline.infrastructure),
        supplyStockpile: DEFAULT_SUPPLY_STOCKPILE,
        supplyDemand: 0,
        supplyFulfillment: 1,
      });
    }

    for (const province of source.getAllProvinces()) {
      const stateId = typeof province.stateId === 'number' ? province.stateId : null;

      if (stateId !== null && !runtimeStore.states.has(stateId)) {
        runtimeStore.states.set(stateId, {
          stateId,
          owner: province.owner,
          category: 'unknown',
          manpower: 0,
          civilianFactories: 0,
          militaryFactories: 0,
          infrastructure: 0.3,
          supplyStockpile: DEFAULT_SUPPLY_STOCKPILE,
          supplyDemand: 0,
          supplyFulfillment: 1,
        });
      }

      runtimeStore.provinces.set(province.id, {
        provinceId: province.id,
        owner: province.owner,
        stateId,
        supplyFlow: 1,
      });
    }

    return runtimeStore;
  }

  getTick(): number {
    return this.tick;
  }

  setTick(nextTick: number): void {
    if (!Number.isFinite(nextTick) || nextTick < 0) return;
    this.tick = Math.floor(nextTick);
  }

  getStateCount(): number {
    return this.states.size;
  }

  getProvinceCount(): number {
    return this.provinces.size;
  }

  getState(stateId: number): RuntimeStateRecord | undefined {
    return this.states.get(stateId);
  }

  getProvince(provinceId: number): RuntimeProvinceRecord | undefined {
    return this.provinces.get(provinceId);
  }

  iterateStates(): IterableIterator<RuntimeStateRecord> {
    return this.states.values();
  }

  iterateProvinces(): IterableIterator<RuntimeProvinceRecord> {
    return this.provinces.values();
  }

  createSnapshot(): RuntimeStoreSnapshot {
    const states = Array.from(this.states.values())
      .map((state) => ({ ...state }))
      .sort((a, b) => a.stateId - b.stateId);

    const provinces = Array.from(this.provinces.values())
      .map((province) => ({ ...province }))
      .sort((a, b) => a.provinceId - b.provinceId);

    return {
      version: RUNTIME_STORE_VERSION,
      tick: this.tick,
      states,
      provinces,
    };
  }

  loadSnapshot(snapshot: RuntimeStoreSnapshot): void {
    this.tick = Math.max(0, Math.floor(normalizeFiniteNumber(snapshot.tick)));

    this.states.clear();
    for (const state of snapshot.states) {
      this.states.set(state.stateId, {
        stateId: state.stateId,
        owner: state.owner,
        category: state.category,
        manpower: Math.max(0, normalizeFiniteNumber(state.manpower)),
        civilianFactories: Math.max(0, Math.floor(normalizeFiniteNumber(state.civilianFactories))),
        militaryFactories: Math.max(0, Math.floor(normalizeFiniteNumber(state.militaryFactories))),
        infrastructure: clampInfrastructure(normalizeFiniteNumber(state.infrastructure, 0.45)),
        supplyStockpile: Math.max(0, normalizeFiniteNumber(state.supplyStockpile)),
        supplyDemand: Math.max(0, normalizeFiniteNumber(state.supplyDemand)),
        supplyFulfillment: Math.max(0, Math.min(1, normalizeFiniteNumber(state.supplyFulfillment, 1))),
      });
    }

    this.provinces.clear();
    for (const province of snapshot.provinces) {
      this.provinces.set(province.provinceId, {
        provinceId: province.provinceId,
        owner: province.owner,
        stateId: province.stateId,
        supplyFlow: Math.max(0, Math.min(1, normalizeFiniteNumber(province.supplyFlow, 0))),
      });
    }
  }
}
