/**
 * Compact, self-contained QR Code Generator in pure TypeScript.
 * Model 2, Byte encoding mode, Error Correction Level L and M, Versions 1-10.
 * Zero external dependencies.
 */

// Galois Field GF(256) arithmetic
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x >= 256) {
      x ^= 0x11d; // Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
    }
  }
})();

function gMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

// Compute generator polynomial for given error correction count
function rsGeneratorPoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const factor = new Uint8Array([1, EXP_TABLE[i]]);
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      for (let k = 0; k < 2; k++) {
        next[j + k] ^= gMul(poly[j], factor[k]);
      }
    }
    poly = next;
  }
  return poly;
}

// Compute Reed-Solomon error correction codewords
function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data, 0);

  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Version table for Level L & M (Versions 1-10)
// [totalCodewords, dataCodewordsL, ecPerBlockL, numBlocksL, dataCodewordsM, ecPerBlockM, numBlocksM]
interface VersionSpec {
  version: number;
  totalCodewords: number;
  L: { dataCodewords: number; ecPerBlock: number; blocks: [number, number][] };
  M: { dataCodewords: number; ecPerBlock: number; blocks: [number, number][] };
  alignments: number[];
}

const VERSIONS: VersionSpec[] = [
  {
    version: 1,
    totalCodewords: 26,
    L: { dataCodewords: 19, ecPerBlock: 7, blocks: [[1, 19]] },
    M: { dataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]] },
    alignments: [],
  },
  {
    version: 2,
    totalCodewords: 44,
    L: { dataCodewords: 34, ecPerBlock: 10, blocks: [[1, 34]] },
    M: { dataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]] },
    alignments: [6, 18],
  },
  {
    version: 3,
    totalCodewords: 70,
    L: { dataCodewords: 55, ecPerBlock: 15, blocks: [[1, 55]] },
    M: { dataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]] },
    alignments: [6, 22],
  },
  {
    version: 4,
    totalCodewords: 100,
    L: { dataCodewords: 80, ecPerBlock: 20, blocks: [[1, 80]] },
    M: { dataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]] },
    alignments: [6, 26],
  },
  {
    version: 5,
    totalCodewords: 134,
    L: { dataCodewords: 108, ecPerBlock: 26, blocks: [[1, 108]] },
    M: { dataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]] },
    alignments: [6, 30],
  },
  {
    version: 6,
    totalCodewords: 172,
    L: { dataCodewords: 136, ecPerBlock: 18, blocks: [[2, 68]] },
    M: { dataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]] },
    alignments: [6, 34],
  },
  {
    version: 7,
    totalCodewords: 196,
    L: { dataCodewords: 156, ecPerBlock: 20, blocks: [[2, 78]] },
    M: { dataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]] },
    alignments: [6, 22, 38],
  },
  {
    version: 8,
    totalCodewords: 242,
    L: { dataCodewords: 194, ecPerBlock: 24, blocks: [[2, 97]] },
    M: { dataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },
    alignments: [6, 24, 42],
  },
  {
    version: 9,
    totalCodewords: 292,
    L: { dataCodewords: 232, ecPerBlock: 30, blocks: [[2, 116]] },
    M: { dataCodewords: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },
    alignments: [6, 26, 46],
  },
  {
    version: 10,
    totalCodewords: 346,
    L: { dataCodewords: 274, ecPerBlock: 18, blocks: [[2, 68], [2, 69]] },
    M: { dataCodewords: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] },
    alignments: [6, 28, 50],
  },
];

