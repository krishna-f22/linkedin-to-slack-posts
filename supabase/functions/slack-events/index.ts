import { config } from "../research/lib/config.ts";
import { createJob } from "../research/lib/jobStore.ts";
import { runPipeline } from "../research/lib/pipeline.ts";
import { postAck, postMessageToChannel, postText } from "../research/lib/slack.ts";

const DEFAULT_POST_LIMIT = 10;
const MAX_TIMESTAMP_SKEW_SEC = 60 * 5; // reject replays older than 5 minutes

const encoder = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time hex string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify Slack's v0 request signature (HMAC-SHA256 over `v0:ts:body`). */
async function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): Promise<boolean> {
  if (!timestamp || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_SKEW_SEC) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.slackSigningSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${rawBody}`));
  return timingSafeEqual(`v0=${toHex(mac)}`, signature);
}

/** Strip the leading bot mention (`<@U123>`) and trim → the user's intent. */
function extractIntent(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\s+/g, " ").trim();
}

interface SlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

/** Run the research pipeline for one Slack event and reply where it came from. */
async function handleEvent(event: SlackEvent): Promise<void> {
  const channel = event.channel;
  if (!channel) return;

  const intent = extractIntent(event.text ?? "");
  if (!intent) {
    await postAck(channel, "Tell me what to search, e.g. *posts where AI engineers are hiring in India* 🔎", {
      thread_ts: event.thread_ts ?? event.ts,
    });
    return;
  }

  // app_mention → reply in a thread; DM → reply inline (no thread).
  const threadTs = event.type === "app_mention" ? event.thread_ts ?? event.ts : undefined;

  const jobId = await createJob(intent, {
    source: "slack",
    userId: null,
    slackChannel: channel,
    slackUser: event.user,
    slackThreadTs: threadTs,
  });

  await postAck(channel, "Searching LinkedIn… 🔎", { thread_ts: threadTs }).catch(() => {});

  await runPipeline(
    jobId,
    intent,
    DEFAULT_POST_LIMIT,
    {},
    (i, summaries, posts) =>
      postMessageToChannel(channel, i, summaries, posts, { thread_ts: threadTs }),
    (msg) => postText(channel, msg, { thread_ts: threadTs })
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();

  // Security gate: reject anything not signed by Slack.
  const valid = await verifySlackSignature(
    rawBody,
    req.headers.get("X-Slack-Request-Timestamp"),
    req.headers.get("X-Slack-Signature")
  );
  if (!valid) {
    return json({ error: "invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody) as {
    type?: string;
    challenge?: string;
    event?: SlackEvent;
  };

  // One-time URL verification handshake when wiring the Slack app.
  if (body.type === "url_verification") {
    return json({ challenge: body.challenge });
  }

  // Slack retries on no-ack; ack and skip so we never double-post.
  if (req.headers.get("X-Slack-Retry-Num")) {
    return json({ ok: true });
  }

  const event = body.event;
  const isMention = event?.type === "app_mention";
  const isDirectMessage = event?.type === "message" && event.channel_type === "im";

  // Ignore our own messages / system subtypes to avoid loops.
  const isEcho = Boolean(event?.bot_id) || Boolean(event?.subtype);

  if ((isMention || isDirectMessage) && !isEcho && event) {
    // Ack Slack within 3s; run the pipeline in the background.
    // @ts-expect-error EdgeRuntime is a global provided by the Supabase Edge Runtime
    EdgeRuntime.waitUntil(
      handleEvent(event).catch((err) => console.error("slack-events handler failed:", err))
    );
  }

  return json({ ok: true });
});
