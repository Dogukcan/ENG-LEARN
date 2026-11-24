import type { ReviewQueue } from "../../data";
import { reviewMinutes } from "../bugun/todayLogic.ts";
import { formatMMSS } from "../timer/timerMath.ts";

export function kelimeHeroSubtitle(queue: ReviewQueue): string {
  if (queue.cards.length === 0) return "Şu an tekrar edilecek kart yok";
  return `${queue.dueTotal} kart bekliyor · tahmini ${reviewMinutes(queue.cards.length, queue.estimatedMinutes)} dk`;
}

export function kelimeHeroAction(running: boolean, elapsedSeconds: number, cardCount: number) {
  if (running) {
    return { label: `Durdur · ${formatMMSS(elapsedSeconds)}`, ariaLabel: "Kelime sayacını durdur" };
  }
  if (cardCount > 0) {
    return { label: `Tekrara başla · ${cardCount} kart`, ariaLabel: `Kelime tekrarına başla, ${cardCount} kart` };
  }
  return { label: "Kelime ekle", ariaLabel: "Kelime ekle" };
}
