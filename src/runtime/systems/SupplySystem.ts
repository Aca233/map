import type { RuntimeTickContext } from '../RuntimeTypes';
import { RuntimeStore } from '../RuntimeStore';

const BASE_SUPPLY_DEMAND = 0.6;
const MANPOWER_SUPPLY_FACTOR = 0.0002;
const FACTORY_SUPPLY_FACTOR = 0.55;

export class SupplySystem {
  readonly name = 'SupplySystem';

  update(store: RuntimeStore, _context: RuntimeTickContext): void {
    const fulfillmentByState = new Map<number, number>();

    for (const state of store.iterateStates()) {
      const industrialLoad = state.civilianFactories + state.militaryFactories;
      const demand = Math.max(
        BASE_SUPPLY_DEMAND,
        state.manpower * MANPOWER_SUPPLY_FACTOR + industrialLoad * FACTORY_SUPPLY_FACTOR,
      );
      const consumed = Math.min(state.supplyStockpile, demand);

      state.supplyStockpile -= consumed;
      state.supplyDemand = demand;
      state.supplyFulfillment = demand > 0 ? consumed / demand : 1;

      fulfillmentByState.set(state.stateId, state.supplyFulfillment);
    }

    for (const province of store.iterateProvinces()) {
      if (province.stateId === null) {
        province.supplyFlow = 0;
        continue;
      }

      province.supplyFlow = fulfillmentByState.get(province.stateId) ?? 0;
    }
  }
}
