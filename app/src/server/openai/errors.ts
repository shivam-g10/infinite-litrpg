export type OpenAIRuntimeErrorCode =
  | "COST_CAP_EXCEEDED"
  | "FAILED_RESPONSE"
  | "INCOMPLETE_RESPONSE"
  | "INVALID_MODEL"
  | "INVALID_OUTPUT"
  | "INVALID_POLICY"
  | "INVALID_USAGE"
  | "MISSING_USAGE"
  | "NARRATIVE_AUDIT_REJECTED"
  | "REFUSAL"
  | "RESPONSE_NOT_COMPLETED"
  | "TIMEOUT"
  | "TRANSPORT_ERROR";

export class OpenAIRuntimeError extends Error {
  readonly code: OpenAIRuntimeErrorCode;
  readonly retryable: boolean;

  constructor(
    code: OpenAIRuntimeErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenAIRuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function asRuntimeError(error: unknown): OpenAIRuntimeError {
  if (error instanceof OpenAIRuntimeError) return error;

  const status = getHttpStatus(error);
  const retryable =
    status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
  const message = error instanceof Error ? error.message : "OpenAI transport failed";
  return new OpenAIRuntimeError("TRANSPORT_ERROR", message, { cause: error, retryable });
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = error.status;
  return typeof status === "number" ? status : undefined;
}
