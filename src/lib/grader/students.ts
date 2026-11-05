import { newBudget, readZip, type Budget } from "./unzip";
import { LIMITS } from "./config";
import type { ExtractedFile } from "./types";

export type StudentProject = {
  name: string;
  files: ExtractedFile[];
  notes: string[];
};

export type StudentSplit = {
  students: StudentProject[];
  /** Things that could not be assigned to a student: "fix manually" list. */
  unmatched: string[];
  warnings: string[];
};

const IGNORED_TOP = new Set(["__macosx", ".ds_store", "thumbs.db"]);

/** "Dela_Cruz_Juan.zip" -> "Dela Cruz Juan". Strips extension, collapses separators. */
export function studentNameFromEntry(entryName: string): string {
  return entryName
    .replace(/\.zip$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topSegment(path: string): string {
  return path.split("/")[0];
}

function isIgnored(path: string): boolean {
  return IGNORED_TOP.has(topSegment(path).toLowerCase());
}

/**
 * Turn an extracted upload into per-student projects.
 *  - `Lastname_Firstname.zip` entries at the top level -> one student each (zip expanded)
 *  - top-level folders -> one student per folder
 *  - a single wrapper folder is unwrapped once
 * Loose top-level files and unreadable student zips go to `unmatched`.
 */
export function splitStudents(
  outer: ExtractedFile[],
  budget: Budget = newBudget(),
  depth = 1,
): StudentSplit {
  let files = outer.filter((f) => !isIgnored(f.path));
  const unmatched: string[] = [];
  const warnings: string[] = [];

  // Unwrap a single wrapper folder ("projects/…") once.
  const tops = new Set(files.map((f) => topSegment(f.path)));
  if (tops.size === 1 && files.every((f) => f.path.includes("/"))) {
    files = files.map((f) => ({ path: f.path.slice(f.path.indexOf("/") + 1), data: f.data }));
  }

  const byName = new Map<string, StudentProject>();
  const add = (rawName: string, projectFiles: ExtractedFile[], notes: string[] = []) => {
    let name = rawName;
    let n = 2;
    while (byName.has(name)) {
      name = `${rawName} (${n++})`;
    }
    const extra = name !== rawName ? [`Duplicate student name "${rawName}" - check manually.`] : [];
    byName.set(name, { name, files: projectFiles, notes: [...notes, ...extra] });
  };

  const folders = new Map<string, ExtractedFile[]>();

  for (const f of files) {
    if (!f.path.includes("/")) {
      if (/\.zip$/i.test(f.path)) {
        if (depth >= LIMITS.maxDepth) {
          unmatched.push(`${f.path} (nested too deep)`);
          continue;
        }
        try {
          const inner = readZip(f.data, budget);
          warnings.push(...inner.warnings.map((w) => `${f.path}: ${w}`));
          // A student zip may itself wrap everything in one folder.
          let innerFiles = inner.files.filter((x) => !isIgnored(x.path));
          const innerTops = new Set(innerFiles.map((x) => topSegment(x.path)));
          if (innerTops.size === 1 && innerFiles.every((x) => x.path.includes("/"))) {
            innerFiles = innerFiles.map((x) => ({
              path: x.path.slice(x.path.indexOf("/") + 1),
              data: x.data,
            }));
          }
          add(studentNameFromEntry(f.path), innerFiles);
        } catch (e) {
          unmatched.push(`${f.path} (${e instanceof Error ? e.message : "unreadable zip"})`);
        }
      } else {
        unmatched.push(f.path);
      }
      continue;
    }
    const top = topSegment(f.path);
    const rest = f.path.slice(top.length + 1);
    const list = folders.get(top) ?? [];
    list.push({ path: rest, data: f.data });
    folders.set(top, list);
  }

  for (const [folder, folderFiles] of folders) {
    add(studentNameFromEntry(folder), folderFiles);
  }

  return { students: [...byName.values()], unmatched, warnings };
}
