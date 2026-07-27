import pool from '../db/pool';
import { GeneratedAssignment, ExistingAssignment } from './types';

export interface PersistOptions {
  rosterMonthId: string;
  generated: GeneratedAssignment[];
  existing: ExistingAssignment[];
  // Explicit, caller-supplied flag — never defaults to true. This is the
  // ONLY switch that allows a manual override to be replaced by a fresh
  // generated value, matching spec section 17: "must not silently
  // overwrite manual overrides unless the user explicitly chooses to
  // reset."
  resetManualOverrides: boolean;
}

export interface PersistResult {
  written: number;
  skippedManualOverrides: number;
}

export async function persistGeneratedRoster(opts: PersistOptions): Promise<PersistResult> {
  const { rosterMonthId, generated, existing, resetManualOverrides } = opts;

  const manualProtected = new Set(
    existing
      .filter((e) => e.isManualOverride && !resetManualOverrides)
      .map((e) => `${e.assignmentDate}|${e.shiftTypeId}`)
  );

  let written = 0;
  let skipped = 0;

  // One transaction for the whole month — a partial write on failure
  // would leave the roster in a half-generated state that's worse than
  // either the old roster or a fully new one.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of generated) {
      const key = `${row.assignmentDate}|${row.shiftTypeId}`;
      if (manualProtected.has(key)) {
        skipped += 1;
        continue;
      }

      await client.query(
        `
        INSERT INTO roster_assignments
          (roster_month_id, assignment_date, shift_type_id, doctor_id,
           is_shift_active, source, is_manual_override, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'generated', FALSE, NOW())
        ON CONFLICT (roster_month_id, assignment_date, shift_type_id)
        DO UPDATE SET
          doctor_id = EXCLUDED.doctor_id,
          is_shift_active = EXCLUDED.is_shift_active,
          source = 'generated',
          is_manual_override = FALSE,
          updated_at = NOW()
        WHERE roster_assignments.is_manual_override = FALSE
        `,
        [rosterMonthId, row.assignmentDate, row.shiftTypeId, row.doctorId, row.isShiftActive]
      );
      written += 1;
    }

    await client.query(
      `UPDATE roster_months SET generated_at = NOW() WHERE id = $1`,
      [rosterMonthId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { written, skippedManualOverrides: skipped };
}
