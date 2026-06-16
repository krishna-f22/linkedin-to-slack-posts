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

const PLANNER_SYSTEM_PROMPT = `You convert a user's research intent into a SIMPLE LinkedIn post search keyword — the plain words the user would type into LinkedIn search. The endpoint already returns POSTS only, so keep it dead simple. The final step ranks relevance.

CORE RULE: keep the user's OWN words — the action word AND the topic/role/location they wrote. If the user says "hiring", keep "hiring". Do NOT invent phrases they did not say (no "we're hiring", no "we are looking for", no first-person rewrites). NEVER append the word "post" or "posts" to the query — it is implied. Strip all filler.

TWO HARD RULES proven against this API:
1. WORD ORDER: put the ACTION WORD FIRST. "hiring gen ai engineer" returns 479 fresh real job posts; "gen ai engineer hiring" returns nothing. Lead with the verb (hiring / launching / announcing), then the role.
2. NO LOCATION in the keyword. Adding a country/city like "india" skews results to recruitment-agency commentary, not real job posts ("hiring gen ai engineer" = 479 real posts; "hiring gen ai engineer india" = agency think-pieces). Real job posts name their own city anyway, so India jobs (Pune, Bangalore) still appear without the word. Keep location OUT of primary_query — the summarizer ranks location relevance from the intent.

Rules:
- primary_query: short plain keyword. NO boolean operators, NO quotes, NO parentheses, NO "post"/"posts", NO location word. Strip filler ("give me posts about", "post where", "people who", "with any experience", "in india").
  - HIRING intents → "hiring <role>" (verb FIRST, role only, NO location):
    - "give me posts about people hiring ai engineer" → "hiring ai engineer"
    - "post where people are hiring gen ai engineer in india with any experience" → "hiring gen ai engineer"
    - "hiring posts where they're hiring for engineers in India" → "hiring engineers"
  - CONCEPTUAL / insight intents → pass the phrase through almost verbatim (it is already a good search):
    - "How startups use AI agents for workflows" → "How startups use AI agents for workflows"
    - "how are startups using AI agents for support" → "startups AI agents support"
- fallback_queries: 1-3 simple alternatives / synonyms (plain keywords, verb-first, role only, no location, no operators). E.g. for the gen ai example: "hiring generative AI engineer", "hiring ML engineer", "hiring AI engineer".
- filters.authorJobTitle: ALWAYS null. (User controls role filtering via the UI — never set it here, and never put a role into primary_query unless the user's own topic IS that role.)
- filters.datePosted: "past-24h" | "past-week" | "past-month" | "past-year" only if the intent clearly implies recency; else null.
- filters.contentType: usually null. Only set if the user explicitly wants a format (videos/photos/documents/jobs/liveVideos/collaborativeArticles).
- filters.sortBy: set "date_posted" for hiring/job intents. With a role-only keyword (no location), date sort returns the FRESHEST real job posts (hours old) — proven: "hiring gen ai engineer" + date_posted = 378 real posts, all 3-23h old. Use "relevance" only for broad conceptual/insight questions ("how are startups using AI agents").
- Do NOT invent company/person names or IDs. NEVER put filter values (date, content type) or a location into primary_query.

Keep it short, plain, literal to the user's words. Relevance is decided later by the summarizer.`;

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
- relevance: integer 0-100 scoring how well THIS post answers the user's intent (100 = directly on-topic and substantive, 0 = unrelated/spam). Score by MEANING, not keyword presence. Use the full range to differentiate posts. Be strict — score under 40 when a post matches the search words but is off the user's actual ask. Example: intent "hiring gen ai engineer" → a post hiring a Full-Stack / Frontend / generic SDE engineer is OFF-topic; score it under 40 even though it says "hiring" and "engineer". Only posts that genuinely match the specific role/topic the user wants score high.
- DUPLICATES: the same job opening is often reposted by multiple recruiters or twice by the same person. Collapse them to ONE card. Treat posts as the SAME opening when the role AND the core details (responsibilities, required years/experience, skills) are essentially the same AND nothing clearly distinguishes them. When you find such a set, give ONE copy (the most complete) its real score and score every other copy under 40 so they drop. Identical or near-identical wording = same job, even if the author/recruiter differs and no company is named.
  ONLY keep them separate when a CLEAR distinguishing detail exists: a different company, a different city/branch (e.g. "TCS Gen AI Engineer Pune" vs "TCS Gen AI Engineer Bangalore" = two real jobs, keep both), or a different seniority/role. If two posts describe the same role+experience+skills with no such distinguishing detail, MERGE them.
- LOCATION: if the intent names a place (e.g. "in india", "bangalore", "remote"), use it to RANK, not to exclude. Show all unique on-topic jobs; just order them by location match:
  - Post in the intended place or a city/region within it (for India: Bangalore, Pune, Hyderabad, Mumbai, Chennai, Gurgaon, Delhi, Noida, Maharashtra, Karnataka, India), or "remote (<that place>)": score HIGH (80-100 if on-topic) — these rank at the TOP.
  - Post with NO clear location: score upper-middle (65-80 if on-topic) — don't penalize, a real local job often omits the country.
  - Post clearly in a DIFFERENT country/city (e.g. Belgium, Dallas TX, London for an India intent): still a real job, so keep it but score it LOWER (50-65 if on-topic) so it ranks at the BOTTOM, below the in-location ones. Do NOT drop it just for location.
  - Off-topic or duplicate posts still score under 40 regardless of location.
  - When the intent names no place, ignore location entirely.
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
