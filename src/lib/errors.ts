/** Application error codes (event.md §10.1). Route handlers map them to HTTP status codes. */
export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "invalid_transition"
  | "conflict"
  | "capacity_full"
  | "rate_limited"
  | "not_configured"
  | "ai_unavailable"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  invalid_transition: 409,
  conflict: 409,
  capacity_full: 409,
  rate_limited: 429,
  not_configured: 503,
  ai_unavailable: 503,
  internal: 500,
};

interface PgLikeError {
  code?: string;
  message?: string;
}

/**
 * Maps a PostgREST/Postgres error to an AppError. The raw message is kept server-side in `details`
 * and never shown to users. SQLSTATEs match the RAISE statements in supabase/migrations.
 */
export function fromDbError(error: PgLikeError): AppError {
  const msg = error.message ?? "";
  switch (error.code) {
    case "28000":
      return new AppError("unauthenticated", "Please sign in again.", msg);
    case "42501":
      return new AppError("forbidden", "You don't have permission to do that.", msg);
    case "P0002":
    case "PGRST116":
      return new AppError("not_found", "That item doesn't exist or isn't visible to you.", msg);
    case "22023":
    case "22P02":
      return new AppError("validation_failed", "Some of the information isn't valid.", msg);
    case "23505":
      return new AppError("conflict", "That already exists.", msg);
    case "23514":
      return msg.startsWith("invalid_transition")
        ? new AppError("invalid_transition", "That status change isn't allowed.", msg)
        : new AppError("validation_failed", "Some of the information isn't valid.", msg);
    default:
      return new AppError("internal", "Something went wrong. Please try again.", msg);
  }
}
