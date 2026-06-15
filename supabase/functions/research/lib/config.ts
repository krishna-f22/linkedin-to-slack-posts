function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function linkdApiKeys(): string[] {
  // Supports a comma-separated LINKDAPI_KEYS (for key failover) and/or single LINKDAPI_KEY.
  const multi = Deno.env.get("LINKDAPI_KEYS") ?? "";
  const single = Deno.env.get("LINKDAPI_KEY") ?? "";
  const keys = [...multi.split(","), single]
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    throw new Error("Missing required environment variable: LINKDAPI_KEY or LINKDAPI_KEYS");
  }
  return unique;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  openaiApiKey: required("OPENAI_API_KEY"),
  linkdApiKeys: linkdApiKeys(),
  slackWebhookUrl: required("SLACK_WEBHOOK_URL"),
  maxLinkdApiCalls: optionalInt("MAX_LINKDAPI_CALLS", 6),
  minPostsThreshold: optionalInt("MIN_POSTS_THRESHOLD", 8),
  plannerModel: Deno.env.get("OPENAI_PLANNER_MODEL") || "gpt-5-mini",
  summarizerModel: Deno.env.get("OPENAI_SUMMARIZER_MODEL") || "gpt-5",
};
