type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, jobId: string, step: string, message: string, extra?: Record<string, unknown>) {
  const entry = {
    level,
    job_id: jobId,
    step,
    message,
    ...extra,
    ts: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(jobId: string) {
  return {
    info: (step: string, message: string, extra?: Record<string, unknown>) =>
      log("info", jobId, step, message, extra),
    warn: (step: string, message: string, extra?: Record<string, unknown>) =>
      log("warn", jobId, step, message, extra),
    error: (step: string, message: string, extra?: Record<string, unknown>) =>
      log("error", jobId, step, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
