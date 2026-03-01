import type { RuntimeTickContext } from '../RuntimeTypes';
import { RuntimeStore } from '../RuntimeStore';

function pickDominantOwner(ownerCounts: Map<string, number>): string | null {
  let dominantOwner: string | null = null;
  let dominantCount = -1;

  for (const [owner, count] of ownerCounts) {
    if (count > dominantCount) {
      dominantOwner = owner;
      dominantCount = count;
      continue;
    }

    if (count === dominantCount && dominantOwner !== null && owner < dominantOwner) {
      dominantOwner = owner;
    }
  }

  return dominantOwner;
}

export class OwnershipSystem {
  readonly name = 'OwnershipSystem';

  update(store: RuntimeStore, _context: RuntimeTickContext): void {
    const ownershipByState = new Map<number, Map<string, number>>();

    for (const province of store.iterateProvinces()) {
      if (province.stateId === null) continue;

      let ownerCounts = ownershipByState.get(province.stateId);
      if (!ownerCounts) {
        ownerCounts = new Map<string, number>();
        ownershipByState.set(province.stateId, ownerCounts);
      }

      const previousCount = ownerCounts.get(province.owner) ?? 0;
      ownerCounts.set(province.owner, previousCount + 1);
    }

    for (const state of store.iterateStates()) {
      const ownerCounts = ownershipByState.get(state.stateId);
      if (!ownerCounts || ownerCounts.size === 0) continue;

      const dominantOwner = pickDominantOwner(ownerCounts);
      if (dominantOwner && dominantOwner !== state.owner) {
        state.owner = dominantOwner;
      }
    }
  }
}
