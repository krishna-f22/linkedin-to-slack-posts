"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabaseClient";
import type { ResearchJob } from "@/lib/types";

const STATUS_LABELS: Record<ResearchJob["status"], string> = {
  pending: "Queued",
  planning: "Planning search",
  searching: "Searching LinkedIn",
  summarizing: "Summarizing",
  posting: "Posting to Slack",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_STYLES: Record<ResearchJob["status"], string> = {
  pending: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  planning: "bg-blue-50 text-blue-700 ring-blue-200",
  searching: "bg-blue-50 text-blue-700 ring-blue-200",
  summarizing: "bg-violet-50 text-violet-700 ring-violet-200",
  posting: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-green-50 text-green-700 ring-green-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

const IN_PROGRESS: ResearchJob["status"][] = [
  "pending",
  "planning",
  "searching",
  "summarizing",
  "posting",
];

const PROGRESS_STEPS: ResearchJob["status"][] = [
  "pending",
  "planning",
  "searching",
  "summarizing",
  "posting",
  "completed",
];

const POST_LIMIT_OPTIONS = [10, 20, 30, 40, 50] as const;

const ROLE_PRESETS = ["Founder", "CEO", "Engineer", "Product Manager", "Recruiter", "Marketing"];

const DATE_POSTED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "past-24h", label: "Past 24 hours" },
  { value: "past-week", label: "Past week" },
  { value: "past-month", label: "Past month" },
  { value: "past-year", label: "Past year" },
] as const;

const CONTENT_TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "videos", label: "Videos" },
  { value: "photos", label: "Photos" },
  { value: "documents", label: "Documents" },
  { value: "jobs", label: "Jobs" },
  { value: "liveVideos", label: "Live videos" },
  { value: "collaborativeArticles", label: "Collaborative articles" },
] as const;

const SORT_BY_OPTIONS = [
  { value: "", label: "Best match (auto)" },
  { value: "relevance", label: "Relevance" },
  { value: "date_posted", label: "Latest" },
] as const;

const MAX_INTENT_LENGTH = 500;

