import "server-only";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/students-schema";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ID_HEADERS = new Set(["idnumber", "idno", "idnum", "id", "studentid", "studentnumber", "studentno"]);
const NAME_HEADERS = new Set(["fullname", "name", "studentname"]);
const LINK_HEADERS = new Set(["link", "url", "drivelink", "googledrivelink", "submission", "submissionlink"]);

export type ParsedRow = { row: number; idNumber: string; fullName: string };
export type ParsedLinkRow = { row: number; idNumber: string; link: string };

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  // Hyperlink cells hold { text, hyperlink }: the address is what we want for a link column.
  if (typeof v === "object" && "hyperlink" in v && typeof v.hyperlink === "string") return v.hyperlink;
  return cell.text ?? "";
}

/** Validate and open the first sheet of an .xlsx/.csv. */
async function loadSheet(file: File): Promise<{ sheet: ExcelJS.Worksheet } | { error: string }> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "That file is larger than 2 MB." };
  const isCsv = /\.csv$/i.test(file.name);
  if (!isCsv && !/\.xlsx$/i.test(file.name)) return { error: "Upload an .xlsx or .csv file." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (isCsv) sheet = await wb.csv.read(Readable.from(buffer));
    else {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      sheet = wb.worksheets[0];
    }
  } catch {
    return { error: "Couldn't read that file. Use the template and save as .xlsx or .csv." };
  }
  if (!sheet) return { error: "The file has no sheets." };
  if (sheet.rowCount > MAX_IMPORT_ROWS + 1) return { error: `A file can have up to ${MAX_IMPORT_ROWS} rows.` };
  return { sheet };
}

/** Find the column of each wanted header in row 1. */
function findColumns(sheet: ExcelJS.Worksheet, wanted: Record<string, Set<string>>): Record<string, number> | null {
  const found: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const h = norm(cellText(cell));
    for (const [key, set] of Object.entries(wanted)) if (!found[key] && set.has(h)) found[key] = col;
  });
  return Object.keys(wanted).every((k) => found[k]) ? found : null;
}

/** Roster file: headers "ID Number" and "Full Name". */
export async function readStudentSheet(file: File): Promise<{ rows: ParsedRow[] } | { error: string }> {
  const loaded = await loadSheet(file);
  if ("error" in loaded) return loaded;
  const { sheet } = loaded;
  const cols = findColumns(sheet, { id: ID_HEADERS, name: NAME_HEADERS });
  if (!cols) return { error: 'The first row must have the headers "ID Number" and "Full Name". Download the template to start.' };

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const idNumber = cellText(row.getCell(cols.id)).trim();
    const fullName = cellText(row.getCell(cols.name)).trim();
    if (idNumber === "" && fullName === "") continue;
    rows.push({ row: r, idNumber, fullName });
  }
  if (rows.length === 0) return { error: "No students found under the headers." };
  return { rows };
}

/** Links file: headers "ID Number" and "Link" (a Full Name column, if present, is ignored). */
export async function readLinkSheet(file: File): Promise<{ rows: ParsedLinkRow[] } | { error: string }> {
  const loaded = await loadSheet(file);
  if ("error" in loaded) return loaded;
  const { sheet } = loaded;
  const cols = findColumns(sheet, { id: ID_HEADERS, link: LINK_HEADERS });
  if (!cols) return { error: 'The first row must have the headers "ID Number" and "Link". Download the template to start.' };

  const rows: ParsedLinkRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const idNumber = cellText(row.getCell(cols.id)).trim();
    const link = cellText(row.getCell(cols.link)).trim();
    if (idNumber === "" && link === "") continue;
    rows.push({ row: r, idNumber, link });
  }
  if (rows.length === 0) return { error: "No rows found under the headers." };
  return { rows };
}

async function template(
  sheetName: string,
  columns: { header: string; key: string; width: number; style?: Partial<ExcelJS.Style> }[],
  help: string[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  const sheet = wb.addWorksheet("How to use");
  sheet.getColumn(1).width = 90;
  help.forEach((t) => sheet.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Roster template: ID column formatted as text so leading zeros survive. */
export const buildTemplate = () =>
  template(
    "Students",
    [
      { header: "ID Number", key: "id", width: 20, style: { numFmt: "@" } },
      { header: "Full Name", key: "name", width: 40 },
    ],
    [
      "Fill the Students sheet: one student per row, ID Number and Full Name only.",
      "Keep the header row. Do not rename the headers.",
      "ID numbers are saved as text, so leading zeros are kept.",
      "A student can be in only one section of a course.",
    ],
  );

/** Links template: one Google Drive link per student (zip several files into one). */
export const buildLinksTemplate = () =>
  template(
    "Links",
    [
      { header: "ID Number", key: "id", width: 20, style: { numFmt: "@" } },
      { header: "Link", key: "link", width: 70 },
    ],
    [
      "One row per student: their ID Number and the Google Drive link to their work.",
      "If a student has several files, they should zip them into one file and share that link.",
      "Sharing must be set to 'Anyone with the link' so you can open it.",
      "Students are matched to this section's roster by ID Number.",
      "Students who already have a different link are skipped. Edit those one by one.",
    ],
  );
