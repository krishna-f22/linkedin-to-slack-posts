import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { config } from "./lib/config.ts";
import { postSummaryToSlack } from "./lib/slack.ts";
import { runPipeline } from "./lib/pipeline.ts";
import { createJob } from "./lib/jobStore.ts";
import type { SearchPlanFilters } from "./lib/types.ts";

const MAX_INTENT_LENGTH = 500;
const ALLOWED_POST_LIMITS = [10, 20, 30, 40, 50] as const;
const DEFAULT_POST_LIMIT = 10;

const ALLOWED_DATE_POSTED = ["past-24h", "past-week", "past-month", "past-year"] as const;
const ALLOWED_CONTENT_TYPE = [
  "videos",
  "photos",
  "documents",
  "jobs",
  "liveVideos",
  "collaborativeArticles",
] as const;
const ALLOWED_SORT_BY = ["relevance", "date_posted"] as const;

function parseUserFilters(raw: unknown): SearchPlanFilters {
  const filters: SearchPlanFilters = {};
  if (typeof raw !== "object" || raw === null) return filters;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.authorJobTitle === "string" && obj.authorJobTitle.trim()) {
    filters.authorJobTitle = obj.authorJobTitle.trim().slice(0, 200);
  }
  if (ALLOWED_DATE_POSTED.includes(obj.datePosted as never)) {
    filters.datePosted = obj.datePosted as SearchPlanFilters["datePosted"];
  }
  if (ALLOWED_CONTENT_TYPE.includes(obj.contentType as never)) {
    filters.contentType = obj.contentType as SearchPlanFilters["contentType"];
  }
  if (ALLOWED_SORT_BY.includes(obj.sortBy as never)) {
    filters.sortBy = obj.sortBy as SearchPlanFilters["sortBy"];
  }

  return filters;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const intent = typeof body?.intent === "string" ? body.intent.trim() : "";

    if (!intent) {
      return new Response(JSON.stringify({ error: "intent is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (intent.length > MAX_INTENT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `intent must be ${MAX_INTENT_LENGTH} characters or fewer` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const maxPosts = ALLOWED_POST_LIMITS.includes(body?.maxPosts)
      ? (body.maxPosts as number)
      : DEFAULT_POST_LIMIT;

    const userFilters = parseUserFilters(body?.filters);

    const jobId = await createJob(userData.user.id, intent);

    // @ts-expect-error EdgeRuntime is a global provided by the Supabase Edge Runtime
    EdgeRuntime.waitUntil(
      runPipeline(jobId, intent, maxPosts, userFilters, postSummaryToSlack)
    );

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
