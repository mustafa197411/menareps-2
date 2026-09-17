import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/firebase", () => ({ db: {}, auth: {}, storage: {} }));
import { formatOrderSnapshotMoney } from "./SalesOrders";
const market: any = { marketId: "SYNTH-M", countryId: "SYNTH-C", countryNameEn: "Synthetic", countryNameAr: "بلد", active: true, currencyCode: "LYD", currencySymbol: "LYD", symbolPosition: "AFTER", decimalPlaces: 3, numeralLocale: "en-US", timezone: "UTC", workingWeekdays: [1], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", autoCheckoutAt: "18:00" };
const order = { marketId: market.marketId, countryId: market.countryId, currencyCode: "LYD", currency: "LYD" };
describe("persisted Order currency representation", () => {
  it.each([false, true])("renders stored paid and free amounts with Offer=%s without repricing", hasOffer => {
    const snapshot = { ...order, selectedOfferIds: hasOffer ? ["SYNTH-O"] : [], product: { price: 999 }, productMarketCatalog: { unitPrice: 888 } };
    expect(formatOrderSnapshotMoney(25, snapshot, [market])).toBe("25.000 LYD");
    expect(formatOrderSnapshotMoney(2500, snapshot, [market])).toBe("2,500.000 LYD");
    expect(formatOrderSnapshotMoney(0, snapshot, [market])).toBe("0.000 LYD");
  });
  it.each([{}, { ...order, currencyCode: "USD" }, { ...order, countryId: "OTHER" }, { ...order, marketId: "OTHER" }, { ...order, currency: undefined, currencyCode: undefined }])("fails closed for missing or conflicting transaction identity %j", snapshot => {
    expect(formatOrderSnapshotMoney(25, snapshot, [market])).toBe("Configuration required");
  });
  it.each([[], [ { ...market, active: false } ], [{ ...market, currencyCode: "bad" }], [market, { ...market }]])("fails closed for unresolved market records", markets => {
    expect(formatOrderSnapshotMoney(25, order, markets)).toBe("Configuration required");
  });
});

it("formats each queue Order with its own currency, never selected-detail context", () => {
  const secondMarket = { ...market, marketId: "SYNTH-M2", countryId: "SYNTH-C2", currencyCode: "USD", currencySymbol: "$", symbolPosition: "BEFORE" as const, decimalPlaces: 2 };
  const second = { marketId: secondMarket.marketId, countryId: secondMarket.countryId, currencyCode: "USD" };
  expect(formatOrderSnapshotMoney(25, order, [market, secondMarket])).toBe("25.000 LYD");
  expect(formatOrderSnapshotMoney(25, second, [market, secondMarket])).toBe("$25.00");
  expect(formatOrderSnapshotMoney(25, second, [market])).toBe("Configuration required");
});

import { orderPaymentLabel } from "./SalesOrders";
it.each(["Unpaid", "Partially Paid", "Paid"])("displays canonical %s without calculating settlement", status => {
 expect(orderPaymentLabel(status)).toBe(status);
});
it("does not invent status for missing legacy projections",()=>expect(orderPaymentLabel(undefined)).toBe("Unavailable"));
