import { computeOrder, allocateProportional, resolveDiscount } from '../src/lib/pricing';

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
  else console.log(`pass  ${name}`);
};

// ---- 1. plain line, 5% exclusive tax -------------------------------------
const t1 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Paneer Tikka', unitPrice: 26000, qty: 2, taxPct: 5 }],
  roundOffTotals: false,
});
check('subtotal 2x260', t1.itemsSubtotal, 52000);
check('tax 5% of 520', t1.taxTotal, 2600);
check('grand total', t1.grandTotal, 54600);

// ---- 2. add-ons multiply with quantity -----------------------------------
const t2 = computeOrder({
  lines: [{
    key: 'a', menuItemId: 'i1', name: 'Roti', unitPrice: 2500, qty: 4, taxPct: 5,
    addOns: [{ name: 'Butter', price: 1000 }],
  }],
  roundOffTotals: false,
});
check('add-on per unit', t2.itemsSubtotal, (2500 + 1000) * 4);

// ---- 3. mixed tax rates with a whole-order percent discount --------------
// Lines: 1000 @5%, 1000 @18%. 10% order discount = 200, split 100/100.
const t3 = computeOrder({
  lines: [
    { key: 'a', menuItemId: 'i1', name: 'Dal', unitPrice: 100000, qty: 1, taxPct: 5 },
    { key: 'b', menuItemId: 'i2', name: 'Coffee', unitPrice: 100000, qty: 1, taxPct: 18 },
  ],
  orderDiscount: { kind: 'PERCENT', value: 10 },
  roundOffTotals: false,
});
check('order discount 10%', t3.orderDiscount, 20000);
check('allocation is exact', t3.lines.map((l) => l.allocatedOrderDiscount), [10000, 10000]);
check('taxable after discount', t3.taxableAmount, 180000);
check('tax 5% + 18% on 900 each', t3.taxTotal, 4500 + 16200);
check('grand total', t3.grandTotal, 180000 + 20700);

// ---- 4. discount allocation must never lose a paisa ----------------------
// 333 split across three unequal lines.
const alloc = allocateProportional(333, [100, 100, 101]);
check('largest remainder sums exactly', alloc.reduce((a, b) => a + b, 0), 333);
const alloc2 = allocateProportional(1, [1, 1, 1]);
check('single unit goes to one line', alloc2.reduce((a, b) => a + b, 0), 1);

// ---- 5. a line already free absorbs none of the order discount ----------
const t5 = computeOrder({
  lines: [
    { key: 'a', menuItemId: 'i1', name: 'Free water', unitPrice: 2000, qty: 1, taxPct: 0, isComplimentary: true },
    { key: 'b', menuItemId: 'i2', name: 'Biryani', unitPrice: 29000, qty: 1, taxPct: 5 },
  ],
  orderDiscount: { kind: 'PERCENT', value: 10 },
  roundOffTotals: false,
});
check('complimentary line fully discounted', t5.lines[0].taxableAmount, 0);
check('order discount only on the paid line', t5.lines[0].allocatedOrderDiscount, 0);
check('order discount = 10% of 290', t5.orderDiscount, 2900);

// ---- 6. fixed discount cannot exceed the bill ---------------------------
const t6 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Chai', unitPrice: 3000, qty: 1, taxPct: 5 }],
  orderDiscount: { kind: 'FIXED', value: 999999 },
  roundOffTotals: false,
});
check('discount capped at subtotal', t6.orderDiscount, 3000);
check('total floors at zero', t6.grandTotal, 0);

// ---- 7. coupon cap ------------------------------------------------------
check('maxDiscount caps percent', resolveDiscount('PERCENT', 50, 100000, 15000), 15000);

// ---- 8. rounding -------------------------------------------------------
const t8 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Thali', unitPrice: 26000, qty: 1, taxPct: 5 }],
  roundOffTotals: true,
});
// 260.00 + 13.00 = 273.00 exactly -> no rounding
check('no round off needed', t8.roundOff, 0);
const t9 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Snack', unitPrice: 9990, qty: 1, taxPct: 5 }],
  roundOffTotals: true,
});
// 99.90 + 5.00 (4.995 -> 5.00 half-up) = 104.90 -> rounds to 105.00 (+0.10)
check('round off applied', t9.roundOff, 10);
check('rounded total is whole rupees', t9.grandTotal % 100, 0);

// ---- 9. zero-quantity lines are dropped --------------------------------
const t10 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Ghost', unitPrice: 5000, qty: 0, taxPct: 5 }],
  roundOffTotals: false,
});
check('empty cart totals zero', [t10.grandTotal, t10.itemCount], [0, 0]);

// ---- 10. charges are added after tax ------------------------------------
const t11 = computeOrder({
  lines: [{ key: 'a', menuItemId: 'i1', name: 'Biryani', unitPrice: 29000, qty: 1, taxPct: 5 }],
  packagingCharge: 1000,
  deliveryCharge: 3000,
  roundOffTotals: false,
});
check('charges added untaxed', t11.grandTotal, 29000 + 1450 + 1000 + 3000);

console.log(failures === 0 ? '\nAll pricing tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
