export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  retryableStatuses?: number[];
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * Fetch with exponential backoff on retryable HTTP statuses or network errors.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const retryableStatuses = options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!retryableStatuses.includes(response.status) || attempt === retries) {
        return response;
      }
      lastError = new Error(`Retryable status ${response.status} from ${url}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }

    const delay = baseDelayMs * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}
