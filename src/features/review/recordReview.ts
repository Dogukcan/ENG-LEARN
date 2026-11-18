import { repository } from "../../data";
import type { ReviewSummary } from "./ReviewSession";

/**
 * Write the review session's minutes to the activity log, once, when at least one card was graded.
 * Why: without it the Kelime minutes never reach Bugün's strip and the "next block" rule would keep
 * suggesting Kelime after the learner already did it. Both places that open the session call this.
 */
export async function recordReviewMinutes(summary: ReviewSummary): Promise<void> {
  if (summary.reviewed <= 0 || summary.minutes <= 0) return;
  await repository.activity.add({
    block: "kelime",
    startedAt: summary.startedAt,
    seconds: summary.minutes * 60,
    source: "timer",
  });
}
