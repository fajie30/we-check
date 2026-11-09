"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportGrades } from "@/app/(app)/courses/[id]/sections/grades-actions";
import { buildGradeRows, type GradesData } from "@/lib/grades-schema";

// Cells share these so the sticky header/column line up.
const cell = "border-b border-border px-3 py-2 whitespace-nowrap";

export function GradesTab({ data }: { data: GradesData }) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const { rows, checkedCells, totalCells } = useMemo(() => buildGradeRows(data), [data]);
  const q = query.trim().toLowerCase();
  const shown = q === "" ? rows : rows.filter((r) => r.student.full_name.toLowerCase().includes(q) || r.student.id_number.toLowerCase().includes(q));

  function download() {
    startTransition(async () => {
      const res = await exportGrades({ sectionId: data.sectionId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (data.students.length === 0 || data.activities.length === 0) {
    return (
      <p className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {data.students.length === 0
          ? `Section ${data.sectionName} has no students yet. Add them on the Students tab.`
          : `Section ${data.sectionName} has no activities yet. Create one on the Activities tab.`}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Search students"
          placeholder="Search by name or ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="outline" onClick={download} disabled={pending}>
          <DownloadIcon data-icon="inline-start" /> {pending ? "Preparing..." : "Download Excel"}
        </Button>
      </div>

      {/* Own scroll box: the header row stays on top and the student column stays on the left. */}
      <div className="max-h-[70vh] overflow-auto border border-border" tabIndex={0} role="region" aria-label="Grades table">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${cell} sticky top-0 left-0 z-30 min-w-56 bg-background text-left font-semibold`}>
                Student
              </th>
              {data.activities.map((a) => (
                <th key={a.id} scope="col" className={`${cell} sticky top-0 z-20 min-w-32 bg-background text-right font-semibold`}>
                  <Link
                    href={`/courses/${data.courseId}/sections/${data.sectionId}/activities/${a.id}`}
                    className="underline-offset-4 hover:underline"
                    title={`Open ${a.title}`}
                  >
                    {a.title}
                  </Link>
                  <span className="block text-xs font-normal text-muted-foreground">/ {a.max}</span>
                </th>
              ))}
              <th scope="col" className={`${cell} sticky top-0 z-20 min-w-36 bg-background text-right font-semibold`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.student.id}>
                <th scope="row" className={`${cell} sticky left-0 z-10 bg-background text-left font-normal`}>
                  <span className="block">{r.student.full_name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{r.student.id_number}</span>
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={data.activities[i].id}
                    className={`${cell} text-right tabular-nums ${c.checked ? "" : "text-muted-foreground/60"}`}
                    title={c.checked ? undefined : "Not checked"}
                  >
                    {c.score}
                  </td>
                ))}
                <td className={`${cell} text-right tabular-nums`}>
                  <span className="font-medium">{r.earned}</span> / {r.possible}
                  <span className="block text-xs text-muted-foreground">{r.percent === null ? "-" : `${r.percent}%`}</span>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={data.activities.length + 2} className={`${cell} text-center text-muted-foreground`}>
                  No match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {checkedCells} of {totalCells} scores checked. Unchecked work shows a muted 0 and counts as 0 in the total.
      </p>
    </div>
  );
}
