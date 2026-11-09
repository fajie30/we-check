"use client";

import { useMemo, useState, useTransition } from "react";
import { DownloadIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addStudent,
  importStudents,
  previewStudents,
  removeStudent,
  updateStudent,
  type StudentResult,
} from "@/app/(app)/courses/[id]/sections/student-actions";
import type { StudentRow } from "@/lib/activities";
import { StudentInputSchema, type PreviewRow, type PreviewStatus } from "@/lib/students-schema";

const STATUS: Record<PreviewStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "New", variant: "default" },
  update: { label: "Update name", variant: "outline" },
  unchanged: { label: "No change", variant: "secondary" },
  conflict: { label: "Other section", variant: "destructive" },
  invalid: { label: "Invalid", variant: "destructive" },
};

export function StudentsTab({
  sectionId,
  sectionName,
  students,
}: {
  sectionId: string;
  sectionName: string;
  students: StudentRow[];
}) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; student: StudentRow } | null>(null);
  const [toRemove, setToRemove] = useState<StudentRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? students : students.filter((s) => s.full_name.toLowerCase().includes(q) || s.id_number.toLowerCase().includes(q));
  }, [students, query]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-widest uppercase">Students ({students.length})</h2>
        <div className="flex flex-wrap gap-2">
          <a href="/api/templates/students" download className={buttonVariants({ variant: "ghost" })}>
            <DownloadIcon data-icon="inline-start" /> Template
          </a>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" /> Upload Excel
          </Button>
          <Button onClick={() => { setError(null); setForm({ mode: "add" }); }}>
            <PlusIcon data-icon="inline-start" /> Add student
          </Button>
        </div>
      </div>

      {students.length === 0 ? (
        <p className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No students in section {sectionName} yet. Upload an Excel file (ID Number and Full Name) or add one by one.
        </p>
      ) : (
        <>
          <Input
            aria-label="Search students"
            placeholder="Search by name or ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Number</TableHead>
                <TableHead>Full Name</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.id_number}</TableCell>
                  <TableCell className="whitespace-normal">{s.full_name}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.full_name}`} onClick={() => { setError(null); setForm({ mode: "edit", student: s }); }}>
                      <PencilIcon />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.full_name}`} onClick={() => { setError(null); setToRemove(s); }}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">No match.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </>
      )}

      {/* Add / edit */}
      {form ? (
        <StudentFormDialog
          key={form.mode === "edit" ? form.student.id : "add"}
          sectionId={sectionId}
          sectionName={sectionName}
          student={form.mode === "edit" ? form.student : undefined}
          onClose={() => setForm(null)}
        />
      ) : null}

      {/* Remove */}
      <Dialog open={toRemove !== null} onOpenChange={(o) => !o && !pending && setToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {toRemove?.full_name}?</DialogTitle>
            <DialogDescription>They&apos;re removed from section {sectionName}. You can add them again later.</DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToRemove(null)} disabled={pending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!toRemove) return;
                setError(null);
                startTransition(async () => {
                  const res = await removeStudent({ id: toRemove.id });
                  if (res.ok) {
                    toast.success("Student removed");
                    setToRemove(null);
                  } else setError(res.message);
                });
              }}
            >
              {pending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {importOpen ? <ImportDialog sectionId={sectionId} sectionName={sectionName} onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function StudentFormDialog({
  sectionId,
  sectionName,
  student,
  onClose,
}: {
  sectionId: string;
  sectionName: string;
  student?: StudentRow;
  onClose: () => void;
}) {
  const [idNumber, setIdNumber] = useState(student?.id_number ?? "");
  const [fullName, setFullName] = useState(student?.full_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = StudentInputSchema.safeParse({ idNumber, fullName });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That isn't valid.");
      return;
    }
    startTransition(async () => {
      const res: StudentResult = student
        ? await updateStudent({ id: student.id, sectionId, student: parsed.data })
        : await addStudent({ sectionId, student: parsed.data });
      if (res.ok) {
        toast.success(student ? "Student saved" : "Student added");
        onClose();
      } else setError(res.message);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{student ? "Edit student" : `Add student to section ${sectionName}`}</DialogTitle>
          <DialogDescription>A student can be in only one section of a course.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="s-id">ID Number</Label>
            <Input id="s-id" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={30} required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-name">Full Name</Label>
            <Input id="s-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={150} required />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : student ? "Save" : "Add student"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ sectionId, sectionName, onClose }: { sectionId: string; sectionName: string; onClose: () => void }) {
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [keep, setKeep] = useState<Record<string, number>>({}); // dupKey -> spreadsheet row kept
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("sectionId", sectionId);
    fd.set("file", file);
    startTransition(async () => {
      const res = await previewStudents(fd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // Default for a repeated ID: keep the first row.
      const defaults: Record<string, number> = {};
      for (const r of res.rows) if (r.dupKey && defaults[r.dupKey] === undefined) defaults[r.dupKey] = r.row;
      setKeep(defaults);
      setRows(res.rows);
    });
  }

  // A row is imported if it is new/update and, when its ID repeats, it is the chosen one.
  const willImport = (r: PreviewRow) =>
    (r.status === "new" || r.status === "update") && (!r.dupKey || keep[r.dupKey] === r.row);
  const toImport = rows?.filter(willImport) ?? [];
  const dupGroups = new Set(rows?.filter((r) => r.dupKey).map((r) => r.dupKey)).size;
  const count = (s: PreviewStatus) => rows?.filter((r) => r.status === s && willImport(r) === (s === "new" || s === "update")).length ?? 0;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await importStudents({
        sectionId,
        rows: toImport.map((r) => ({ idNumber: r.idNumber, fullName: r.fullName })),
      });
      if (res.ok) {
        toast.success(`${res.added} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ""}`);
        onClose();
      } else setError(res.message);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload students to section {sectionName}</DialogTitle>
          <DialogDescription>
            An .xlsx or .csv with the headers ID Number and Full Name. Nothing is saved until you confirm. The file itself isn&apos;t kept.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="grid gap-2">
            <Label htmlFor="s-file">File</Label>
            <Input
              id="s-file"
              type="file"
              accept=".xlsx,.csv"
              disabled={pending}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {pending ? <p className="text-sm text-muted-foreground">Reading file...</p> : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm">
              <strong>{count("new")}</strong> new · <strong>{count("update")}</strong> name updates ·{" "}
              {rows.filter((r) => r.status === "unchanged").length} unchanged ·{" "}
              {rows.filter((r) => r.status === "conflict" || r.status === "invalid").length} skipped
            </p>
            {dupGroups > 0 ? (
              <p role="note" className="border border-border bg-muted p-3 text-sm">
                {dupGroups} ID number{dupGroups === 1 ? " appears" : "s appear"} more than once in the file. Choose which row to keep for each; the others are skipped.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>ID Number</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-16">Keep</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const dupSkipped = r.dupKey !== undefined && keep[r.dupKey] !== r.row;
                  return (
                    <TableRow key={r.row} className={dupSkipped ? "opacity-50" : undefined}>
                      <TableCell>{r.row}</TableCell>
                      <TableCell className="font-mono text-xs">{r.idNumber}</TableCell>
                      <TableCell className="whitespace-normal">{r.fullName}</TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                          {r.dupKey ? <Badge variant="outline">Repeated ID</Badge> : null}
                        </div>
                        {r.message ? <p className="mt-0.5 text-xs text-muted-foreground">{r.message}</p> : null}
                      </TableCell>
                      <TableCell>
                        {r.dupKey ? (
                          <input
                            type="radio"
                            name={`keep-${r.dupKey}`}
                            aria-label={`Keep row ${r.row} for ID ${r.idNumber}`}
                            checked={keep[r.dupKey] === r.row}
                            onChange={() => setKeep((k) => ({ ...k, [r.dupKey!]: r.row }))}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {rows !== null ? (
            <Button variant="outline" onClick={() => { setRows(null); setError(null); }} disabled={pending}>Choose another file</Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          {rows !== null ? (
            <Button onClick={confirm} disabled={pending || toImport.length === 0}>
              {pending ? "Saving..." : `Save ${toImport.length} student${toImport.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
