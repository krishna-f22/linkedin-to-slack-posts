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

export interface MediaItem {
  type: "image" | "video" | "article" | "other";
  url: string;
}

export interface NormalizedPost {
  author: string;
  authorHeadline: string;
  authorUrl: string;
  authorImage: string;
  text: string;
  url: string;
  media: MediaItem[];
  timestamp: string | null;
  engagement: {
    reactions: number;
    comments: number;
    reposts: number;
  };
}

export interface PostSummary {
  index: number;
  summary: string;
  relevance: number;
}

// Raw shapes returned by LinkdAPI (best-effort; API does not publish a strict schema)
// Actual shape returned by LinkdAPI /api/v1/search/posts
export interface LinkdApiPost {
  urn?: string;
  postID?: string;
  postURL?: string;
  text?: string;
  author?: {
    name?: string;
    headline?: string;
    urn?: string;
    id?: string;
    url?: string;
    profilePictureURL?: string;
  };
  postedAt?: {
    timestamp?: number;
    fullDate?: string;
    relativeDay?: string;
  };
  engagements?: {
    totalReactions?: number;
    commentsCount?: number;
    repostsCount?: number;
  };
  mediaContent?: Array<{ type?: string; url?: string }>;
}

export interface LinkdApiSearchData {
  posts: LinkdApiPost[];
  total: number;
  start: number;
  count: number;
  hasMore: boolean;
}

export interface LinkdApiResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: LinkdApiSearchData | null;
}

export interface LinkdApiSearchParams {
  keyword: string;
  start: number;
  authorJobTitle?: string;
  datePosted?: string;
  contentType?: string;
  sortBy?: string;
}
