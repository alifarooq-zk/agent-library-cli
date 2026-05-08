/**
 * Represents the successful branch of a {@link Result}.
 *
 * Use this shape when an operation completed normally and produced a value
 * that should continue through the rest of the pipeline.
 */
export interface Success<T> {
  /**
   * Discriminant used to identify successful results at runtime.
   */
  readonly ok: true;

  /**
   * Value produced by the successful operation.
   */
  readonly value: T;
}

/**
 * Represents the failed branch of a {@link Result}.
 *
 * Use this shape when an operation did not produce a value and instead
 * returned domain, validation, transport, or infrastructure error data.
 */
export interface Failure<E> {
  /**
   * Discriminant used to identify failed results at runtime.
   */
  readonly ok: false;

  /**
   * Error payload carried by the failed operation.
   */
  readonly error: E;
}

/**
 * Models an operation that can either succeed with a value of `T`
 * or fail with an error of `E`.
 *
 * This is the package's core transport type for explicit, exception-free
 * control flow.
 */
export type Result<T, E> = Success<T> | Failure<E>;
