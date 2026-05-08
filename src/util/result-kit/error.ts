/**
 * Structured application error shape used throughout the package.
 *
 * `TypedError` gives failures a stable string discriminator through `type`
 * while preserving a human-readable `message` and optional machine-readable
 * metadata.
 */
export interface TypedError<TType extends string = string> {
  /**
   * Stable error discriminator used for narrowing, branching, and mapping.
   */
  readonly type: TType;

  /**
   * Human-readable description of the failure.
   */
  readonly message: string;

  /**
   * Optional serializable metadata describing the failure context.
   */
  readonly details?: Record<string, unknown>;

  /**
   * Optional original cause for debugging or tracing.
   */
  readonly cause?: unknown;
}

/**
 * Alias that makes it explicit that a typed error is constrained to one
 * concrete discriminator.
 */
export type TypedErrorOf<TType extends string> = TypedError<TType>;

/**
 * Produces a union of {@link TypedError} variants from a union of string
 * discriminators.
 *
 * This is useful for defining domain-specific error unions such as
 * `"not_found" | "validation_error"`.
 */
export type TypedErrorUnion<TType extends string> = TType extends string
  ? TypedError<TType>
  : never;

/**
 * Determines whether an unknown value satisfies the runtime contract of
 * {@link TypedError}.
 *
 * A valid typed error must be an object with string `type` and `message`
 * fields. When present, `details` must be a plain object-like record rather
 * than `null` or an array.
 *
 * @param error Value to validate at runtime.
 * @returns `true` when `error` matches the expected structured error shape.
 */
export const isTypedError = (error: unknown): error is TypedError<string> => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    type?: unknown;
    message?: unknown;
    details?: unknown;
  };

  if (
    typeof candidate.type !== 'string' ||
    typeof candidate.message !== 'string'
  ) {
    return false;
  }

  if (
    'details' in candidate &&
    candidate.details !== undefined &&
    (candidate.details === null ||
      typeof candidate.details !== 'object' ||
      Array.isArray(candidate.details))
  ) {
    return false;
  }

  return true;
};
