"use client";

import { useState, useTransition } from "react";
import { DownloadIcon, EyeIcon, ExternalLinkIcon, SparklesIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { CheckSheet } from "@/components/courses/check-sheet";
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
import { importLinks, previewLinks } from "@/app/(app)/courses/[id]/sections/submission-actions";
import type { ActivityRow } from "@/lib/activities";
import type { StudentCheckRow } from "@/lib/activity-page";
import type { LinkPreviewRow, LinkStatus } from "@/lib/submissions-schema";

const STATUS: Record<LinkStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "New link", variant: "default" },
  same: { label: "Already attached", variant: "secondary" },
  has_link: { label: "Has a link", variant: "outline" },
  not_in_roster: { label: "Not in roster", variant: "destructive" },
  invalid: { label: "Invalid", variant: "destructive" },
};

export function ActivityStudents({
  activity,
  sectionId,
  sectionName,
  max,
  students,
}: {
  activity: ActivityRow;
  sectionId: string;
  sectionName: string;
  max: number;
  students: StudentCheckRow[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = q === "" ? students : students.filter((s) => s.full_name.toLowerCase().includes(q) || s.id_number.toLowerCase().includes(q));
  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.id));
  const viewed = students.find((s) => s.id === viewing) ?? null;

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (students.length === 0) {
    return (
      <p className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Section {sectionName} has no students yet. Add them on the section&apos;s Students tab.
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
        <div className="flex flex-wrap gap-2">
          <a href="/api/templates/links" download className={buttonVariants({ variant: "ghost" })}>
            <DownloadIcon data-icon="inline-start" /> Download template
          </a>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" /> Upload Excel
          </Button>
        </div>
      </div>

      {/* AI checking: interface only for now. */}
      <div className="flex flex-wrap items-center gap-2 border border-dashed border-border p-3">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <span className="mr-auto text-sm text-muted-foreground">
          Check with AI <Badge variant="outline">Coming soon</Badge>
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </span>
        <Button variant="outline" size="sm" disabled title="Coming soon">Check selected{selected.size > 0 ? ` (${selected.size})` : ""}</Button>
        <Button variant="outline" size="sm" disabled title="Coming soon">Check all</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                aria-label="Select all shown students"
                checked={allShownSelected}
                onChange={() =>
                  setSelected((cur) => {
                    const next = new Set(cur);
                    for (const s of shown) {
                      if (allShownSelected) next.delete(s.id);
                      else next.add(s.id);
                    }
                    return next;
                  })
                }
              />
            </TableHead>
            <TableHead>ID Number</TableHead>
            <TableHead>Full Name</TableHead>
            <TableHead>Work</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="w-24 text-right">View</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <input type="checkbox" aria-label={`Select ${s.full_name}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              </TableCell>
              <TableCell className="font-mono text-xs">{s.id_number}</TableCell>
              <TableCell className="whitespace-normal">{s.full_name}</TableCell>
              <TableCell>
                {s.link ? (
                  <a
                    href={s.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                  >
                    <ExternalLinkIcon className="size-3" /> Open
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No link</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={s.checked ? "default" : "secondary"}>{s.checked ? "Checked" : "Not checked"}</Badge>
              </TableCell>
              <TableCell className={`text-right tabular-nums ${s.checked ? "" : "text-muted-foreground"}`}>
                {s.score} / {max}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => setViewing(s.id)} aria-label={`View ${s.full_name}`}>
                  <EyeIcon data-icon="inline-start" /> View
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {shown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">No match.</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {viewed ? <CheckSheet key={viewed.id} activity={activity} max={max} student={viewed} onClose={() => setViewing(null)} /> : null}
      {importOpen ? (
        <LinksDialog activityId={activity.id} sectionId={sectionId} sectionName={sectionName} onClose={() => setImportOpen(false)} />
      ) : null}
    </div>
  );
}

function LinksDialog({
  activityId,
  sectionId,
  sectionName,
  onClose,
}: {
  activityId: string;
  sectionId: string;
  sectionName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LinkPreviewRow[] | null>(null);
  const [keep, setKeep] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("activityId", activityId);
    fd.set("sectionId", sectionId);
    fd.set("file", file);
    startTransition(async () => {
      const res = await previewLinks(fd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const defaults: Record<string, number> = {};
      for (const r of res.rows) if (r.dupKey && defaults[r.dupKey] === undefined) defaults[r.dupKey] = r.row;
      setKeep(defaults);
      setRows(res.rows);
    });
  }

  const willImport = (r: LinkPreviewRow) => r.status === "new" && (!r.dupKey || keep[r.dupKey] === r.row);
  const toImport = rows?.filter(willImport) ?? [];
  const dupGroups = new Set(rows?.filter((r) => r.dupKey).map((r) => r.dupKey)).size;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await importLinks({
        activityId,
        sectionId,
        rows: toImport.map((r) => ({ idNumber: r.idNumber, link: r.link })),
      });
      if (res.ok) {
        toast.success(`${res.added} link${res.added === 1 ? "" : "s"} attached${res.skipped ? `, ${res.skipped} skipped` : ""}`);
        onClose();
      } else setError(res.message);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload Excel: student links for section {sectionName}</DialogTitle>
          <DialogDescription>
            Upload the Excel file you filled in from the template (headers ID Number and Link, one Google Drive link per student). Nothing is saved until you confirm. Students who already have a different link are skipped.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="grid gap-2">
            <Label htmlFor="l-file">File</Label>
            <Input id="l-file" type="file" accept=".xlsx,.csv" disabled={pending} onChange={(e) => onFile(e.target.files?.[0])} />
            {pending ? <p className="text-sm text-muted-foreground">Reading file...</p> : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm">
              <strong>{toImport.length}</strong> to attach · {rows.length - toImport.length} skipped
            </p>
            {dupGroups > 0 ? (
              <p role="note" className="border border-border bg-muted p-3 text-sm">
                {dupGroups} ID number{dupGroups === 1 ? " appears" : "s appear"} more than once. Choose which row to keep for each; the others are skipped.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>ID Number</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Link</TableHead>
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
                      <TableCell className="whitespace-normal">{r.studentName ?? "-"}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs" title={r.link}>{r.link}</TableCell>
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
              {pending ? "Saving..." : `Attach ${toImport.length} link${toImport.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
