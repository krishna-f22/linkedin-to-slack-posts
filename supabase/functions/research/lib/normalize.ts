import type { LinkdApiPost, MediaItem, NormalizedPost } from "./types.ts";

/** Build a LinkedIn post URL from an activity/share URN. */
function urlFromUrn(urn: string): string {
  const match = urn.match(/urn:li:(?:activity|share|ugcPost):\d+/);
  if (match) return `https://www.linkedin.com/feed/update/${match[0]}`;
  return "";
}

/** Resolve the canonical post permalink: prefer postURL, else build from urn/postID. */
function extractPostUrl(raw: LinkdApiPost): string {
  if (typeof raw.postURL === "string" && raw.postURL.startsWith("http")) return raw.postURL;
  if (typeof raw.urn === "string") {
    const fromUrn = urlFromUrn(raw.urn);
    if (fromUrn) return fromUrn;
  }
  if (typeof raw.postID === "string" && /^\d{15,}$/.test(raw.postID)) {
    return `https://www.linkedin.com/feed/update/urn:li:activity:${raw.postID}`;
  }
  return "";
}

function classifyMediaType(type?: string): MediaItem["type"] {
  switch ((type ?? "").toLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "article":
      return "article";
    default:
      return "other";
  }
}

/** Map mediaContent[] (each { type, url }) into typed media items. */
function extractMedia(raw: LinkdApiPost): MediaItem[] {
  if (!Array.isArray(raw.mediaContent)) return [];
  const media: MediaItem[] = [];
  for (const item of raw.mediaContent) {
    if (item?.url && typeof item.url === "string" && item.url.startsWith("http")) {
      media.push({ type: classifyMediaType(item.type), url: item.url });
    }
  }
  return media;
}

/** postedAt is an object { timestamp, fullDate, relativeDay }; prefer fullDate. */
function extractTimestamp(raw: LinkdApiPost): string | null {
  const p = raw.postedAt;
  if (!p) return null;
  if (typeof p.fullDate === "string") return p.fullDate;
  if (typeof p.timestamp === "number") return new Date(p.timestamp).toISOString();
  if (typeof p.relativeDay === "string") return p.relativeDay;
  return null;
}

export function normalizePost(raw: LinkdApiPost): NormalizedPost {
  return {
    author: raw.author?.name ?? "Unknown",
    authorHeadline: raw.author?.headline ?? "",
    authorUrl: raw.author?.url ?? "",
    authorImage: raw.author?.profilePictureURL ?? "",
    text: raw.text ?? "",
    url: extractPostUrl(raw),
    media: extractMedia(raw),
    timestamp: extractTimestamp(raw),
    engagement: {
      reactions: raw.engagements?.totalReactions ?? 0,
      comments: raw.engagements?.commentsCount ?? 0,
      reposts: raw.engagements?.repostsCount ?? 0,
    },
  };
}

/** Dedupe normalized posts by URL (falling back to author+text for posts without a URL). */
export function dedupePosts(posts: NormalizedPost[]): NormalizedPost[] {
  const seen = new Set<string>();
  const result: NormalizedPost[] = [];

  for (const post of posts) {
    const key = post.url || `${post.author}::${post.text.slice(0, 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(post);
  }

  return result;
}
