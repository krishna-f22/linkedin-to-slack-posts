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
  // Single source of truth: LINKDAPI_KEYS — one key, or several comma-separated for failover.
  const raw = Deno.env.get("LINKDAPI_KEYS") ?? "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    throw new Error("Missing required environment variable: LINKDAPI_KEYS");
  }
  return unique;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  openaiApiKey: required("OPENAI_API_KEY"),
  linkdApiKeys: linkdApiKeys(),
  slackWebhookUrl: required("SLACK_WEBHOOK_URL"),
  // Slack bot creds — lazy so the web `research` fn doesn't hard-require them at import.
  // Only the `slack-events` fn (chat.postMessage + signature verify) reads these.
  get slackBotToken(): string {
    return required("SLACK_BOT_TOKEN");
  },
  get slackSigningSecret(): string {
    return required("SLACK_SIGNING_SECRET");
  },
  slackBotUserId: Deno.env.get("SLACK_BOT_USER_ID") || "",
  maxLinkdApiCalls: optionalInt("MAX_LINKDAPI_CALLS", 6),
  minPostsThreshold: optionalInt("MIN_POSTS_THRESHOLD", 8),
  minRelevance: optionalInt("MIN_RELEVANCE", 50),
  plannerModel: Deno.env.get("OPENAI_PLANNER_MODEL") || "gpt-5",
  summarizerModel: Deno.env.get("OPENAI_SUMMARIZER_MODEL") || "gpt-5",
};
