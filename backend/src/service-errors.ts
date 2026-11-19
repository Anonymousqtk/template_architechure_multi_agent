// Only stable PostgreSQL/connection codes; never serialize raw provider errors.
export function serviceErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = error.code;
  if (code === '42P01' || code === '42703') return 'SERVICE_NOT_READY';
  if (typeof code === 'string' && (code.startsWith('08') ||
      ['57P01', '57P02', '57P03', '53300', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code))) return 'SERVICE_UNAVAILABLE';
  return null;
}
