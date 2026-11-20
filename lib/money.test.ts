import { describe, expect, it } from "vitest";
import { coinCount, transfersFor } from "./money";

describe("money transfers", () => {
  it("rent: the payer pays the owner", () => {
    expect(transfersFor({ a: 1500, b: 1500 }, { a: 1450, b: 1550 })).toEqual([{ from: "a", to: "b", amount: 50 }]);
  });

  it("tax or buying: money goes to the bank; passing Start comes from it", () => {
    expect(transfersFor({ a: 1500, b: 1500 }, { a: 1350, b: 1500 })).toEqual([{ from: "a", to: null, amount: 150 }]);
    expect(transfersFor({ a: 1500 }, { a: 1700 })).toEqual([{ from: null, to: "a", amount: 200 }]);
  });

  it("mixed: rent to the owner, the rest from the bank", () => {
    // a passed Start (+200) and paid b $60 rent: a nets +140, b +60.
    expect(transfersFor({ a: 1000, b: 1000 }, { a: 1140, b: 1060 })).toEqual([
      { from: null, to: "a", amount: 140 },
      { from: null, to: "b", amount: 60 },
    ]);
    // a pays b 100 and c 50.
    expect(transfersFor({ a: 500, b: 0, c: 0 }, { a: 350, b: 100, c: 50 })).toEqual([
      { from: "a", to: "b", amount: 100 },
      { from: "a", to: "c", amount: 50 },
    ]);
  });

  it("no change, no payments; coin counts stay sensible", () => {
    expect(transfersFor({ a: 5 }, { a: 5 })).toEqual([]);
    expect([coinCount(10), coinCount(200), coinCount(5000)]).toEqual([3, 4, 10]);
  });
});
