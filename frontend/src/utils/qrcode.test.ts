import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
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
    expect(path).toContain('M4,4h1v1h-1z');
  });

  it('decodes the local employee-card URL from the generated QR modules', () => {
    const url = 'http://localhost:3000/employee-card#org=12345678-1234-1234-1234-123456789abc&code=EMP-ENG-999';
    const matrix = createQrMatrix(url, 'M');
    const quietZone = 4;
    const totalModules = matrix.length + quietZone * 2;
    const dimension = 182;
    const pixels = new Uint8ClampedArray(dimension * dimension * 4).fill(255);

    for (let py = 0; py < dimension; py++) {
      const y = Math.floor((py * totalModules) / dimension) - quietZone;
      for (let px = 0; px < dimension; px++) {
        const x = Math.floor((px * totalModules) / dimension) - quietZone;
        if (x < 0 || x >= matrix.length || y < 0 || y >= matrix.length || !matrix[y][x]) continue;
        const offset = (py * dimension + px) * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
      }
    }

    expect(jsQR(pixels, dimension, dimension, { inversionAttempts: 'dontInvert' })?.data).toBe(url);
  });

  it.each([
    { version: 7, length: 110, word: 0x07c94 },
    { version: 8, length: 125, word: 0x085bc },
    { version: 9, length: 155, word: 0x09a99 },
    { version: 10, length: 183, word: 0x0a4d3 },
  ])('places the version $version information in both reserved areas', ({ version, length, word }) => {
    const matrix = createQrMatrix('A'.repeat(length), 'M');
    expect(matrix).toHaveLength(version * 4 + 17);
    for (let i = 0; i < 18; i++) {
      const bit = ((word >>> i) & 1) === 1;
      const x = matrix.length - 11 + (i % 3);
      const y = Math.floor(i / 3);
      expect(matrix[y][x]).toBe(bit);
      expect(matrix[x][y]).toBe(bit);
    }
  });

  it('throws error when data exceeds supported length', () => {
    const huge = 'A'.repeat(500);
    expect(() => createQrMatrix(huge)).toThrow('Data too long');
  });
});
