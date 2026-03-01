export interface RuntimeProvinceRecord {
  provinceId: number;
  owner: string;
  stateId: number | null;
  supplyFlow: number;
}

export interface RuntimeStateRecord {
  stateId: number;
  owner: string;
  category: string;
  manpower: number;
  civilianFactories: number;
  militaryFactories: number;
  infrastructure: number;
  supplyStockpile: number;
  supplyDemand: number;
  supplyFulfillment: number;
}

export interface RuntimeStoreSnapshot {
  version: number;
  tick: number;
  provinces: RuntimeProvinceRecord[];
  states: RuntimeStateRecord[];
}

export interface SimulationClockSnapshot {
  fixedStepSeconds: number;
  maxStepsPerFrame: number;
  maxFrameDeltaSeconds: number;
  accumulatorSeconds: number;
  tick: number;
  elapsedSimulationSeconds: number;
}

export interface RuntimeTickContext {
  tick: number;
  deltaSeconds: number;
  totalSimulationSeconds: number;
}
