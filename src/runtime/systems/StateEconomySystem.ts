import type { RuntimeTickContext } from '../RuntimeTypes';
import { RuntimeStore } from '../RuntimeStore';

const SUPPLY_STOCKPILE_CAP = 100_000;
const MIN_MANPOWER_GROWTH_PER_SECOND = 1.0;
const MANPOWER_GROWTH_RATE_PER_SECOND = 0.000015;

export class StateEconomySystem {
  readonly name = 'StateEconomySystem';

  update(store: RuntimeStore, context: RuntimeTickContext): void {
    for (const state of store.iterateStates()) {
      const infraMultiplier = 0.4 + state.infrastructure * 0.9;
      const factoryOutput =
        state.civilianFactories * 0.9 + state.militaryFactories * 0.65;
      const generatedSupply = factoryOutput * infraMultiplier * context.deltaSeconds;

      state.supplyStockpile = Math.min(
        SUPPLY_STOCKPILE_CAP,
        state.supplyStockpile + generatedSupply,
      );

      const manpowerGrowthPerSecond = Math.max(
        MIN_MANPOWER_GROWTH_PER_SECOND,
        state.manpower * MANPOWER_GROWTH_RATE_PER_SECOND,
      );
      state.manpower += manpowerGrowthPerSecond * context.deltaSeconds;
    }
  }
}
