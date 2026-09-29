export class AppError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(code: string, message: string, statusCode = 400) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super('quota_exceeded', message, 429)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('not_found', message, 404)
  }
}

export class NotImplementedError extends AppError {
  constructor(message: string) {
    super('not_implemented', message, 501)
  }
}
