import { config } from "./config.ts";
import { fetchWithRetry } from "./retry.ts";
import type { MediaItem, NormalizedPost, PostSummary } from "./types.ts";

const SECTION_TEXT_LIMIT = 2900;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "…";
}

function firstImage(media: MediaItem[]): string | undefined {
  return media.find((m) => m.type === "image")?.url;
}

function videoUrls(media: MediaItem[]): string[] {
  return media.filter((m) => m.type === "video").map((m) => m.url);
}

/** Escape characters that are special in Slack mrkdwn link/text context. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Build Slack Block Kit blocks. One card per post:
 * summary text + post link + (inline image / video link if present).
 */
export function buildSlackBlocks(
  intent: string,
  summaries: PostSummary[],
  posts: NormalizedPost[]
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🔎 LinkedIn Research", emoji: true },
  });

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Intent:* ${escapeMrkdwn(truncate(intent, 400))}` },
    ],
  });

  blocks.push({ type: "divider" });

  let shown = 0;
  for (const s of summaries) {
    const post = posts[s.index];
    if (!post) continue;

    const lines: string[] = [];
    lines.push(`*${shown + 1}.* ${escapeMrkdwn(s.summary)}`);
    lines.push(`_Relevance: ${s.relevance}/100_`);
    if (post.url) lines.push(`🔗 <${post.url}|View original post>`);
    for (const v of videoUrls(post.media)) lines.push(`🎥 <${v}|Watch video>`);

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncate(lines.join("\n"), SECTION_TEXT_LIMIT) },
    });

    const image = firstImage(post.media);
    if (image) {
      blocks.push({
        type: "image",
        image_url: image,
        alt_text: "post image",
      });
    }

    blocks.push({ type: "divider" });
    shown++;
  }

  // Slack caps a message at 50 blocks.
  return blocks.slice(0, 50);
}

/** Plain-text fallback (shown in notifications and clients that ignore blocks). */
function buildFallbackText(intent: string, summaries: PostSummary[]): string {
  return truncate(`LinkedIn Research — ${intent} (${summaries.length} posts)`, 2900);
}

export async function postSummaryToSlack(
  intent: string,
  summaries: PostSummary[],
  posts: NormalizedPost[]
): Promise<void> {
  const blocks = buildSlackBlocks(intent, summaries, posts);
  const text = buildFallbackText(intent, summaries);

  const response = await fetchWithRetry(
    config.slackWebhookUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
    },
    { retries: 1 }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook error ${response.status}: ${body}`);
  }
}

/** Render to Markdown for DB storage / web UI display. */
export function summaryToMarkdown(
  summaries: PostSummary[],
  posts: NormalizedPost[]
): string {
  const parts: string[] = [];
  let n = 0;
  for (const s of summaries) {
    const post = posts[s.index];
    if (!post) continue;
    n++;
    const link = post.url ? ` [View post](${post.url})` : "";
    let block = `**${n}.** ${s.summary} _(relevance: ${s.relevance}/100)_${link}`;
    const image = firstImage(post.media);
    if (image) block += `\n\n![image](${image})`;
    for (const v of videoUrls(post.media)) block += `\n\n[🎥 Watch video](${v})`;
    parts.push(block);
  }
  return parts.join("\n\n");
}
