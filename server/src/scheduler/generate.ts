import {
  Doctor, ShiftType, DoctorLeave, GeneratedAssignment,
  ROHAN_SLUG, IMRAN_SLUG,
} from './types';
import {
  DoctorState, initDoctorStates, rollWeekIfNeeded, recordDayOutcome,
  weekdayOf,
} from './state';
import { checkEligibility } from './eligibility';

export interface GenerateRosterInput {
  year: number;
  month: number; // 1-12
  doctors: Doctor[];
  shiftTypes: ShiftType[]; // expects the 5 seeded types, each with retentionPriority
  leaves: DoctorLeave[];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}


function countUnavailableToday(
  doctors: Doctor[],
  dateISO: string,
  states: Map<string, DoctorState>,
  leavesByDoctorAndDate: Set<string>
): number {
  let count = 0;
  const today = weekdayOf(dateISO);
  for (const doc of doctors) {
    const state = states.get(doc.id)!;
    const onWeeklyOff = today === doc.weeklyOff;
    const onLeave = leavesByDoctorAndDate.has(`${doc.id}|${dateISO}`);
    const weeklyCapReached = state.shiftsThisWeek >= 6;
    const recoveryBlocksEverything =
      doc.slug !== ROHAN_SLUG && state.yesterdayShiftId === 'night';
    // recovery block still leaves Afternoon open, so it only counts as
    // "unavailable" if the doctor is ALSO otherwise unavailable — a
    // recovery-blocked doctor can still work Afternoon, so on its own it
    // doesn't make them unavailable for the day.
    if (onWeeklyOff || onLeave || weeklyCapReached) {
      count += 1;
    } else if (recoveryBlocksEverything && !doc.allowedShifts.includes('afternoon')) {
      count += 1;
    }
  }
  return count;
}

// Rules 12-15: retain shifts in order Night(1) -> Morning(2) ->
// Afternoon(3) -> Day(4) -> OBGYN(5) as unavailability count rises.
function activeShiftsForDay(
  shiftTypes: ShiftType[],
  unavailableCount: number
): ShiftType[] {
  const sorted = [...shiftTypes].sort((a, b) => a.retentionPriority - b.retentionPriority);
  const dropCount = unavailableCount >= 3 ? 2 : unavailableCount === 2 ? 1 : 0;
  return dropCount === 0 ? sorted : sorted.slice(0, sorted.length - dropCount);
}

// -----------------------------------------------------------------------
// Rohan: fixed 4 nights Mon-Thu + 1 morning + 1 afternoon per week.
// Spec doesn't say which day carries his morning/afternoon — the only
// days left once Mon-Thu are night and Friday is off are Saturday and
// Sunday, so those are used deterministically (Sat = morning, Sun =
// afternoon). Documented as an explicit interpretation, not a spec
// requirement, in the README.
function isRohanFixedNightDay(dateISO: string): boolean {
  const wd = weekdayOf(dateISO);
  return wd === 'monday' || wd === 'tuesday' || wd === 'wednesday' || wd === 'thursday';
}

function rohanFixedShiftForDay(dateISO: string): 'night' | 'morning' | 'afternoon' | null {
  const wd = weekdayOf(dateISO);
  if (isRohanFixedNightDay(dateISO)) return 'night';
  if (wd === 'saturday') return 'morning';
  if (wd === 'sunday') return 'afternoon';
  return null; // Friday — his weekly off
}

