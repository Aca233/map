import type {
  RuntimeStoreSnapshot,
  SimulationClockSnapshot,
} from '../runtime';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface RuntimeSnapshotEnvelope {
  schemaVersion: number;
  createdAt: string;
  runtime: RuntimeStoreSnapshot;
  clock: SimulationClockSnapshot;
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRuntimeStoreSnapshot(value: unknown): value is RuntimeStoreSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as RuntimeStoreSnapshot;

  if (!hasFiniteNumber(snapshot.version) || !hasFiniteNumber(snapshot.tick)) return false;
  if (!Array.isArray(snapshot.states) || !Array.isArray(snapshot.provinces)) return false;

  const statesValid = snapshot.states.every((state) =>
    state &&
    hasFiniteNumber(state.stateId) &&
    typeof state.owner === 'string' &&
    typeof state.category === 'string' &&
    hasFiniteNumber(state.manpower) &&
    hasFiniteNumber(state.civilianFactories) &&
    hasFiniteNumber(state.militaryFactories) &&
    hasFiniteNumber(state.infrastructure) &&
    hasFiniteNumber(state.supplyStockpile) &&
    hasFiniteNumber(state.supplyDemand) &&
    hasFiniteNumber(state.supplyFulfillment),
  );

  if (!statesValid) return false;

  return snapshot.provinces.every((province) =>
    province &&
    hasFiniteNumber(province.provinceId) &&
    typeof province.owner === 'string' &&
    (province.stateId === null || hasFiniteNumber(province.stateId)) &&
    hasFiniteNumber(province.supplyFlow),
  );
}

function isSimulationClockSnapshot(value: unknown): value is SimulationClockSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as SimulationClockSnapshot;

  return (
    hasFiniteNumber(snapshot.fixedStepSeconds) &&
    hasFiniteNumber(snapshot.maxStepsPerFrame) &&
    hasFiniteNumber(snapshot.maxFrameDeltaSeconds) &&
    hasFiniteNumber(snapshot.accumulatorSeconds) &&
    hasFiniteNumber(snapshot.tick) &&
    hasFiniteNumber(snapshot.elapsedSimulationSeconds)
  );
}

export function isRuntimeSnapshotEnvelope(value: unknown): value is RuntimeSnapshotEnvelope {
  if (!value || typeof value !== 'object') return false;

  const envelope = value as RuntimeSnapshotEnvelope;
  if (!hasFiniteNumber(envelope.schemaVersion)) return false;
  if (typeof envelope.createdAt !== 'string') return false;
  if (!isRuntimeStoreSnapshot(envelope.runtime)) return false;
  if (!isSimulationClockSnapshot(envelope.clock)) return false;

  return true;
}

export function createRuntimeSnapshotEnvelope(
  runtime: RuntimeStoreSnapshot,
  clock: SimulationClockSnapshot,
): RuntimeSnapshotEnvelope {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    runtime,
    clock,
  };
}
