export type JobStatus =
  | "pending"
  | "planning"
  | "searching"
  | "summarizing"
  | "posting"
  | "completed"
  | "failed";

export interface SearchPlanFilters {
  authorJobTitle?: string;
  datePosted?: "past-24h" | "past-week" | "past-month" | "past-year";
  contentType?:
    | "videos"
    | "photos"
    | "documents"
    | "jobs"
    | "liveVideos"
    | "collaborativeArticles";
  sortBy?: "relevance" | "date_posted";
}

export interface SearchPlan {
  primary_query: string;
  fallback_queries: string[];
  filters: SearchPlanFilters;
}

export interface NormalizedPost {
  author: string;
  authorHeadline: string;
  authorUrl: string;
  text: string;
  url: string;
  media: string[];
  timestamp: string | null;
  engagement: {
    reactions: number;
    comments: number;
    reposts: number;
  };
}

export interface ResearchJob {
  id: string;
  user_id: string;
  intent: string;
  status: JobStatus;
  search_plan: SearchPlan | null;
  posts: NormalizedPost[] | null;
  summary_markdown: string | null;
  slack_posted_at: string | null;
  error: string | null;
  linkdapi_calls_used: number;
  created_at: string;
  updated_at: string;
}
