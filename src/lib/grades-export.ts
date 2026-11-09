import "server-only";
import ExcelJS from "exceljs";
import { buildGradeRows, type GradesData } from "@/lib/grades-schema";

/**
 * Excel copy of the grades table. Unchecked cells are left BLANK (not 0) so a spreadsheet average
 * isn't dragged down by work that hasn't been checked; the Total column still counts them as 0,
 * exactly like the app.
 */
export async function buildGradesWorkbook(data: GradesData): Promise<Buffer> {
  const { rows } = buildGradeRows(data);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Grades");

  ws.columns = [
    { header: "ID Number", key: "id", width: 18, style: { numFmt: "@" } },
    { header: "Full Name", key: "name", width: 36 },
    ...data.activities.map((a, i) => ({ header: `${a.title} (${a.max})`, key: `a${i}`, width: 18 })),
    { header: "Total", key: "total", width: 12 },
    { header: "Percent", key: "percent", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  for (const r of rows) {
    const row: Record<string, string | number | null> = {
      id: r.student.id_number,
      name: r.student.full_name,
      total: r.earned,
      percent: r.percent === null ? null : r.percent / 100,
    };
    r.cells.forEach((c, i) => {
      row[`a${i}`] = c.checked ? c.score : null;
    });
    ws.addRow(row);
  }
  ws.getColumn("percent").numFmt = "0.0%";

  return Buffer.from(await wb.xlsx.writeBuffer());
}
