import { config } from "./config.ts";
import { createLogger } from "./logger.ts";
import { planSearch, summarize } from "./llm.ts";
import { runSearch } from "./searchOrchestrator.ts";
import { summaryToMarkdown } from "./slack.ts";
import {
  markCompleted,
  markFailed,
  savePosts,
  saveSearchPlan,
  saveSummary,
  updateJobStatus,
} from "./jobStore.ts";
import type { NormalizedPost, PostSummary, SearchPlanFilters } from "./types.ts";

/**
 * Posts the finished result somewhere. The web flow passes the Slack incoming-webhook
 * poster; the slack-events flow passes a chat.postMessage poster bound to the
 * originating channel/thread. `summaries` is empty when nothing was relevant/found.
 */
export type ResultPoster = (
  intent: string,
  summaries: PostSummary[],
  posts: NormalizedPost[]
) => Promise<void>;

/** Optional sink for a human-readable failure message (e.g. reply in the Slack thread). */
export type ErrorNotifier = (message: string) => Promise<void>;

/** Map an internal error to a short, user-facing line. */
function friendlyError(message: string): string {
  if (/exhausted|quota|HTTP 429/i.test(message)) {
    return "⚠️ Couldn't finish — the LinkedIn search quota is used up for now. Try again later or add a fresh API key.";
  }
  return `⚠️ Couldn't finish this search (${message}). Please try again.`;
}

/**
 * Shared end-to-end pipeline: plan → search → summarize → relevance gate → post → persist.
 * Identical for web and Slack; only the `post` sink differs. `notifyError` (optional) lets
 * the caller surface a failure to the user — the web flow shows it via the DB row instead.
 */
export async function runPipeline(
  jobId: string,
  intent: string,
  maxPosts: number,
  userFilters: SearchPlanFilters,
  post: ResultPoster,
  notifyError?: ErrorNotifier
): Promise<void> {
  const logger = createLogger(jobId);

  try {
    logger.info("planning", "Generating search plan");
    await updateJobStatus(jobId, "planning");
    const plan = await planSearch(intent);
    plan.filters = { ...plan.filters, ...userFilters };
    await saveSearchPlan(jobId, plan);
    logger.info("planning", "Search plan ready", { plan });

    const { posts, callsUsed } = await runSearch(plan, logger, maxPosts);
    await savePosts(jobId, posts, callsUsed);

    if (posts.length === 0) {
      const emptyMsg =
        "No LinkedIn posts matched this search. Try broadening the intent, removing filters, or widening the date range.";
      await saveSummary(jobId, emptyMsg);
      await post(intent, [], posts);
      await markCompleted(jobId);
      logger.info("completed", "Job completed (no posts)");
      return;
    }

    logger.info("summarizing", `Summarizing ${posts.length} posts`);
    const allSummaries = await summarize(intent, posts);

    // Keep only genuinely relevant posts (LLM relevance >= threshold).
    const relevant = allSummaries.filter((s) => s.relevance >= config.minRelevance);
    logger.info(
      "summarizing",
      `${relevant.length}/${allSummaries.length} posts cleared relevance >= ${config.minRelevance}`
    );

    const summaryMarkdown = relevant.length
      ? summaryToMarkdown(relevant, posts)
      : `No posts relevant to "${intent}" were found in this search. Try rephrasing the intent or adjusting filters.`;
    await saveSummary(jobId, summaryMarkdown);

    logger.info("posting", "Posting summary");
    await post(intent, relevant, posts);

    await markCompleted(jobId);
    logger.info("completed", "Job completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("failed", message);
    await markFailed(jobId, message).catch((e) =>
      logger.error("failed", `Failed to record failure: ${e}`)
    );
    if (notifyError) {
      await notifyError(friendlyError(message)).catch((e) =>
        logger.error("failed", `Failed to notify error: ${e}`)
      );
    }
  }
}
