import { describe, it, expect } from 'vitest';
import { createQrMatrix, generateQrSvgPath } from './qrcode';

describe('QR Code Generator', () => {
  it('creates valid square matrix for short URL', () => {
    const matrix = createQrMatrix('https://example.com/p/EMP-001');
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);
    // Finders check
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
  });

  it('creates valid matrix for long URL with parameters', () => {
    const url = 'https://managerhr.local/employee-card?org=12345678-1234-1234-1234-123456789abc&code=EMP-ENG-999';
    const matrix = createQrMatrix(url, 'M');
    expect(matrix.length).toBeGreaterThan(25);
    const path = generateQrSvgPath(matrix);
    expect(path).toContain('M0,0h1v1h-1z');
  });

  it('throws error when data exceeds supported length', () => {
    const huge = 'A'.repeat(500);
    expect(() => createQrMatrix(huge)).toThrow('Data too long');
  });
});
