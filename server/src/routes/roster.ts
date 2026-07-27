import { Router } from 'express';
import pool from '../db/pool';
import {
  fetchDoctors, fetchShiftTypes, fetchLeavesForMonth,
  getOrCreateRosterMonth, fetchExistingAssignments,
  fetchAssignmentById, fetchDoctorById, fetchShiftTypeById,
} from '../db/queries';
import { generateRoster } from '../scheduler/generate';
import { persistGeneratedRoster } from '../scheduler/persist';
import { validateManualOverride } from '../scheduler/validateOverride';
import { ShiftId } from '../scheduler/types';

const router = Router();

router.get('/:year/:month', async (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Invalid year or month' });
  }

  try {
    const existingMonth = await pool.query(
      `SELECT id, generated_at FROM roster_months WHERE year = $1 AND month = $2`,
      [year, month]
    );
    if (existingMonth.rows.length === 0) {
      return res.json({ generatedAt: null, assignments: [] });
    }

    const rosterMonthId = existingMonth.rows[0].id;
    const assignments = await fetchExistingAssignments(rosterMonthId);
    return res.json({ generatedAt: existingMonth.rows[0].generated_at, assignments });
  } catch (err) {
    console.error('Failed to fetch roster', err);
    return res.status(500).json({ error: 'Failed to fetch roster' });
  }
});

router.post('/:year/:month/generate', async (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const resetManualOverrides = req.body?.resetManualOverrides === true;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Invalid year or month' });
  }

  try {
    const [doctors, shiftTypes, leaves] = await Promise.all([
      fetchDoctors(),
      fetchShiftTypes(),
      fetchLeavesForMonth(year, month),
    ]);

    const rosterMonthId = await getOrCreateRosterMonth(year, month);
    const existing = await fetchExistingAssignments(rosterMonthId);

    const generated = generateRoster({ year, month, doctors, shiftTypes, leaves });

    const result = await persistGeneratedRoster({
      rosterMonthId,
      generated,
      existing,
      resetManualOverrides,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to generate roster', err);
    return res.status(500).json({ error: 'Failed to generate roster' });
  }
});

// PATCH /api/roster/assignments/:id
// Body: { doctorId: string | null, isShiftActive?: boolean, force?: boolean, note?: string }
// - doctorId = null clears the slot (still recorded as a manual action).
// - Without force: a rule violation returns 409 with the reason, and
//   NOTHING is written — matches spec 17's "validation toasts/errors
//   when a manual pick breaks scheduling rules."
// - With force = true: the override is written anyway, but only if a
//   note explaining why is also provided, so there's always an audit
//   trail for a deliberately rule-breaking manual pick.
router.patch('/assignments/:id', async (req, res) => {
  const { id } = req.params;
  const doctorId: string | null = req.body?.doctorId ?? null;
  const isShiftActive: boolean = req.body?.isShiftActive ?? true;
  const force: boolean = req.body?.force === true;
  const note: string | undefined = req.body?.note;

  if (force && !note) {
    return res.status(400).json({ error: 'A note is required when forcing a rule-breaking override' });
  }

  try {
    const assignment = await fetchAssignmentById(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Clearing the slot or marking it inactive never needs rule
    // validation — there's no doctor to be ineligible.
    if (doctorId === null) {
      await pool.query(
        `UPDATE roster_assignments
         SET doctor_id = NULL, is_shift_active = $2, source = 'manual',
             is_manual_override = TRUE, override_note = $3, updated_at = NOW()
         WHERE id = $1`,
        [id, isShiftActive, note ?? null]
      );
      return res.json({ ok: true });
    }

    const [doctor, shift] = await Promise.all([
      fetchDoctorById(doctorId),
      fetchShiftTypeById(assignment.shift_type_id as ShiftId),
    ]);
    if (!doctor) return res.status(400).json({ error: 'Doctor not found' });
    if (!shift) return res.status(400).json({ error: 'Shift type not found' });

    const validation = await validateManualOverride(
      doctor, shift, assignment.assignment_date, assignment.roster_month_id, id
    );

    if (!validation.eligible && !force) {
      return res.status(409).json({
        ok: false,
        eligible: false,
        reason: validation.reason,
        message: `${doctor.name} is not eligible for ${shift.name} on ${assignment.assignment_date} (${validation.reason}). Pass force=true with a note to override anyway.`,
      });
    }

    await pool.query(
      `
      UPDATE roster_assignments
      SET doctor_id = $2, is_shift_active = $3, source = 'manual',
          is_manual_override = TRUE, override_note = $4, updated_at = NOW()
      WHERE id = $1
      `,
      [id, doctorId, isShiftActive, note ?? null]
    );

    return res.json({
      ok: true,
      forcedOverride: !validation.eligible && force,
      ...(validation.eligible ? {} : { violatedRule: validation.reason }),
    });
  } catch (err) {
    // Most likely failure here: the partial unique index
    // (roster_month_id, assignment_date, doctor_id) rejecting a
    // same-day double-booking that slipped past the app-level check —
    // e.g. a race between two admins editing at once. Surface it as a
    // client error, not a 500, since it's a legitimate conflict, not a
    // server bug.
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      return res.status(409).json({
        error: 'This doctor is already assigned to another shift on this date',
      });
    }
    console.error('Failed to save manual override', err);
    return res.status(500).json({ error: 'Failed to save manual override' });
  }
});

export default router;
