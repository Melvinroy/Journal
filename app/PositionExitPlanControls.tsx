"use client";

import {
  EXIT_PLAN_SCHEMA_VERSION,
  exitLegQuantities,
  resolvedTarget,
  validateExitPlan,
  type ExitPlanDefinition,
  type ExitPlanLeg,
  type FrozenRiskReference,
  type TradeDirection,
  type TrailingRule,
} from "../lib/trading-domain";

type Props = {
  definition: ExitPlanDefinition;
  direction: TradeDirection;
  quantity: number;
  reference?: FrozenRiskReference | null;
  onChange: (definition: ExitPlanDefinition) => void;
};

const TARGET_COUNTS = [1, 2] as const;
const RUNNER_COUNTS = [0, 1, 2] as const;

function trailingMode(rule: TrailingRule) {
  return rule.mode === "SMA" ? `SMA${rule.period}` : rule.mode;
}

function trailingFromMode(mode: string): TrailingRule {
  if (mode.startsWith("SMA"))
    return { mode: "SMA", period: Number(mode.slice(3)) as 10 | 20 | 50 };
  if (mode === "Day extreme") return { mode };
  if (mode === "Dollar") return { mode, distance: 1 };
  if (mode === "Percentage") return { mode, percent: 5 };
  return { mode: "Manual", stopPrice: 1 };
}

function structure(
  targets: 1 | 2,
  runners: 0 | 1 | 2,
  breakeven: ExitPlanDefinition["breakeven"],
): ExitPlanDefinition {
  const templates: Record<string, number[]> = {
    "1-0": [100],
    "1-1": [70, 30],
    "1-2": [35, 35, 30],
    "2-0": [50, 50],
    "2-1": [35, 35, 30],
    "2-2": [25, 25, 25, 25],
  };
  const allocations = templates[`${targets}-${runners}`];
  const legs: ExitPlanLeg[] = [];
  for (let index = 0; index < targets; index += 1)
    legs.push({
      id: `T${index + 1}`,
      role: "Target",
      allocationPercent: allocations[index],
      target: { mode: "R", multipleR: index + 1 },
    });
  for (let index = 0; index < runners; index += 1)
    legs.push({
      id: `Runner ${String.fromCharCode(65 + index)}`,
      role: "Runner",
      allocationPercent: allocations[targets + index],
      activationR: index + 1,
      trailing:
        index === 0
          ? { mode: "SMA", period: 10 }
          : { mode: "Percentage", percent: 5 },
    });
  return { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, breakeven, legs };
}