class BitBuffer {
  buffer: number[] = [];
  length = 0;

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

export type EccLevel = 'L' | 'M';

export function createQrMatrix(text: string, eccLevel: EccLevel = 'M'): boolean[][] {
  const utf8Bytes = new TextEncoder().encode(text);

  // Find minimum version that fits data
  let selectedSpec: VersionSpec | null = null;
  for (const spec of VERSIONS) {
    const maxData = eccLevel === 'L' ? spec.L.dataCodewords : spec.M.dataCodewords;
    // 4 bits mode + 8 or 16 bits count + data
    const charCountBits = spec.version < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + utf8Bytes.length * 8;
    if (Math.ceil(requiredBits / 8) <= maxData) {
      selectedSpec = spec;
      break;
    }
  }

  if (!selectedSpec) {
    throw new Error('Data too long for QR versions 1-10');
  }

  const ecConfig = eccLevel === 'L' ? selectedSpec.L : selectedSpec.M;
  const totalDataBytes = ecConfig.dataCodewords;
  const charCountBits = selectedSpec.version < 10 ? 8 : 16;

  // Build bit stream
  const bb = new BitBuffer();
  bb.put(0x04, 4); // Byte mode indicator: 0100
  bb.put(utf8Bytes.length, charCountBits);
  for (const b of utf8Bytes) {
    bb.put(b, 8);
  }

  // Terminator (up to 4 zeroes)
  const remainingBits = totalDataBytes * 8 - bb.length;
  bb.put(0, Math.min(4, Math.max(0, remainingBits)));

  // Pad to byte boundary
  while (bb.length % 8 !== 0) {
    bb.putBit(false);
  }

  // Pad codewords (alternating 0xEC and 0x11)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < totalDataBytes * 8) {
    bb.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Split into blocks and compute Reed-Solomon EC
  const dataBytes = new Uint8Array(bb.buffer.slice(0, totalDataBytes));
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (const [numBlocks, blockSize] of ecConfig.blocks) {
    for (let i = 0; i < numBlocks; i++) {
      const slice = dataBytes.slice(offset, offset + blockSize);
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, ecConfig.ecPerBlock));
      offset += blockSize;
    }
  }

  // Interleave data codewords
  const finalCodewords: number[] = [];
  let maxDataBlockLen = 0;
  for (const b of dataBlocks) maxDataBlockLen = Math.max(maxDataBlockLen, b.length);
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (const b of dataBlocks) {
      if (i < b.length) finalCodewords.push(b[i]);
    }
  }

  // Interleave EC codewords
  let maxEcBlockLen = 0;
  for (const b of ecBlocks) maxEcBlockLen = Math.max(maxEcBlockLen, b.length);
  for (let i = 0; i < maxEcBlockLen; i++) {
    for (const b of ecBlocks) {
      if (i < b.length) finalCodewords.push(b[i]);
    }
  }

  // Matrix generation
  const size = selectedSpec.version * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );

  // 1. Finder patterns at top-left, top-right, bottom-left
  function placeFinder(startX: number, startY: number) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = startX + x;
        const py = startY + y;
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        if (
          (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
          (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
          (x >= 2 && x <= 4 && y >= 2 && y <= 4)
        ) {
          matrix[py][px] = true;
        } else {
          matrix[py][px] = false;
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(size - 7, 0);
  placeFinder(0, size - 7);

  // 2. Alignment patterns
  const aligns = selectedSpec.alignments;
  for (let i = 0; i < aligns.length; i++) {
    for (let j = 0; j < aligns.length; j++) {
      const cx = aligns[i];
      const cy = aligns[j];
      if (matrix[cy][cx] !== null) continue; // Skip finders
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          if (
            Math.abs(x) === 2 ||
            Math.abs(y) === 2 ||
            (x === 0 && y === 0)
          ) {
            matrix[cy + y][cx + x] = true;
          } else {
            matrix[cy + y][cx + x] = false;
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // 4. Dark module and reserved format areas
  matrix[4 * selectedSpec.version + 9][8] = true;

  // Reserve format info modules
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }

  // Place data bits in zig-zag
  const allBits: boolean[] = [];
  for (const b of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      allBits.push(((b >>> i) & 1) === 1);
    }
  }

  let bitIndex = 0;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const upward = ((right + 1) / 2) % 2 === 1;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let x = right; x >= right - 1; x--) {
        if (matrix[y][x] === null) {
          matrix[y][x] = bitIndex < allBits.length ? allBits[bitIndex++] : false;
        }
      }
    }
  }

  // Format info BCH (15, 5) code calculation
  // ECC L = 01 (1), M = 00 (0)
  const eccBits = eccLevel === 'L' ? 1 : 0;
  const mask = 0; // Standard Mask 0: (r + c) % 2 === 0

  // Apply mask 0 to non-function modules
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Check if function module
      if (isFunctionModule(x, y, size, aligns)) continue;
      if ((x + y) % 2 === 0) {
        matrix[y][x] = !matrix[y][x];
      }
    }
  }

  // Format information bits
  const formatData = (eccBits << 3) | mask;
  let rem = formatData << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem & (1 << (i + 10))) !== 0) {
      rem ^= 0x537 << i; // Generator polynomial G(x) = x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
    }
  }
  const formatWord = ((formatData << 10) | rem) ^ 0x5412; // Mask 101010000010010

  // Place format info
  for (let i = 0; i < 15; i++) {
    const bit = ((formatWord >>> i) & 1) === 1;
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else matrix[size - 15 + i][8] = bit;

    if (i < 8) matrix[8][size - i - 1] = bit;
    else if (i < 9) matrix[8][15 - i] = bit;
    else matrix[8][14 - i] = bit;
  }

  return matrix.map(row => row.map(cell => Boolean(cell)));
}

function isFunctionModule(x: number, y: number, size: number, aligns: number[]): boolean {
  // Finders + separators
  if (x <= 8 && y <= 8) return true;
  if (x >= size - 9 && y <= 8) return true;
  if (x <= 8 && y >= size - 9) return true;
  // Timing
  if (x === 6 || y === 6) return true;
  // Dark module
  if (x === 8 && y === size - 8) return true;
  // Alignment patterns
  for (const ax of aligns) {
    for (const ay of aligns) {
      if ((ax <= 8 && ay <= 8) || (ax >= size - 8 && ay <= 8) || (ax <= 8 && ay >= size - 8)) {
        continue;
      }
      if (Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
    }
  }
  return false;
}

export function generateQrSvgPath(matrix: boolean[][]): string {
  const size = matrix.length;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) {
        path += `M${x},${y}h1v1h-1z `;
      }
    }
  }
  return path.trim();
}
