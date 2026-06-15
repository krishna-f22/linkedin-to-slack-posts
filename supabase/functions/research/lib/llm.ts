import { config } from "./config.ts";
import { fetchWithRetry } from "./retry.ts";
import type { NormalizedPost, PostSummary, SearchPlan } from "./types.ts";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const SEARCH_PLAN_SCHEMA = {
  name: "search_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      primary_query: { type: "string" },
      fallback_queries: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          authorJobTitle: { type: ["string", "null"] },
          datePosted: {
            type: ["string", "null"],
            enum: ["past-24h", "past-week", "past-month", "past-year", null],
          },
          contentType: {
            type: ["string", "null"],
            enum: [
              "videos",
              "photos",
              "documents",
              "jobs",
              "liveVideos",
              "collaborativeArticles",
              null,
            ],
          },
          sortBy: {
            type: ["string", "null"],
            enum: ["relevance", "date_posted", null],
          },
        },
        required: ["authorJobTitle", "datePosted", "contentType", "sortBy"],
      },
    },
    required: ["primary_query", "fallback_queries", "filters"],
  },
  strict: true,
};

const PLANNER_SYSTEM_PROMPT = `You are a LinkedIn search planner. Given a user's research intent, produce an optimized LinkedIn post search plan.

Rules:
- primary_query: a BROAD, high-recall keyword search (2-4 core keywords) that captures the heart of the intent. Maximize the number of relevant posts returned. Do NOT stack many AND terms and avoid quoted exact phrases here — keep it simple so it returns plenty of posts (e.g. prefer a short query like: AI agents startups — over a heavily stacked boolean one).
- fallback_queries: 1-3 alternative or more specific phrasings (this is where narrower boolean queries belong) to try if the primary query returns too few relevant results. Order by likely relevance.
- filters.authorJobTitle: ALWAYS set this to null. Author-role filtering is controlled exclusively by the user via a separate UI control, not by you. If the user's intent emphasizes a role (e.g. "founders", "CEOs", "AI engineers"), weave that role into primary_query/fallback_queries as a keyword instead (e.g. "(Founder OR CEO) AND fintech") rather than setting this filter.
- filters.datePosted: set to "past-24h", "past-week", "past-month", or "past-year" if the user implies recency (e.g. "recent", "latest", "this week"). Otherwise null.
- filters.contentType: set if the user explicitly wants a content format (videos, photos, documents, jobs, liveVideos, collaborativeArticles). Otherwise null.
- filters.sortBy: "date_posted" if the user wants the newest content, otherwise "relevance".
- Do NOT invent company names, person names, or IDs as filters - those are not supported.
- Keep queries concise (3-6 words), using terms that would realistically appear in LinkedIn posts.
- LinkedIn keyword search supports boolean operators AND, OR, NOT, and parentheses. Use these mainly in fallback_queries for precision. Keep primary_query broad for recall; reserve heavy boolean logic (multiple ANDs, quoted phrases) for fallbacks. Only use AND/OR/NOT when the intent genuinely implies that logic - do not force it into simple queries.`;

const SUMMARY_SCHEMA = {
  name: "post_summaries",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summaries: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            summary: { type: "string" },
            relevance: { type: "integer" },
          },
          required: ["index", "summary", "relevance"],
        },
      },
    },
    required: ["summaries"],
  },
  strict: true,
};

const SUMMARY_SYSTEM_PROMPT = `You summarize individual LinkedIn posts.

You are given the user's research intent and a numbered list of LinkedIn posts (each has an "index"). For EVERY post in the list, write a concise summary of that single post's content.

Rules:
- Produce exactly one summary object per input post, using the post's exact integer "index".
- Do NOT skip any post. Do NOT merge posts. Do NOT add an overall overview. Every post must appear.
- summary: 1-2 sentences capturing what THIS post actually says, relevant to the user's intent. Be specific and factual to the post's content.
- relevance: integer 0-100 scoring how well THIS post answers the user's intent (100 = directly on-topic and substantive, 0 = unrelated/spam). Score by meaning, not just keyword presence. Use the full range to differentiate posts.
- NEVER invent facts, names, or URLs. Only use the given post text.
- Write in clear, professional English. If a post is in another language, summarize its meaning in English. No emojis, no markdown headers.`;

async function callOpenAI(body: Record<string, unknown>): Promise<string> {
  const response = await fetchWithRetry(
    OPENAI_CHAT_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(body),
    },
    { retries: 2 }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API returned no content");
  }
  return content;
}

export async function planSearch(intent: string): Promise<SearchPlan> {
  const content = await callOpenAI({
    model: config.plannerModel,
    messages: [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: intent },
    ],
    response_format: { type: "json_schema", json_schema: SEARCH_PLAN_SCHEMA },
  });

  const parsed = JSON.parse(content);

  const filters: SearchPlan["filters"] = {};
  if (parsed.filters?.authorJobTitle) filters.authorJobTitle = parsed.filters.authorJobTitle;
  if (parsed.filters?.datePosted) filters.datePosted = parsed.filters.datePosted;
  if (parsed.filters?.contentType) filters.contentType = parsed.filters.contentType;
  if (parsed.filters?.sortBy) filters.sortBy = parsed.filters.sortBy;

  return {
    primary_query: parsed.primary_query,
    fallback_queries: parsed.fallback_queries ?? [],
    filters,
  };
}

export async function summarize(
  intent: string,
  posts: NormalizedPost[]
): Promise<PostSummary[]> {
  const postsForPrompt = posts.map((p, i) => ({
    index: i,
    author: p.author,
    text: p.text,
  }));

  const userContent = `User research intent: "${intent}"\n\nCollected LinkedIn posts (numbered by index):\n${JSON.stringify(postsForPrompt, null, 2)}`;

  const content = await callOpenAI({
    model: config.summarizerModel,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_schema", json_schema: SUMMARY_SCHEMA },
  });

  const parsed = JSON.parse(content) as { summaries?: PostSummary[] };
  return (parsed.summaries ?? [])
    .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < posts.length)
    .map((s) => ({ ...s, relevance: typeof s.relevance === "number" ? s.relevance : 0 }))
    .sort((a, b) => b.relevance - a.relevance);
}
