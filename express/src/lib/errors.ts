/**
 * error แบบเดียวกับที่ Laravel ส่ง (frontend ใช้ status + errors.<field>[0])
 *   401 {"message":"Unauthenticated."}
 *   403 {"message":"This action is unauthorized."}
 *   404 {"message":"Not Found"}
 *   422 {"message":"...","errors":{"field":["..."]}}
 *   429 {"message":"Too Many Attempts."}
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export class ValidationError extends HttpError {
  constructor(public errors: Record<string, string[]>) {
    super(422, ValidationError.summary(errors));
  }

  /** "ข้อความแรก (and N more errors)" เหมือน ValidationException::summarize */
  static summary(errors: Record<string, string[]>): string {
    const all = Object.values(errors).flat();
    const first = all[0] ?? "The given data was invalid.";
    const more = all.length - 1;
    return more > 0 ? `${first} (and ${more} more ${more === 1 ? "error" : "errors"})` : first;
  }

  /** ValidationException::withMessages(['field' => 'msg']) */
  static withMessages(messages: Record<string, string | string[]>): ValidationError {
    return new ValidationError(Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])));
  }
}

export const unauthenticated = () => new HttpError(401, "Unauthenticated.");
export const forbidden = () => new HttpError(403, "This action is unauthorized.");
export const notFound = () => new HttpError(404, "Not Found");

/** abort_unless(cond, 403) */
export function authorize(condition: boolean): asserts condition {
  if (!condition) throw forbidden();
}