function Spinner({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function StatusBadge({ status }: { status: ResearchJob["status"] }) {
  const inProgress = IN_PROGRESS.includes(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {inProgress && <Spinner className="h-3 w-3" />}
      {status === "completed" && (
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {status === "failed" && (
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 10-1.06-1.06L10 8.94 8.28 7.22z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function ProgressBar({ status }: { status: ResearchJob["status"] }) {
  if (status === "failed") return null;
  const currentIndex = PROGRESS_STEPS.indexOf(status);
  const pct = ((currentIndex + 1) / PROGRESS_STEPS.length) * 100;
  return (
    <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          status === "completed" ? "bg-green-500" : "bg-blue-500"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function ResearchDashboard({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [intent, setIntent] = useState("");
  const [postLimit, setPostLimit] = useState<number>(10);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [authorJobTitle, setAuthorJobTitle] = useState("");
  const [datePosted, setDatePosted] = useState("");
  const [contentType, setContentType] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function loadJobs() {
      const { data } = await supabase
        .from("research_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (data) setJobs(data as ResearchJob[]);
      setLoadingJobs(false);
    }

    loadJobs();

    const channel = supabase
      .channel("research_jobs_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "research_jobs" },
        (payload) => {
          setJobs((current) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as ResearchJob, ...current];
            }
            if (payload.eventType === "UPDATE") {
              return current.map((job) =>
                job.id === (payload.new as ResearchJob).id
                  ? (payload.new as ResearchJob)
                  : job
              );
            }
            return current;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = intent.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setSubmitError(null);

    const filters: Record<string, string> = {};
    if (authorJobTitle.trim()) filters.authorJobTitle = authorJobTitle.trim();
    if (datePosted) filters.datePosted = datePosted;
    if (contentType) filters.contentType = contentType;
    if (sortBy) filters.sortBy = sortBy;

    const supabase = createClient();
    const { error } = await supabase.functions.invoke("research", {
      body: { intent: trimmed, maxPosts: postLimit, filters },
    });

    if (error) {
      setSubmitError(error.message);
    } else {
      setIntent("");
    }

    setSubmitting(false);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 4h16v16H4V4zm3.5 13.5h2.25v-7H7.5v7zm1.125-8a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6zM18.5 17.5v-3.85c0-2.06-1.1-3.02-2.56-3.02-1.18 0-1.71.65-2 1.1v-.95h-2.25c.03.7 0 7.72 0 7.72h2.25v-4.31c0-.23.02-.46.09-.62.18-.46.6-.93 1.3-.93.92 0 1.27.7 1.27 1.73v4.13h2.4z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-zinc-900">
                LinkedIn Research Assistant
              </h1>
              <p className="text-xs leading-tight text-zinc-500">{userEmail}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">What do you want to research?</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Describe what you're curious about in plain language — we'll turn it into a LinkedIn
            search, summarize the results, and post them to Slack.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              maxLength={MAX_INTENT_LENGTH}
              rows={3}
              placeholder="e.g. How are startups using AI agents for customer support?"
              className="resize-none rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="post-limit" className="text-xs font-medium text-zinc-600">
                  Posts to gather
                </label>
                <select
                  id="post-limit"
                  value={postLimit}
                  onChange={(e) => setPostLimit(Number(e.target.value))}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                >
                  {POST_LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} posts
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400">~{Math.ceil(postLimit / 10)} API calls</span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">
                  {intent.length}/{MAX_INTENT_LENGTH}
                </span>
                <button
                  type="submit"
                  disabled={submitting || !intent.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting && <Spinner className="h-3.5 w-3.5" />}
                  {submitting ? "Submitting..." : "Research"}
                </button>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                <svg
                  className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
                Advanced filters{" "}
                {(authorJobTitle || datePosted || contentType || sortBy) && (
                  <span className="rounded-full bg-zinc-100 px-1.5 text-zinc-500">
                    {[authorJobTitle, datePosted, contentType, sortBy].filter(Boolean).length}
                  </span>
                )}
              </button>

              {showAdvanced && (
                <div className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div>
                    <p className="text-xs font-medium text-zinc-600">
                      Author role{" "}
                      <span className="text-zinc-400">(optional — leave blank to let AI decide)</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ROLE_PRESETS.map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() =>
                            setAuthorJobTitle((current) => (current === role ? "" : role))
                          }
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                            authorJobTitle === role
                              ? "bg-zinc-900 text-white ring-zinc-900"
                              : "bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-100"
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={authorJobTitle}
                      onChange={(e) => setAuthorJobTitle(e.target.value)}
                      maxLength={100}
                      placeholder="Or type any role, e.g. Head of Growth"
                      className="mt-1.5 w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-600">Date posted</label>
                      <select
                        value={datePosted}
                        onChange={(e) => setDatePosted(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                      >
                        {DATE_POSTED_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-600">Content type</label>
                      <select
                        value={contentType}
                        onChange={(e) => setContentType(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                      >
                        {CONTENT_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-600">Sort by</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                      >
                        {SORT_BY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {submitError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-200">
                {submitError}
              </p>
            )}
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">Research jobs</h2>

          {loadingJobs && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white py-10">
              <Spinner className="h-5 w-5 text-zinc-400" />
            </div>
          )}

          {!loadingJobs && jobs.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-white py-10 text-center">
              <p className="text-sm font-medium text-zinc-700">No research jobs yet</p>
              <p className="text-sm text-zinc-400">
                Submit a request above to get started.
              </p>
            </div>
          )}

          {jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">{job.intent}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{timeAgo(job.created_at)}</p>
                </div>
                <StatusBadge status={job.status} />
              </div>

              <ProgressBar status={job.status} />

              {job.search_plan && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-500">
                  <span>
                    {IN_PROGRESS.includes(job.status) ? "Searching for" : "Searched for"}{" "}
                    <span className="font-medium text-zinc-700">
                      "{job.search_plan.primary_query}"
                    </span>
                  </span>
                  {job.search_plan.filters?.authorJobTitle && (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-600">
                      role: {job.search_plan.filters.authorJobTitle}
                    </span>
                  )}
                  {job.search_plan.filters?.datePosted && (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-600">
                      {job.search_plan.filters.datePosted.replace("-", " ")}
                    </span>
                  )}
                  {job.search_plan.filters?.contentType && (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-600">
                      {job.search_plan.filters.contentType}
                    </span>
                  )}
                  {job.search_plan.filters?.sortBy && (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-600">
                      sort: {job.search_plan.filters.sortBy.replace("_", " ")}
                    </span>
                  )}
                </div>
              )}

              {job.status === "failed" && job.error && (
                <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100">
                  {job.error}
                </p>
              )}

              {job.summary_markdown && (
                <div className="prose prose-sm prose-zinc mt-3 max-w-none border-t border-zinc-100 pt-3">
                  <ReactMarkdown>{job.summary_markdown}</ReactMarkdown>
                </div>
              )}

              {(job.linkdapi_calls_used > 0 || job.slack_posted_at) && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-2.5 text-xs text-zinc-400">
                  {job.posts && (
                    <span>
                      {job.posts.length} post{job.posts.length === 1 ? "" : "s"} analyzed
                    </span>
                  )}
                  {job.linkdapi_calls_used > 0 && <span>{job.linkdapi_calls_used} API calls</span>}
                  {job.slack_posted_at && (
                    <span className="inline-flex items-center gap-1 text-green-600">
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Posted to Slack {timeAgo(job.slack_posted_at)}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