function price(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PositionExitPlanControls({
  definition,
  direction,
  quantity,
  reference,
  onChange,
}: Props) {
  const targetCount = definition.legs.filter((leg) => leg.role === "Target")
    .length as 1 | 2;
  const runnerCount = definition.legs.filter((leg) => leg.role === "Runner")
    .length as 0 | 1 | 2;
  const allocationTotal = definition.legs.reduce(
    (sum, leg) => sum + leg.allocationPercent,
    0,
  );
  let quantities: Record<string, number> = {};
  let error = "";
  try {
    validateExitPlan(definition);
    quantities = Object.fromEntries(
      exitLegQuantities(quantity, definition).map((item) => [
        item.legId,
        item.quantity,
      ]),
    );
  } catch (caught) {
    error = (caught as Error).message;
  }
  const updateLeg = (index: number, next: ExitPlanLeg) =>
    onChange({
      ...definition,
      legs: definition.legs.map((leg, current) =>
        current === index ? next : leg,
      ),
    });

  return (
    <div className="position-exit-editor">
      <div className="trade-exit-config">
        <div>
          <span>Targets</span>
          <div
            className="trade-count-control"
            role="group"
            aria-label="Amendment target count"
          >
            {TARGET_COUNTS.map((count) => (
              <button
                type="button"
                key={count}
                aria-pressed={targetCount === count}
                className={targetCount === count ? "active" : ""}
                onClick={() =>
                  onChange(structure(count, runnerCount, definition.breakeven))
                }
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span>Runners</span>
          <div
            className="trade-count-control"
            role="group"
            aria-label="Amendment runner count"
          >
            {RUNNER_COUNTS.map((count) => (
              <button
                type="button"
                key={count}
                aria-pressed={runnerCount === count}
                className={runnerCount === count ? "active" : ""}
                onClick={() =>
                  onChange(structure(targetCount, count, definition.breakeven))
                }
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <div className="trade-allocation-total">
          <span>Allocation</span>
          <strong
            className={Math.abs(allocationTotal - 100) > 1e-9 ? "invalid" : ""}
          >
            {allocationTotal}% · {quantity} shares
          </strong>
        </div>
      </div>

      <div className="trade-rule-panel">
        <div className="trade-rule-title">
          <div>
            <b>Price-based breakeven</b>
            <span>
              Independent of target fills · initial protection stays active
              first
            </span>
          </div>
        </div>
        <div className="trade-rule-fields">
          <label>
            Activate at
            <select
              aria-label="Amendment breakeven activation"
              value={
                [1, 2, 3].includes(definition.breakeven.activationR)
                  ? String(definition.breakeven.activationR)
                  : "custom"
              }
              onChange={(event) =>
                onChange({
                  ...definition,
                  breakeven: {
                    ...definition.breakeven,
                    activationR:
                      event.target.value === "custom"
                        ? 1.1
                        : Number(event.target.value),
                  },
                })
              }
            >
              <option value="1">1R</option>
              <option value="2">2R</option>
              <option value="3">3R</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {![1, 2, 3].includes(definition.breakeven.activationR) && (
            <label>
              Custom R
              <input
                aria-label="Amendment custom breakeven R"
                type="number"
                min="0"
                step="0.1"
                value={definition.breakeven.activationR || ""}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    breakeven: {
                      ...definition.breakeven,
                      activationR: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          )}
          <label>
            Favorable offset
            <span className="trade-inline-fields">
              <select
                aria-label="Amendment breakeven offset unit"
                value={definition.breakeven.favorableOffset.unit}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    breakeven: {
                      ...definition.breakeven,
                      favorableOffset: {
                        ...definition.breakeven.favorableOffset,
                        unit: event.target.value as "Dollar" | "R",
                      },
                    },
                  })
                }
              >
                <option value="Dollar">$ / share</option>
                <option value="R">R</option>
              </select>
              <input
                aria-label="Amendment breakeven offset value"
                type="number"
                min="0"
                step="0.1"
                value={definition.breakeven.favorableOffset.value}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    breakeven: {
                      ...definition.breakeven,
                      favorableOffset: {
                        ...definition.breakeven.favorableOffset,
                        value: Number(event.target.value),
                      },
                    },
                  })
                }
              />
            </span>
          </label>
        </div>
      </div>

      <div className="trade-leg-list">
        {definition.legs.map((leg, index) => {
          if (leg.role === "Target") {
            let resolved: ReturnType<typeof resolvedTarget> | null = null;
            try {
              if (reference) resolved = resolvedTarget(leg.target, reference);
            } catch {
              /* validation is shown below */
            }
            return (
              <div className="trade-leg-row target" key={leg.id}>
                <div className="trade-leg-name">
                  <b>{leg.id}</b>
                  <span>
                    {quantities[leg.id] == null
                      ? "—"
                      : `${quantities[leg.id]} sh`}
                  </span>
                </div>
                <label>
                  Allocation %
                  <input
                    aria-label={`Amendment ${leg.id} allocation percent`}
                    type="number"
                    min="0"
                    step="1"
                    value={leg.allocationPercent || ""}
                    onChange={(event) =>
                      updateLeg(index, {
                        ...leg,
                        allocationPercent: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Input
                  <select
                    aria-label={`Amendment ${leg.id} authoritative input`}
                    value={leg.target.mode}
                    onChange={(event) => {
                      const mode = event.target.value as "R" | "Price";
                      updateLeg(index, {
                        ...leg,
                        target:
                          mode === "R"
                            ? { mode, multipleR: resolved?.multipleR ?? 1 }
                            : {
                                mode,
                                price: resolved?.price ?? reference?.entryPrice ?? 0,
                              },
                      });
                    }}
                  >
                    <option value="R">R</option>
                    <option value="Price">Price</option>
                  </select>
                </label>
                <label>
                  {leg.target.mode === "R" ? "Target R" : "Target price"}
                  <input
                    aria-label={`Amendment ${leg.id} ${leg.target.mode === "R" ? "target R" : "target price"}`}
                    type="number"
                    min="0"
                    step="0.1"
                    value={
                      leg.target.mode === "R"
                        ? leg.target.multipleR
                        : leg.target.price
                    }
                    onChange={(event) =>
                      updateLeg(index, {
                        ...leg,
                        target:
                          leg.target.mode === "R"
                            ? {
                                mode: "R",
                                multipleR: Number(event.target.value),
                              }
                            : {
                                mode: "Price",
                                price: Number(event.target.value),
                              },
                      })
                    }
                  />
                </label>
                <span className="trade-linked-value">
                  {resolved
                    ? `${resolved.multipleR.toFixed(2)}R · ${price(resolved.price)}`
                    : reference
                      ? "Invalid target"
                      : leg.target.mode === "Price" && leg.target.price > 0
                        ? `${price(leg.target.price)} · R unavailable`
                        : "Price unavailable · Execution R missing"}
                  <small>{leg.target.mode} authoritative</small>
                </span>
              </div>
            );
          }
          return (
            <div className="trade-leg-row runner" key={leg.id}>
              <div className="trade-leg-name">
                <b>{leg.id}</b>
                <span>
                  {quantities[leg.id] == null
                    ? "—"
                    : `${quantities[leg.id]} sh`}
                </span>
              </div>
              <label>
                Allocation %
                <input
                  aria-label={`Amendment ${leg.id} allocation percent`}
                  type="number"
                  min="0"
                  step="1"
                  value={leg.allocationPercent || ""}
                  onChange={(event) =>
                    updateLeg(index, {
                      ...leg,
                      allocationPercent: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Activate R
                <input
                  aria-label={`Amendment ${leg.id} activation R`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={leg.activationR || ""}
                  onChange={(event) =>
                    updateLeg(index, {
                      ...leg,
                      activationR: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Trail
                <select
                  aria-label={`Amendment ${leg.id} trailing method`}
                  value={trailingMode(leg.trailing)}
                  onChange={(event) =>
                    updateLeg(index, {
                      ...leg,
                      trailing: trailingFromMode(event.target.value),
                    })
                  }
                >
                  <option value="SMA10">10 SMA</option>
                  <option value="SMA20">20 SMA</option>
                  <option value="SMA50">50 SMA</option>
                  <option value="Day extreme">
                    {direction === "Long" ? "Day low" : "Day high"}
                  </option>
                  <option value="Dollar">$ distance</option>
                  <option value="Percentage">Percent</option>
                  <option value="Manual">Manual stop</option>
                </select>
              </label>
              {leg.trailing.mode === "Dollar" && (
                <label>
                  Distance $
                  <input
                    aria-label={`Amendment ${leg.id} dollar distance`}
                    type="number"
                    min="0"
                    step="0.1"
                    value={leg.trailing.distance || ""}
                    onChange={(event) =>
                      updateLeg(index, {
                        ...leg,
                        trailing: {
                          mode: "Dollar",
                          distance: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
              {leg.trailing.mode === "Percentage" && (
                <label>
                  Distance %
                  <input
                    aria-label={`Amendment ${leg.id} trailing percent`}
                    type="number"
                    min="0"
                    step="0.1"
                    value={leg.trailing.percent || ""}
                    onChange={(event) =>
                      updateLeg(index, {
                        ...leg,
                        trailing: {
                          mode: "Percentage",
                          percent: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
              {leg.trailing.mode === "Manual" && (
                <label>
                  Stop price
                  <input
                    aria-label={`Amendment ${leg.id} manual trail stop`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={leg.trailing.stopPrice || ""}
                    onChange={(event) =>
                      updateLeg(index, {
                        ...leg,
                        trailing: {
                          mode: "Manual",
                          stopPrice: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className="trade-validation" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
