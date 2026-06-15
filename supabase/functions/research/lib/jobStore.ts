import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { config } from "./config.ts";
import type { JobStatus, NormalizedPost, SearchPlan } from "./types.ts";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export async function createJob(userId: string, intent: string): Promise<string> {
  const { data, error } = await getClient()
    .from("research_jobs")
    .insert({ user_id: userId, intent, status: "pending" satisfies JobStatus })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data.id as string;
}

export async function updateJobStatus(jobId: string, status: JobStatus): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({ status })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to update job status: ${error.message}`);
}

export async function saveSearchPlan(jobId: string, plan: SearchPlan): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({ search_plan: plan, status: "searching" satisfies JobStatus })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to save search plan: ${error.message}`);
}

export async function savePosts(
  jobId: string,
  posts: NormalizedPost[],
  linkdApiCallsUsed: number
): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({
      posts,
      linkdapi_calls_used: linkdApiCallsUsed,
      status: "summarizing" satisfies JobStatus,
    })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to save posts: ${error.message}`);
}

export async function saveSummary(jobId: string, summaryMarkdown: string): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({ summary_markdown: summaryMarkdown, status: "posting" satisfies JobStatus })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to save summary: ${error.message}`);
}

export async function markCompleted(jobId: string): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({ status: "completed" satisfies JobStatus, slack_posted_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to mark job completed: ${error.message}`);
}

export async function markFailed(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await getClient()
    .from("research_jobs")
    .update({ status: "failed" satisfies JobStatus, error: errorMessage })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to mark job failed: ${error.message}`);
}
