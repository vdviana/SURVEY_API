export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message?: string, details?: unknown) {
    super(message ?? code);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(code: string, details?: unknown): HttpError {
  return new HttpError(400, code, code, details);
}

export function unauthorized(code = 'unauthorized'): HttpError {
  return new HttpError(401, code);
}

export function forbidden(code = 'forbidden'): HttpError {
  return new HttpError(403, code);
}

export function notFound(code = 'not_found'): HttpError {
  return new HttpError(404, code);
}

export function conflict(code: string, details?: unknown): HttpError {
  return new HttpError(409, code, code, details);
}
