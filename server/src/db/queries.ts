import pool from './pool';
import { Doctor, ShiftType, DoctorLeave, ExistingAssignment, ShiftId } from '../scheduler/types';

export async function fetchDoctors(): Promise<Doctor[]> {
  const { rows } = await pool.query(`
    SELECT id, slug, name, gender, weekly_off, allowed_shifts, max_nights_per_month
    FROM doctors
    ORDER BY slug
  `);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    gender: r.gender,
    weeklyOff: r.weekly_off,
    allowedShifts: r.allowed_shifts,
    maxNightsPerMonth: r.max_nights_per_month,
  }));
}

export async function fetchShiftTypes(): Promise<ShiftType[]> {
  const { rows } = await pool.query(`
    SELECT id, name, min_doctors, female_only, retention_priority
    FROM shift_types
    ORDER BY retention_priority
  `);
  return rows.map((r) => ({
    id: r.id as ShiftId,
    name: r.name,
    minDoctors: r.min_doctors,
    femaleOnly: r.female_only,
    retentionPriority: r.retention_priority,
  }));
}

// Leaves for a given month, plus one day of padding on either side so
// the post-night recovery check on the 1st can see a leave that started
// on the last day of the previous month, etc. Cheap safety margin, not
// load-bearing for the current spec (recovery only looks at yesterday).
export async function fetchLeavesForMonth(year: number, month: number): Promise<DoctorLeave[]> {
  const { rows } = await pool.query(
    `
    SELECT doctor_id, leave_date::text AS leave_date
    FROM doctor_leaves
    WHERE leave_date >= (make_date($1, $2, 1) - INTERVAL '1 day')
      AND leave_date <  (make_date($1, $2, 1) + INTERVAL '1 month' + INTERVAL '1 day')
    `,
    [year, month]
  );
  return rows.map((r) => ({ doctorId: r.doctor_id, leaveDate: r.leave_date }));
}

export async function getOrCreateRosterMonth(year: number, month: number): Promise<string> {
  const existing = await pool.query(
    `SELECT id FROM roster_months WHERE year = $1 AND month = $2`,
    [year, month]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await pool.query(
    `INSERT INTO roster_months (year, month) VALUES ($1, $2) RETURNING id`,
    [year, month]
  );
  return inserted.rows[0].id;
}

export async function fetchAssignmentById(id: string) {
  const { rows } = await pool.query(
    `SELECT id, roster_month_id, assignment_date::text AS assignment_date,
            shift_type_id, doctor_id, is_shift_active, source, is_manual_override
     FROM roster_assignments WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function fetchDoctorById(id: string): Promise<Doctor | null> {
  const { rows } = await pool.query(
    `SELECT id, slug, name, gender, weekly_off, allowed_shifts, max_nights_per_month
     FROM doctors WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, slug: r.slug, name: r.name, gender: r.gender,
    weeklyOff: r.weekly_off, allowedShifts: r.allowed_shifts,
    maxNightsPerMonth: r.max_nights_per_month,
  };
}

export async function fetchShiftTypeById(id: ShiftId): Promise<ShiftType | null> {
  const { rows } = await pool.query(
    `SELECT id, name, min_doctors, female_only, retention_priority
     FROM shift_types WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, name: r.name, minDoctors: r.min_doctors,
    femaleOnly: r.female_only, retentionPriority: r.retention_priority,
  };
}

export async function isDoctorOnLeave(doctorId: string, dateISO: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2`,
    [doctorId, dateISO]
  );
  return rows.length > 0;
}

// Monday-Sunday week containing dateISO, counted from persisted rows.
// excludeAssignmentId lets us re-validate a row against the OTHER
// shifts that week without double-counting itself.
export async function countShiftsThisWeek(
  doctorId: string, rosterMonthId: string, weekStartISO: string, weekEndISO: string,
  excludeAssignmentId: string
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM roster_assignments
     WHERE roster_month_id = $1 AND doctor_id = $2
       AND assignment_date BETWEEN $3 AND $4
       AND is_shift_active = TRUE
       AND id != $5`,
    [rosterMonthId, doctorId, weekStartISO, weekEndISO, excludeAssignmentId]
  );
  return rows[0].n;
}

export async function countNightsThisMonth(
  doctorId: string, rosterMonthId: string, excludeAssignmentId: string
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM roster_assignments
     WHERE roster_month_id = $1 AND doctor_id = $2 AND shift_type_id = 'night'
       AND is_shift_active = TRUE AND id != $3`,
    [rosterMonthId, doctorId, excludeAssignmentId]
  );
  return rows[0].n;
}

// The doctor's shift the day before dateISO, if any — feeds the
// post-night recovery / consecutive-night checks.
export async function fetchDoctorShiftOnDate(
  doctorId: string, rosterMonthId: string, dateISO: string
): Promise<ShiftId | null> {
  const { rows } = await pool.query(
    `SELECT shift_type_id FROM roster_assignments
     WHERE roster_month_id = $1 AND doctor_id = $2 AND assignment_date = $3
       AND is_shift_active = TRUE`,
    [rosterMonthId, doctorId, dateISO]
  );
  return rows.length > 0 ? rows[0].shift_type_id : null;
}

// Rule 4 — is this doctor already on a DIFFERENT shift the same date?
export async function doctorHasOtherShiftSameDay(
  doctorId: string, rosterMonthId: string, dateISO: string, excludeAssignmentId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM roster_assignments
     WHERE roster_month_id = $1 AND doctor_id = $2 AND assignment_date = $3
       AND is_shift_active = TRUE AND id != $4`,
    [rosterMonthId, doctorId, dateISO, excludeAssignmentId]
  );
  return rows.length > 0;
}

export async function fetchExistingAssignments(rosterMonthId: string): Promise<ExistingAssignment[]> {
  const { rows } = await pool.query(
    `
    SELECT id, assignment_date::text AS assignment_date, shift_type_id,
           doctor_id, is_shift_active, source, is_manual_override
    FROM roster_assignments
    WHERE roster_month_id = $1
    `,
    [rosterMonthId]
  );
  return rows.map((r) => ({
    id: r.id,
    assignmentDate: r.assignment_date,
    shiftTypeId: r.shift_type_id,
    doctorId: r.doctor_id,
    isShiftActive: r.is_shift_active,
    source: r.source,
    isManualOverride: r.is_manual_override,
  }));
}
