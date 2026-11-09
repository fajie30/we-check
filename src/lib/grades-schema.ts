// Shared by the Grades tab (browser) and the Excel export (server).

export type GradeActivity = { id: string; title: string; max: number };
export type GradeStudent = { id: string; id_number: string; full_name: string };

export type GradesData = {
  courseId: string;
  courseName: string;
  sectionId: string;
  sectionName: string;
  /** Activities linked to the section, oldest first. */
  activities: GradeActivity[];
  students: GradeStudent[];
  /** Saved checks only, keyed `${studentId}:${activityId}`. A missing key means "not checked". */
  scores: Record<string, number>;
};

export type GradeCell = { checked: boolean; score: number };
export type GradeRow = {
  student: GradeStudent;
  cells: GradeCell[];
  earned: number;
  possible: number;
  /** null when no activity has a maximum above 0. */
  percent: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One row per student, one cell per activity. Unchecked cells count as 0 in the total, and the
 * total's "possible" includes every activity in the section.
 */
export function buildGradeRows(data: GradesData): { rows: GradeRow[]; checkedCells: number; totalCells: number } {
  const possible = round2(data.activities.reduce((s, a) => s + a.max, 0));
  let checkedCells = 0;
  const rows = data.students.map((student) => {
    const cells = data.activities.map((a) => {
      const score = data.scores[`${student.id}:${a.id}`];
      if (score === undefined) return { checked: false, score: 0 };
      checkedCells++;
      return { checked: true, score };
    });
    const earned = round2(cells.reduce((s, c) => s + c.score, 0));
    return {
      student,
      cells,
      earned,
      possible,
      percent: possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null,
    };
  });
  return { rows, checkedCells, totalCells: data.students.length * data.activities.length };
}
