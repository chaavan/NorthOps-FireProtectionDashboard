/**
 * Unit tests for the inventory levels math — no DB required.
 *
 *   npx tsx --tsconfig scripts/tsconfig.rbac.json scripts/test-inventory-levels.ts
 */
import assert from "node:assert/strict";
import {
  getInventoryReorderSuggestion,
  remainingInventoryReorderQty,
} from "@/lib/inventoryReorder";
import { computeLevels, roundUpToIncrement, TEXTBOOK_PARAMS } from "@/lib/inventoryLevels/formula";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("\nreorder suggestion — static mode (flag off)");

check("suggests the flat Order Min when nothing is on order", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 0, dynamic: false,
  });
  assert.equal(s.suggestedQty, 150);
});

check("nets out an open PO", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 40, dynamic: false,
  });
  assert.equal(s.suggestedQty, 110);
});

check("drops off To Order once an open PO covers the need", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 150, dynamic: false,
  });
  assert.equal(s.suggestedQty, 0, "must be 0 so it moves to On Order");
});

check("no suggestion while stock is above the reorder point", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 80, minOnHand: 50, orderMinimum: 150, openPoQty: 0, dynamic: false,
  });
  assert.equal(s.suggestedQty, 0);
});

console.log("\nreorder suggestion — dynamic (s,S) mode (flag on)");

check("tops up to minOnHand + orderMinimum", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 0, dynamic: true,
  });
  assert.equal(s.targetLevel, 200);
  assert.equal(s.suggestedQty, 185, "200 target - 15 on hand");
});

check("orders more the further below the minimum stock has fallen", () => {
  const deep = getInventoryReorderSuggestion({
    onHand: 2, minOnHand: 50, orderMinimum: 150, openPoQty: 0, dynamic: true,
  });
  const shallow = getInventoryReorderSuggestion({
    onHand: 49, minOnHand: 50, orderMinimum: 150, openPoQty: 0, dynamic: true,
  });
  assert.equal(deep.suggestedQty, 198);
  assert.equal(shallow.suggestedQty, 151);
  assert.ok(deep.suggestedQty > shallow.suggestedQty, "this is the whole point of (s,S)");
});

check("incoming stock counts toward the trigger — leaves To Order once ordered", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 185, dynamic: true,
  });
  assert.equal(s.inventoryPosition, 200);
  assert.equal(s.suggestedQty, 0, "position is above the reorder point => On Order, not To Order");
});

check("a partial order still suggests the remainder", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 15, minOnHand: 50, orderMinimum: 150, openPoQty: 20, dynamic: true,
  });
  assert.equal(s.suggestedQty, 165, "200 target - (15 + 20)");
});

check("never returns a negative quantity", () => {
  const s = getInventoryReorderSuggestion({
    onHand: 500, minOnHand: 50, orderMinimum: 150, openPoQty: 500, dynamic: true,
  });
  assert.equal(s.suggestedQty, 0);
});

console.log("\nremainingInventoryReorderQty");
check("clamps at zero", () => {
  assert.equal(remainingInventoryReorderQty({ orderMinimum: 100, openPoQty: 250 }), 0);
  assert.equal(remainingInventoryReorderQty({ orderMinimum: 100, openPoQty: 40 }), 60);
});

console.log("\nrounding");
check("snaps up to a tidy increment by magnitude", () => {
  assert.equal(roundUpToIncrement(3.2), 4);
  assert.equal(roundUpToIncrement(41), 45);
  assert.equal(roundUpToIncrement(96), 100);
  assert.equal(roundUpToIncrement(247), 250);
  assert.equal(roundUpToIncrement(1234), 1300);
  assert.equal(roundUpToIncrement(0), 0);
  assert.equal(roundUpToIncrement(-5), 0);
});

console.log("\nlevels formula");

check("Min = lead-time demand + safety stock", () => {
  // 10/day, no variability => safety stock 0 => Min = 10 * 7 = 70
  const l = computeLevels({ avgDailyUsage: 10, stddevDaily: 0 }, 7, TEXTBOOK_PARAMS);
  assert.equal(l.demandDuringLeadTime, 70);
  assert.equal(l.safetyStock, 0);
  assert.equal(l.minOnHand, 70);
});

check("Order Min = coverage days of demand", () => {
  const l = computeLevels({ avgDailyUsage: 10, stddevDaily: 0 }, 7, TEXTBOOK_PARAMS);
  assert.equal(l.orderMin, 300, "10/day x 30 days");
});

check("safety cap holds lumpy demand in check", () => {
  // stddev >> mean, as seen on high-volume fittings (mean and sigma of similar size).
  const l = computeLevels({ avgDailyUsage: 10, stddevDaily: 200 }, 7, TEXTBOOK_PARAMS);
  assert.ok(l.safetyStockCapped, "raw Z*sigma*sqrt(LT) would dwarf actual demand");
  assert.equal(l.safetyStock, 70, "capped at 1x lead-time demand");
  // 70 demand + 70 safety = 140, rounded up to the nearest 25.
  assert.equal(l.minOnHand, 150);
  // Without the cap this part would demand an absurd reorder point.
  const uncapped = computeLevels({ avgDailyUsage: 10, stddevDaily: 200 }, 7, {
    ...TEXTBOOK_PARAMS,
    safetyCapMultiple: 1000,
  });
  assert.ok(uncapped.minOnHand > 800, `cap is doing real work (uncapped=${uncapped.minOnHand})`);
});

check("a longer lead time raises the reorder point", () => {
  const fastVendor = computeLevels({ avgDailyUsage: 10, stddevDaily: 0 }, 7.3, TEXTBOOK_PARAMS);
  const slowVendor = computeLevels({ avgDailyUsage: 10, stddevDaily: 0 }, 14.7, TEXTBOOK_PARAMS);
  assert.ok(slowVendor.minOnHand > fastVendor.minOnHand, "the slow vendor is ~2x slower");
});

check("zero usage yields zero levels", () => {
  const l = computeLevels({ avgDailyUsage: 0, stddevDaily: 0 }, 7, TEXTBOOK_PARAMS);
  assert.equal(l.minOnHand, 0);
  assert.equal(l.orderMin, 0);
});

console.log(`\nAll ${passed} inventory-levels assertions passed.\n`);