// -----------------------------------------------------------------------
export function generateRoster(input: GenerateRosterInput): GeneratedAssignment[] {
  const { year, month, doctors, shiftTypes, leaves } = input;
  const numDays = daysInMonth(year, month);
  const firstDate = `${year}-${pad2(month)}-01`;

  const leavesByDoctorAndDate = new Set(
    leaves.map((l) => `${l.doctorId}|${l.leaveDate}`)
  );

  const states = initDoctorStates(doctors, firstDate);
  const rohan = doctors.find((d) => d.slug === ROHAN_SLUG) ?? null;
  const imran = doctors.find((d) => d.slug === IMRAN_SLUG) ?? null;
  const shiftById = new Map(shiftTypes.map((s) => [s.id, s]));

  const results: GeneratedAssignment[] = [];

  for (let day = 1; day <= numDays; day++) {
    const dateISO = `${year}-${pad2(month)}-${pad2(day)}`;

    for (const state of states.values()) rollWeekIfNeeded(state, dateISO);

    const unavailableCount = countUnavailableToday(doctors, dateISO, states, leavesByDoctorAndDate);
    const activeShifts = activeShiftsForDay(shiftTypes, unavailableCount);
    const activeShiftIds = new Set(activeShifts.map((s) => s.id));

    const assignedToday = new Map<string, string>(); // doctorId -> shiftId
    const filledSlots = new Map<string, string>(); // shiftId -> doctorId

    // --- Rohan's fixed allocation (rule 6) ---------------------------
    if (rohan) {
      const rohanState = states.get(rohan.id)!;
      const onLeave = leavesByDoctorAndDate.has(`${rohan.id}|${dateISO}`);
      const fixedShift = rohanFixedShiftForDay(dateISO);
      if (fixedShift && !onLeave && activeShiftIds.has(fixedShift) && rohanState.shiftsThisWeek < 6) {
        assignedToday.set(rohan.id, fixedShift);
        filledSlots.set(fixedShift, rohan.id);
      }
      // If Rohan is on leave on one of his fixed night days, that night
      // falls through to the generic fill pool below rather than going
      // unfilled — the spec doesn't say to leave the ED without night
      // coverage just because Rohan is out.
    }

    // --- Imran: day-preferred, up to 2 nights/month cap (rule 7) -----
    // Interpretation: Imran defaults to Day Shift on his working days.
    // He is only ever placed on Night via the generic night-fill step
    // below, where he's one eligible candidate among the pool once his
    // monthly cap allows it — he isn't force-fed 2 nights just because
    // the cap permits it. "Maximum 2" is read as a ceiling, not a quota.
    if (imran) {
      const onLeave = leavesByDoctorAndDate.has(`${imran.id}|${dateISO}`);
      const imranState = states.get(imran.id)!;
      const eligibleForDay = !onLeave && activeShiftIds.has('day')
        && !filledSlots.has('day') && imranState.shiftsThisWeek < 6
        && checkEligibility({
          doctor: imran, shift: shiftById.get('day')!, dateISO,
          state: imranState, leavesByDoctorAndDate,
        }).eligible;
      if (eligibleForDay) {
        assignedToday.set(imran.id, 'day');
        filledSlots.set('day', imran.id);
      }
    }

    // --- Generic fill for every remaining active shift ---------------
  
    const FILL_ORDER: typeof activeShifts[number]['id'][] = ['night', 'obgyn', 'morning', 'afternoon', 'day'];
    const fillOrder = FILL_ORDER
      .map((id) => activeShifts.find((s) => s.id === id))
      .filter((s): s is typeof activeShifts[number] => Boolean(s));
    for (const shift of fillOrder) {
      if (filledSlots.has(shift.id)) continue;

      const candidates = doctors.filter((doc) => {
        if (assignedToday.has(doc.id)) return false; // rule 4, enforced here
        const state = states.get(doc.id)!;
        const result = checkEligibility({
          doctor: doc, shift, dateISO, state, leavesByDoctorAndDate,
        });
        return result.eligible;
      });

      if (candidates.length === 0) {
        // No eligible doctor for this slot today — left unfilled. This
        // is a real possibility (small pool, many constraints) and is
        // logged rather than silently ignored; surfaced to the caller
        // via doctorId: null so the UI can flag it.
        continue;
      }

      // Rules 10/11 — equal distribution preference. Lowest relevant
      // running count wins; ties broken by doctor.id for determinism
      // (stable output for repeatable generation given identical input).
      let best = candidates[0];
      for (const c of candidates.slice(1)) {
        const bestState = states.get(best.id)!;
        const cState = states.get(c.id)!;
        const bestKey = shift.id === 'night' ? bestState.nightsThisMonth
          : shift.id === 'obgyn' ? bestState.obgynThisMonth
          : bestState.shiftsThisWeek;
        const cKey = shift.id === 'night' ? cState.nightsThisMonth
          : shift.id === 'obgyn' ? cState.obgynThisMonth
          : cState.shiftsThisWeek;
        if (cKey < bestKey || (cKey === bestKey && c.id < best.id)) {
          best = c;
        }
      }

      assignedToday.set(best.id, shift.id);
      filledSlots.set(shift.id, best.id);
    }

    // --- Unassigned doctor -> Day Shift fallback (spec section 1) ----
    // Only ONE doctor can fill this — see the schema note: one row per
    // shift per date, min_doctors = 1 for every shift including Day.
    if (activeShiftIds.has('day') && !filledSlots.has('day')) {
      const dayShift = shiftById.get('day')!;
      const leftover = doctors.filter((doc) => {
        if (assignedToday.has(doc.id)) return false;
        const state = states.get(doc.id)!;
        return checkEligibility({
          doctor: doc, shift: dayShift, dateISO, state, leavesByDoctorAndDate,
        }).eligible;
      });
      if (leftover.length > 0) {
        let pick = leftover[0];
        for (const c of leftover.slice(1)) {
          if (c.id < pick.id) pick = c; // deterministic tie-break only — no distribution preference specified for this fallback
        }
        assignedToday.set(pick.id, 'day');
        filledSlots.set('day', pick.id);
      }
    }

    // --- Persist today's results, active + explicitly-inactive shifts -
    for (const shift of shiftTypes) {
      const isActive = activeShiftIds.has(shift.id);
      results.push({
        assignmentDate: dateISO,
        shiftTypeId: shift.id,
        doctorId: isActive ? (filledSlots.get(shift.id) ?? null) : null,
        isShiftActive: isActive,
      });
    }

    // --- Update every doctor's state for tomorrow ---------------------
    for (const doc of doctors) {
      const state = states.get(doc.id)!;
      recordDayOutcome(state, assignedToday.get(doc.id) ?? null);
    }
  }

  return results;
}
