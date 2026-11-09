import { buildTemplate } from "@/lib/students-parse";

// Static: the same blank template for everyone (no student data in it).
export async function GET() {
  const file = await buildTemplate();
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="students-template.xlsx"',
    },
  });
}
