// Minimal stored (uncompressed) ZIP writer used for Design Department
// drawing packages. Stored entries avoid adding a runtime dependency while
// preserving PDFs/CAD/ZIP payloads exactly. ZIP64 is deliberately rejected:
// package sizes in this ERP are bounded by the per-file upload controls, and a
// clear error is safer than silently producing a malformed archive.

export interface StoredZipEntry {
  name: string;
  data: Uint8Array;
  modified?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeZipEntryName(value: string, fallback = "file"): string {
  const cleaned = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\//, "")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part
      .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
      .trim()
      .slice(0, 120))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .slice(0, 240);
  return cleaned || fallback;
}

export function uniqueZipEntryName(value: string, used: Set<string>, fallback = "file"): string {
  const first = safeZipEntryName(value, fallback);
  let candidate = first;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const slash = first.lastIndexOf("/");
    const directory = slash >= 0 ? first.slice(0, slash + 1) : "";
    const filename = slash >= 0 ? first.slice(slash + 1) : first;
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    candidate = `${directory}${stem} (${suffix})${extension}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function dosDateTime(input: Date | undefined): { time: number; date: number } {
  const date = input && Number.isFinite(input.getTime()) ? input : new Date();
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosTime = (
    (date.getHours() << 11)
    | (date.getMinutes() << 5)
    | Math.floor(date.getSeconds() / 2)
  ) & 0xffff;
  const dosDate = (
    ((year - 1980) << 9)
    | ((date.getMonth() + 1) << 5)
    | date.getDate()
  ) & 0xffff;
  return { time: dosTime, date: dosDate };
}

interface PreparedEntry {
  name: string;
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
  time: number;
  date: number;
}

export function createStoredZip(entries: readonly StoredZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error("Too many files for one ZIP package.");
  const encoder = new TextEncoder();
  const used = new Set<string>();
  const prepared: PreparedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = uniqueZipEntryName(entry.name, used);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error("A ZIP entry name is too long.");
    if (entry.data.length > 0xffffffff) throw new Error("A file is too large for this ZIP package.");
    const stamp = dosDateTime(entry.modified);
    prepared.push({
      name,
      nameBytes,
      data: entry.data,
      crc: crc32(entry.data),
      offset,
      time: stamp.time,
      date: stamp.date,
    });
    offset += 30 + nameBytes.length + entry.data.length;
    if (offset > 0xffffffff) throw new Error("The ZIP package is too large; download the files individually.");
  }

  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);
  const totalSize = offset + centralSize + 22;
  if (totalSize > 0xffffffff) throw new Error("The ZIP package is too large; download the files individually.");
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let cursor = 0;

  for (const entry of prepared) {
    view.setUint32(cursor, 0x04034b50, true); cursor += 4;
    view.setUint16(cursor, 20, true); cursor += 2;
    view.setUint16(cursor, 0x0800, true); cursor += 2;
    view.setUint16(cursor, 0, true); cursor += 2;
    view.setUint16(cursor, entry.time, true); cursor += 2;
    view.setUint16(cursor, entry.date, true); cursor += 2;
    view.setUint32(cursor, entry.crc, true); cursor += 4;
    view.setUint32(cursor, entry.data.length, true); cursor += 4;
    view.setUint32(cursor, entry.data.length, true); cursor += 4;
    view.setUint16(cursor, entry.nameBytes.length, true); cursor += 2;
    view.setUint16(cursor, 0, true); cursor += 2;
    out.set(entry.nameBytes, cursor); cursor += entry.nameBytes.length;
    out.set(entry.data, cursor); cursor += entry.data.length;
  }

  const centralOffset = cursor;
  for (const entry of prepared) {
    view.setUint32(cursor, 0x02014b50, true); cursor += 4;
    view.setUint16(cursor, 20, true); cursor += 2;
    view.setUint16(cursor, 20, true); cursor += 2;
    view.setUint16(cursor, 0x0800, true); cursor += 2;
    view.setUint16(cursor, 0, true); cursor += 2;
    view.setUint16(cursor, entry.time, true); cursor += 2;
    view.setUint16(cursor, entry.date, true); cursor += 2;
    view.setUint32(cursor, entry.crc, true); cursor += 4;
    view.setUint32(cursor, entry.data.length, true); cursor += 4;
    view.setUint32(cursor, entry.data.length, true); cursor += 4;
    view.setUint16(cursor, entry.nameBytes.length, true); cursor += 2;
    view.setUint16(cursor, 0, true); cursor += 2; // extra
    view.setUint16(cursor, 0, true); cursor += 2; // comment
    view.setUint16(cursor, 0, true); cursor += 2; // disk
    view.setUint16(cursor, 0, true); cursor += 2; // internal attrs
    view.setUint32(cursor, 0, true); cursor += 4; // external attrs
    view.setUint32(cursor, entry.offset, true); cursor += 4;
    out.set(entry.nameBytes, cursor); cursor += entry.nameBytes.length;
  }

  view.setUint32(cursor, 0x06054b50, true); cursor += 4;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, prepared.length, true); cursor += 2;
  view.setUint16(cursor, prepared.length, true); cursor += 2;
  view.setUint32(cursor, centralSize, true); cursor += 4;
  view.setUint32(cursor, centralOffset, true); cursor += 4;
  view.setUint16(cursor, 0, true);

  return out;
}
