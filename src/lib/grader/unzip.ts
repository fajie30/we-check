import AdmZip from "adm-zip";
import { LIMITS } from "./config";
import type { ExtractedFile } from "./types";

export class UnsafeArchiveError extends Error {}

export type UnzipResult = {
  /** Files with normalized relative paths. Nested student zips stay as .zip entries. */
  files: ExtractedFile[];
  /** Entries that were skipped and why (traversal, too large, ...). */
  warnings: string[];
};

/**
 * Normalize an archive entry name. Returns null if it is unsafe:
 * absolute paths, drive letters, `..` segments, NUL bytes.
 */
export function normalizeEntryPath(raw: string): string | null {
  if (raw.includes("\0")) return null;
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) return null;
  if (parts.length === 0) return null;
  return parts.join("/");
}

/** Budget shared across an upload (including nested archives). */
export type Budget = { files: number; bytes: number };

export function newBudget(): Budget {
  return { files: 0, bytes: 0 };
}

/**
 * Safely read a zip held in memory. Nothing is written to disk, so path
 * traversal cannot escape anywhere; unsafe names are skipped anyway so they
 * can never reach later stages. Limits are enforced on declared sizes (before
 * decompressing) and again on the real decompressed length.
 */
export function readZip(buf: Buffer, budget: Budget = newBudget()): UnzipResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new UnsafeArchiveError("Not a valid zip file.");
  }

  const entries = zip.getEntries();
  if (entries.length > LIMITS.maxFiles) {
    throw new UnsafeArchiveError(`Archive has too many entries (${entries.length}).`);
  }

  const files: ExtractedFile[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const path = normalizeEntryPath(entry.entryName);
    if (!path) {
      warnings.push(`Skipped unsafe path: ${JSON.stringify(entry.entryName)}`);
      continue;
    }

    const declared = entry.header.size;
    const compressed = entry.header.compressedSize;
    if (declared > LIMITS.maxFileBytes) {
      warnings.push(`Skipped ${path}: larger than per-file limit.`);
      continue;
    }
    if (compressed > 0 && declared / compressed > LIMITS.maxRatio && declared > 1024 * 1024) {
      warnings.push(`Skipped ${path}: suspicious compression ratio.`);
      continue;
    }

    budget.files += 1;
    budget.bytes += declared;
    if (budget.files > LIMITS.maxFiles || budget.bytes > LIMITS.maxTotalUncompressed) {
      throw new UnsafeArchiveError("Archive expands beyond the allowed size (possible zip bomb).");
    }

    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      warnings.push(`Skipped ${path}: could not be decompressed.`);
      continue;
    }
    if (data.length > LIMITS.maxFileBytes || data.length > declared) {
      warnings.push(`Skipped ${path}: size does not match archive header.`);
      continue;
    }
    files.push({ path, data });
  }

  return { files, warnings };
}
