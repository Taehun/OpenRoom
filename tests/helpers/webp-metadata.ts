import { readFileSync } from "node:fs";

export interface WebpMetadata {
  width: number;
  height: number;
  hasAlpha: boolean;
  format: "VP8" | "VP8L" | "VP8X";
}

function invalidWebp(path: string, reason: string): never {
  throw new Error(`Invalid WebP ${path}: ${reason}`);
}

function readUint24LE(buffer: Buffer, offset: number) {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

export function readWebpMetadata(path: string): WebpMetadata {
  const buffer = readFileSync(path);
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return invalidWebp(path, "missing RIFF/WEBP signature");
  }

  const containerEnd = 8 + buffer.readUInt32LE(4);
  if (containerEnd > buffer.length) {
    return invalidWebp(path, "truncated RIFF container");
  }

  let offset = 12;
  let extended: Omit<WebpMetadata, "format"> | undefined;
  let image: WebpMetadata | undefined;

  while (offset < containerEnd) {
    if (offset + 8 > containerEnd) return invalidWebp(path, "truncated chunk header");

    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (dataEnd > containerEnd) return invalidWebp(path, `truncated ${type} chunk`);

    if (type === "VP8X") {
      if (length < 10) return invalidWebp(path, "truncated VP8X chunk");
      extended = {
        hasAlpha: (buffer[dataOffset]! & 0x10) !== 0,
        height: readUint24LE(buffer, dataOffset + 7) + 1,
        width: readUint24LE(buffer, dataOffset + 4) + 1,
      };
    } else if (type === "VP8 ") {
      if (length < 10) return invalidWebp(path, "truncated VP8 chunk");
      if (
        buffer[dataOffset + 3] !== 0x9d ||
        buffer[dataOffset + 4] !== 0x01 ||
        buffer[dataOffset + 5] !== 0x2a
      ) {
        return invalidWebp(path, "invalid VP8 frame header");
      }
      image = {
        format: "VP8",
        hasAlpha: false,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
      };
    } else if (type === "VP8L") {
      if (length < 5) return invalidWebp(path, "truncated VP8L chunk");
      if (buffer[dataOffset] !== 0x2f) return invalidWebp(path, "invalid VP8L signature");
      const packed = buffer.readUInt32LE(dataOffset + 1);
      image = {
        format: "VP8L",
        hasAlpha: ((packed >>> 28) & 1) === 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
        width: (packed & 0x3fff) + 1,
      };
    }

    offset = dataEnd + (length & 1);
    if (offset > containerEnd) return invalidWebp(path, `truncated ${type} padding`);
  }

  if (!image) return invalidWebp(path, "missing image chunk");
  const metadata = extended
    ? { ...extended, format: "VP8X" as const }
    : image;
  if (metadata.width === 0 || metadata.height === 0) {
    return invalidWebp(path, "zero dimensions");
  }
  return metadata;
}
