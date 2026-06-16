import { config } from "./config.ts";
import { searchPosts } from "./linkdapi.ts";
import { dedupePosts, normalizePost } from "./normalize.ts";
import type { Logger } from "./logger.ts";
import type { NormalizedPost, SearchPlan } from "./types.ts";

const PAGE_SIZE = 10;

export interface SearchResult {
  posts: NormalizedPost[];
  callsUsed: number;
}

/**
 * Runs the primary query first, paginating until enough posts are found,
 * the API reports no more results, or the call budget is exhausted.
 * Falls back to subsequent queries (merging + deduping) if still short.
 */
export async function runSearch(
  plan: SearchPlan,
  logger: Logger,
  maxPosts: number = config.minPostsThreshold
): Promise<SearchResult> {
  const queries = [plan.primary_query, ...plan.fallback_queries];
  // One call per page of results requested; default 10 posts → 1 call.
  const targetCalls = Math.max(
    1,
    Math.min(config.maxLinkdApiCalls, Math.ceil(maxPosts / PAGE_SIZE))
  );
  let posts: NormalizedPost[] = [];
  let callsUsed = 0;

  for (const query of queries) {
    if (posts.length >= maxPosts) break;
    if (callsUsed >= targetCalls) break;
    // Fallback queries only run when the primary found literally nothing —
    // never spend extra quota just to top up an already-productive search.
    if (query !== plan.primary_query && posts.length > 0) break;

    let start = 0;
    let hasMore = true;

    while (hasMore) {
      if (callsUsed >= targetCalls) break;
      if (posts.length >= maxPosts) break;

      callsUsed++;
      logger.info("searching", `Searching "${query}" start=${start}`, { call: callsUsed });

      const response = await searchPosts({
        keyword: query,
        start,
        authorJobTitle: plan.filters.authorJobTitle,
        datePosted: plan.filters.datePosted,
        contentType: plan.filters.contentType,
        sortBy: plan.filters.sortBy,
      });

      const data = response.data;
      if (!data) break;

      const normalized = data.posts.map(normalizePost);
      posts = dedupePosts([...posts, ...normalized]);

      hasMore = data.hasMore;
      start += PAGE_SIZE;
    }
  }

  posts = posts.slice(0, maxPosts);

  logger.info("searching", `Collected ${posts.length} posts using ${callsUsed} LinkdAPI calls`);

  return { posts, callsUsed };
}
