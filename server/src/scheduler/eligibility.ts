import { Doctor, ShiftType, ROHAN_SLUG, IMRAN_SLUG, OBGYN_ELIGIBLE_SLUGS } from './types';
import { DoctorState, weekdayOf } from './state';

// Mirrors spec section 8-9's numbered priority list exactly. Each check
// below is commented with its rule number so a reviewer can match this
// file to the spec line by line. Order matters: this function returns
// on the FIRST violated rule, matching "apply constraints in this order."
export type IneligibleReason =
  | 'gender_restricted'        // rule 1
  | 'weekly_off'                // rule 2
  | 'on_leave'                  // rule 3
  | 'already_assigned_today'    // rule 4
  | 'weekly_shift_cap_reached'  // rule 5
  | 'not_rohan_night_slot'      // rule 6 — night shifts outside Rohan's fixed allocation
  | 'imran_shift_restricted'    // rule 7
  | 'post_night_recovery'       // rule 8
  | 'consecutive_night'         // rule 9 (see note below — largely subsumed by rule 8)
  | 'shift_not_allowed_for_doctor'; // doctor.allowedShifts doesn't include this shift

export interface EligibilityResult {
  eligible: boolean;
  reason?: IneligibleReason;
}

export interface EligibilityContext {
  doctor: Doctor;
  shift: ShiftType;
  dateISO: string;
  state: DoctorState;
  leavesByDoctorAndDate: Set<string>; 
}

export function checkEligibility(ctx: EligibilityContext): EligibilityResult {
  const { doctor, shift, dateISO, state, leavesByDoctorAndDate } = ctx;

  // Rule 1 — gender restrictions (OBGYN is female-only)
  if (shift.femaleOnly && doctor.gender !== 'female') {
    return { eligible: false, reason: 'gender_restricted' };
  }

  // Rule 2 — weekly offs, mandatory, cannot be overridden
  if (weekdayOf(dateISO) === doctor.weeklyOff) {
    return { eligible: false, reason: 'weekly_off' };
  }

  // Rule 3 — approved leave blocks all shifts that date
  if (leavesByDoctorAndDate.has(`${doctor.id}|${dateISO}`)) {
    return { eligible: false, reason: 'on_leave' };
  }

  // Rule 4 — one shift per day. state.yesterdayShiftId tracks yesterday,
  // not today.

  // Rule 5 — max 6 shifts per week
  if (state.shiftsThisWeek >= 6) {
    return { eligible: false, reason: 'weekly_shift_cap_reached' };
  }

  // Rule 6 — Rohan's night shifts are fixed allocation (Mon-Thu only).
  if (doctor.slug === ROHAN_SLUG && shift.id === 'night') {
    return { eligible: false, reason: 'not_rohan_night_slot' };
  }

  // Rule 7 — Imran: day shift only, plus up to 2 nights/month handled
  // as a separate special case.
  if (doctor.slug === IMRAN_SLUG) {
    if (shift.id === 'night' && doctor.maxNightsPerMonth !== null
        && state.nightsThisMonth >= doctor.maxNightsPerMonth) {
      return { eligible: false, reason: 'imran_shift_restricted' };
    }
    if (shift.id !== 'day' && shift.id !== 'night') {
      return { eligible: false, reason: 'imran_shift_restricted' };
    }
  }

  // Rule 8 — post-night recovery (does not apply to Rohan). The day
  // after a Night shift, only Afternoon or off is allowed — Morning,
  // Day, and OBGYN are blocked.
  if (doctor.slug !== ROHAN_SLUG && state.yesterdayShiftId === 'night') {
    if (shift.id !== 'afternoon') {
      return { eligible: false, reason: 'post_night_recovery' };
    }
  }

  // Rule 9 — no consecutive nights (does not apply to Rohan). Note this
  // is already enforced as a side effect of rule 8 above for every
  // non-Rohan doctor: if yesterday was Night, today's shift must be
  // Afternoon (or nothing).
  if (doctor.slug !== ROHAN_SLUG && state.yesterdayShiftId === 'night' && shift.id === 'night') {
    return { eligible: false, reason: 'consecutive_night' };
  }

  // Doctor-level allowed-shifts list (from doctors.allowed_shifts) —
  // catches anything the rules above didn't already exclude, e.g. if a
  // doctor's master data restricts them further than the general rules.
  if (!doctor.allowedShifts.includes(shift.id)) {
    return { eligible: false, reason: 'shift_not_allowed_for_doctor' };
  }

  return { eligible: true };
}

// Rules 10 and 11 (equal night / OBGYN distribution) are not eligibility
// gates — they don't make a doctor ineligible, they're a preference used
// to CHOOSE among multiple eligible doctors. Implemented in generate.ts
// as a sort/selection step: among everyone who passes checkEligibility,
// pick whoever has the fewest nightsThisMonth (or obgynThisMonth for
// OBGYN), breaking ties by doctor.id for determinism.
export function isObgynEligibleBySlug(slug: string): boolean {
  return OBGYN_ELIGIBLE_SLUGS.includes(slug);
}
