/**
 * Minimal reader for HydraTec's .HVUF export format.
 *
 * A .HVUF file is an LHA/LZH archive. HydraTec stores each printed page as an
 * uncompressed (`-lh0-`) entry named `Pg{N}.emf` (a Windows Enhanced Metafile),
 * plus a `VPHeader.$$$` entry (compressed `-lh5-`, print-job metadata only —
 * not needed here). Because every page entry is stored rather than
 * LZSS-compressed, no decompression is required: this reader walks the LHA
 * level-0/level-1 headers and returns the raw bytes for each `-lh0-` entry.
 *
 * If a future export ever stores a page with a compressed method, this
 * throws rather than silently returning wrong bytes.
 */

export type HvufEntry = {
  name: string;
  bytes: Buffer;
};

const STORED_METHOD = '-lh0-';

export function unpackHvufArchive(buffer: Buffer): HvufEntry[] {
  const entries: HvufEntry[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerSize = buffer[offset];
    if (!headerSize) break;
    if (offset + 22 > buffer.length) break;

    const method = buffer.toString('ascii', offset + 2, offset + 7);
    const packedSize = buffer.readUInt32LE(offset + 7);
    const nameLen = buffer[offset + 21];
    const name = buffer.toString('ascii', offset + 22, offset + 22 + nameLen);
    const dataStart = offset + 2 + headerSize;

    if (dataStart + packedSize > buffer.length) {
      throw new Error(`Malformed .HVUF archive: entry "${name}" overruns the file.`);
    }

    if (method === STORED_METHOD) {
      entries.push({ name, bytes: buffer.subarray(dataStart, dataStart + packedSize) });
    } else if (/^Pg\{\d+\}\.emf$/i.test(name)) {
      throw new Error(
        `.HVUF page entry "${name}" uses unsupported compression method "${method}" (expected ${STORED_METHOD}).`,
      );
    }

    offset = dataStart + packedSize;
  }

  return entries;
}

export function unpackHvufPages(buffer: Buffer): Buffer[] {
  const entries = unpackHvufArchive(buffer);
  return entries
    .filter((entry) => /^Pg\{\d+\}\.emf$/i.test(entry.name))
    .sort((a, b) => {
      const an = Number(a.name.match(/\{(\d+)\}/)?.[1] || 0);
      const bn = Number(b.name.match(/\{(\d+)\}/)?.[1] || 0);
      return an - bn;
    })
    .map((entry) => entry.bytes);
}
