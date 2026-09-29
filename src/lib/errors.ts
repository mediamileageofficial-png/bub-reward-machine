/** Typed application error carrying an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Sign in required") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have access to this resource") => new AppError(403, "FORBIDDEN", message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
export const tooMany = (message = "Too many requests. Please wait a moment and try again.", retryAfter?: number) =>
  new AppError(429, "RATE_LIMITED", message, retryAfter ? { retry_after_seconds: retryAfter } : undefined);

/** Raised by repositories when a conditional write loses (DynamoDB ConditionalCheckFailed / TransactionCanceled). */
export class ConditionFailedError extends Error {
  constructor(public readonly reason: string, public readonly reasons: string[] = []) {
    super(`Condition failed: ${reason}`);
    this.name = "ConditionFailedError";
  }
}
