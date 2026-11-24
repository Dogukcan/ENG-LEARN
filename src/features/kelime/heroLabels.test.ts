import { describe, expect, it } from "vitest";
import type { ReviewQueue } from "../../data";
import { kelimeHeroAction, kelimeHeroSubtitle } from "./heroLabels.ts";

describe("Kelime hero labels", () => {
  it("offers adding a word for an empty queue", () => {
    expect(kelimeHeroAction(false, 0, 0)).toEqual({ label: "Kelime ekle", ariaLabel: "Kelime ekle" });
    expect(kelimeHeroSubtitle({ cards: [], dueTotal: 12, estimatedMinutes: 0 } as unknown as ReviewQueue))
      .toBe("Şu an tekrar edilecek kart yok");
  });

  it("uses queue length for the action and all due cards for the subtitle", () => {
    const queue = { cards: [{}, {}], dueTotal: 23, estimatedMinutes: 2.2 } as ReviewQueue;
    expect(kelimeHeroAction(false, 65, queue.cards.length)).toEqual({
      label: "Tekrara başla · 2 kart", ariaLabel: "Kelime tekrarına başla, 2 kart",
    });
    expect(kelimeHeroSubtitle(queue)).toBe("23 kart bekliyor · tahmini 3 dk");
  });

  it("preserves the review estimate's minimum of one minute", () => {
    expect(kelimeHeroSubtitle({ cards: [{}], dueTotal: 1, estimatedMinutes: 0 } as ReviewQueue))
      .toBe("1 kart bekliyor · tahmini 1 dk");
  });

  it.each([0, 8])("prioritizes stopping a running Kelime timer with %i cards", (count) => {
    expect(kelimeHeroAction(true, 65, count)).toEqual({
      label: "Durdur · 01:05", ariaLabel: "Kelime sayacını durdur",
    });
  });

  it("keeps minutes above 59 in the stop label", () => {
    expect(kelimeHeroAction(true, 4503, 1).label).toBe("Durdur · 75:03");
  });
});
