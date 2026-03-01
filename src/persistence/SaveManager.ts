import { RuntimeStore, SimulationClock } from '../runtime';
import {
  createRuntimeSnapshotEnvelope,
  isRuntimeSnapshotEnvelope,
  type RuntimeSnapshotEnvelope,
  SNAPSHOT_SCHEMA_VERSION,
} from './SnapshotSchema';

const DEFAULT_SAVE_SLOT = 'runtime-foundation';

function resolveStorageKey(slot: string): string {
  const normalizedSlot = slot.trim() || DEFAULT_SAVE_SLOT;
  return `hoi4-map-save:${normalizedSlot}`;
}

export class SaveManager {
  private readonly runtimeStore: RuntimeStore;
  private readonly simulationClock: SimulationClock;
  private readonly storageKey: string;

  constructor(runtimeStore: RuntimeStore, simulationClock: SimulationClock, slot = DEFAULT_SAVE_SLOT) {
    this.runtimeStore = runtimeStore;
    this.simulationClock = simulationClock;
    this.storageKey = resolveStorageKey(slot);
  }

  save(): RuntimeSnapshotEnvelope {
    const envelope = createRuntimeSnapshotEnvelope(
      this.runtimeStore.createSnapshot(),
      this.simulationClock.createSnapshot(),
    );

    localStorage.setItem(this.storageKey, JSON.stringify(envelope));
    return envelope;
  }

  load(): RuntimeSnapshotEnvelope | null {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isRuntimeSnapshotEnvelope(parsed)) return null;
    if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;

    this.runtimeStore.loadSnapshot(parsed.runtime);
    this.simulationClock.loadSnapshot(parsed.clock);

    return parsed;
  }

  hasSave(): boolean {
    return localStorage.getItem(this.storageKey) !== null;
  }

  clear(): void {
    localStorage.removeItem(this.storageKey);
  }

  getStorageKey(): string {
    return this.storageKey;
  }
}
