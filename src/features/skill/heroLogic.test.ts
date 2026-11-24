import { describe, expect, it } from "vitest";
import { NBSP } from "../bugun/todayLogic";
import { ringFraction as pathRingFraction } from "../bugun/pathLogic";
import { heroAriaLabel, heroKicker, heroRemaining, miniRingAriaLabel, ringFraction } from "./heroLogic";

describe("hero labels", () => {
  it.each([
    ["okuma", 0, 20, false, "Okuma: 0 / 20 dakika. Ayrıntıyı aç"],
    ["okuma", 12, 20, true, "Okuma: 12 / 20 dakika, çalışıyor. Ayrıntıyı aç"],
    ["kelime", 15, 15, false, "Kelime: 15 / 15 dakika, tamamlandı. Ayrıntıyı aç"],
    ["kelime", 16, 15, true, "Kelime: 16 / 15 dakika, tamamlandı, çalışıyor. Ayrıntıyı aç"],
    ["okuma", 0, 0, false, "Okuma: 0 / 0 dakika. Ayrıntıyı aç"],
    ["kelime", 3, 0, true, "Kelime: 3 / 0 dakika, çalışıyor. Ayrıntıyı aç"],
  ] as const)("hero %s %i/%i running=%s", (block, done, plan, running, expected) => {
    expect(heroAriaLabel(block, done, plan, running)).toBe(expected);
  });

  it.each([
    ["okuma", 0, 20, "Okuma: 0 / 20 dakika"],
    ["kelime", 8, 15, "Kelime: 8 / 15 dakika"],
    ["okuma", 20, 20, "Okuma: 20 / 20 dakika, tamamlandı"],
    ["kelime", 16, 15, "Kelime: 16 / 15 dakika, tamamlandı"],
    ["okuma", 0, 0, "Okuma: 0 / 0 dakika"],
    ["kelime", 3, 0, "Kelime: 3 / 0 dakika"],
  ] as const)("mini %s %i/%i", (block, done, plan, expected) => {
    expect(miniRingAriaLabel(block, done, plan)).toBe(expected);
  });

  it("formats idle and running kickers including zero seconds", () => {
    expect(heroKicker(0, 20, null)).toBe(`Bugün · 0${NBSP}/${NBSP}20${NBSP}dk`);
    expect(heroKicker(15, 15, null)).toBe(`Bugün · 15${NBSP}/${NBSP}15${NBSP}dk`);
    expect(heroKicker(3, 0, null)).toBe(`Bugün · 3${NBSP}/${NBSP}0${NBSP}dk`);
    expect(heroKicker(0, 20, 0)).toBe("Çalışıyor · 00:00");
    expect(heroKicker(16, 15, 125)).toBe("Çalışıyor · 02:05");
  });

  it("formats remaining, completed and unplanned minutes", () => {
    expect(heroRemaining(0, 20)).toBe(`20${NBSP}dk kaldı`);
    expect(heroRemaining(12, 20)).toBe(`8${NBSP}dk kaldı`);
    expect(heroRemaining(20, 20)).toBe("Bugünkü plan tamam");
    expect(heroRemaining(21, 20)).toBe("Bugünkü plan tamam");
    expect(heroRemaining(0, 0)).toBe("Plan yok");
    expect(heroRemaining(3, 0)).toBe("Plan yok");
  });

  it("re-exports the existing ring fraction", () => {
    expect(ringFraction).toBe(pathRingFraction);
  });
});
