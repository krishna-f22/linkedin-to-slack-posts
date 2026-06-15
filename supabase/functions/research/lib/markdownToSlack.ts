/**
 * Converts a constrained subset of Markdown (as produced by the summarizer prompt)
 * into Slack's mrkdwn format.
 *
 * Handled: ## headers -> bold, **bold** -> *bold*, [text](url) -> <url|text>,
 * bullet lists (- / *) passed through (Slack renders these natively).
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  let text = markdown;

  // Headers (##, ###, etc.) -> bold line
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");

  // Links [text](url) -> <url|text>
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");

  // Bold **text** -> *text* (do after links so URLs aren't mangled)
  text = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  return text.trim();
}
