import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ auth: { currentUser: { getIdToken: vi.fn(async () => "TOKEN") } } }));
import { createAdminOfferDraft, getAdminOfferProducts, getAdminOfferRepresentatives, listAdminOffers, mutateAdminOffer, OfferAdminClientError } from "./offerAdminClient";

describe("Offer administration authenticated client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads Offers with a Firebase bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ offers: [], capabilities: {} }), { status: 200 }));
    expect((await listAdminOffers()).offers).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/offers", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer TOKEN" }) }));
  });

  it("loads bounded canonical Product options and preserves continuation", async () => {
    const body = { marketContext: { status: "UNRESOLVED" }, products: [{ id: "PRODUCT-A", name: "Synthetic Product", price: 12 }], continuation: "PRODUCT-A" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await getAdminOfferProducts("PRODUCT-PREVIOUS")).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/offers/product-options?continuation=PRODUCT-PREVIOUS", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer TOKEN" }) }));
  });

  it("preserves empty visible pages with a continuation and sends examined-page controls", async () => {
    const body = { offers: [], capabilities: {}, continuation: "NEXT" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await listAdminOffers({ pageSize: 50, continuation: "PREVIOUS" })).toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/offers?pageSize=50&continuation=PREVIOUS");
  });

  it("sends draft identity and opaque representative continuation without a root or role", async () => {
    const body = { representatives: [{ id: "REP-A", name: "Synthetic Rep" }], continuationToken: "NEXT" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const controls = { offerId: "OFFER-A", pageSize: 100, continuationToken: "PREVIOUS" };
    expect(await getAdminOfferRepresentatives(controls)).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/offers/representative-options", expect.objectContaining({ method: "POST", body: JSON.stringify(controls) }));
  });

  it("returns controlled permission and stale-revision errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "OFFER_PERMISSION_DENIED" }), { status: 403 }));
    await expect(listAdminOffers()).rejects.toMatchObject({ code: "OFFER_PERMISSION_DENIED", status: 403 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "OFFER_STALE_REVISION" }), { status: 409 }));
    await expect(mutateAdminOffer({})).rejects.toMatchObject({ code: "OFFER_STALE_REVISION", status: 409 });
  });

  it("classifies recoverable read and write network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(listAdminOffers()).rejects.toEqual(new OfferAdminClientError("OFFER_READ_FAILED", 0));
    await expect(createAdminOfferDraft({})).rejects.toEqual(new OfferAdminClientError("OFFER_WRITE_FAILED", 0));
  });
});

 it("classifies candidate HTTP and representative network failures as reads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(getAdminOfferProducts()).rejects.toMatchObject({ code: "OFFER_READ_FAILED" });
    await expect(getAdminOfferRepresentatives({})).rejects.toMatchObject({ code: "OFFER_READ_FAILED" });
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
    await expect(getAdminOfferRepresentatives({})).rejects.toMatchObject({ code: "OFFER_READ_FAILED" });
  });
