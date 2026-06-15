import { config } from "./config.ts";
import { fetchWithRetry } from "./retry.ts";
import type { LinkdApiResponse, LinkdApiSearchParams } from "./types.ts";

const RAPIDAPI_HOST = "linkdapi-best-unofficial-linkedin-api.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}/api/v1/search/posts`;

// Statuses that mean "this key is done" → switch to the next key.
const KEY_FAILOVER_STATUSES = [401, 403, 429];

// Remember which key worked last so subsequent calls start there (module-level).
let activeKeyIndex = 0;

export async function searchPosts(params: LinkdApiSearchParams): Promise<LinkdApiResponse> {
  const url = new URL(BASE_URL);
  url.searchParams.set("keyword", params.keyword);
  url.searchParams.set("start", String(params.start));
  if (params.authorJobTitle) url.searchParams.set("authorJobTitle", params.authorJobTitle);
  if (params.datePosted) url.searchParams.set("datePosted", params.datePosted);
  if (params.contentType) url.searchParams.set("contentType", params.contentType);
  if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);

  const keys = config.linkdApiKeys;
  let lastError = "";

  // Try each key once, starting from the last known-good one, wrapping around.
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIndex = (activeKeyIndex + attempt) % keys.length;
    const key = keys[keyIndex];

    const response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          "x-rapidapi-host": RAPIDAPI_HOST,
          "x-rapidapi-key": key,
          Accept: "application/json",
        },
      },
      // Don't auto-retry quota/auth statuses on the same key — fail over instead.
      { retries: 2, retryableStatuses: [500, 502, 503, 504] }
    );

    if (KEY_FAILOVER_STATUSES.includes(response.status)) {
      lastError = `key #${keyIndex + 1} exhausted (HTTP ${response.status}): ${await response.text()}`;
      continue; // try next key
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkdAPI error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as LinkdApiResponse;
    if (!json.success) {
      throw new Error(`LinkdAPI request failed: ${json.message}`);
    }

    // This key worked — make it the starting point for the next call.
    activeKeyIndex = keyIndex;
    return json;
  }

  throw new Error(
    `All ${keys.length} LinkdAPI key(s) exhausted (quota/auth). Last: ${lastError}`
  );
}
