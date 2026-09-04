export const STRATEGY_COST = { useMultiHop: 2, useHyde: 1, useExpansion: 1, useWebFallback: 1 };
export const DEFAULT_MAX_BUDGET = 3;
export const STRATEGY_ORDER = ["useMultiHop", "useHyde", "useExpansion", "useWebFallback"];

export function applyRetrievalBudget(options, maxBudget = DEFAULT_MAX_BUDGET) {
  const chosen = [];
  let budget = 0;
  for (const key of STRATEGY_ORDER) {
    if (!options[key]) continue;
    if (budget + STRATEGY_COST[key] > maxBudget) continue;
    budget += STRATEGY_COST[key];
    chosen.push(key);
  }
  return {
    useHyde: chosen.includes("useHyde"),
    useExpansion: chosen.includes("useExpansion"),
    useMultiHop: chosen.includes("useMultiHop"),
    useWebFallback: chosen.includes("useWebFallback"),
    strategiesRun: chosen,
    budgetUsed: budget,
  };
}
