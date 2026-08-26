export class ResourceNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message = 'NOT_FOUND') {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}
