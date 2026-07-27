import { Doctor, ShiftType } from './types';
import { checkEligibility, EligibilityResult } from './eligibility';
import { getWeekStart, addDays, DoctorState } from './state';
import {
  isDoctorOnLeave, countShiftsThisWeek, countNightsThisMonth,
  fetchDoctorShiftOnDate, doctorHasOtherShiftSameDay,
} from '../db/queries';

export interface ManualOverrideValidation {
  eligible: boolean;
  reason?: EligibilityResult['reason'] | 'already_assigned_today';
}

// Reconstructs only what checkEligibility needs for ONE doctor on ONE
// date, from persisted rows — deliberately not the full month-long walk
// generate.ts does, since re-validating a single manual edit shouldn't
// require regenerating the whole month's state just to check one cell.
export async function validateManualOverride(
  doctor: Doctor,
  shift: ShiftType,
  dateISO: string,
  rosterMonthId: string,
  assignmentId: string // excluded from all the counts below — we're
                        // re-validating what THIS row would become, not
                        // counting its own prior value against itself
): Promise<ManualOverrideValidation> {
  // Rule 4 first — this is the one check checkEligibility deliberately
  // does NOT cover (see eligibility.ts comment), since it needs
  // same-day visibility across shifts that checkEligibility's
  // per-doctor state doesn't carry.
  const sameDayConflict = await doctorHasOtherShiftSameDay(
    doctor.id, rosterMonthId, dateISO, assignmentId
  );
  if (sameDayConflict) {
    return { eligible: false, reason: 'already_assigned_today' };
  }

  const weekStart = getWeekStart(dateISO);
  const weekEnd = addDays(weekStart, 6);

  const [shiftsThisWeek, nightsThisMonth, yesterdayShiftId, onLeave] = await Promise.all([
    countShiftsThisWeek(doctor.id, rosterMonthId, weekStart, weekEnd, assignmentId),
    countNightsThisMonth(doctor.id, rosterMonthId, assignmentId),
    fetchDoctorShiftOnDate(doctor.id, rosterMonthId, addDays(dateISO, -1)),
    isDoctorOnLeave(doctor.id, dateISO),
  ]);

  const state: DoctorState = {
    doctorId: doctor.id,
    currentWeekStart: weekStart,
    shiftsThisWeek,
    nightsThisWeek: 0, // not needed by any check in eligibility.ts
    nightsThisMonth,
    obgynThisMonth: 0, // rules 10/11 are preferences, not validity gates
    yesterdayShiftId,
  };

  const leavesByDoctorAndDate = new Set(onLeave ? [`${doctor.id}|${dateISO}`] : []);

  const result = checkEligibility({ doctor, shift, dateISO, state, leavesByDoctorAndDate });
  return result;
}
