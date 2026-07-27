import { Doctor, Weekday } from './types';


export function getWeekStart(dateISO: string): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_NAMES: Weekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

export function weekdayOf(dateISO: string): Weekday {
  const d = new Date(dateISO + 'T00:00:00Z');
  return WEEKDAY_NAMES[d.getUTCDay()];
}

export function addDays(dateISO: string, n: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}



export interface DoctorState {
  doctorId: string;
  currentWeekStart: string; 
  shiftsThisWeek: number;
  nightsThisWeek: number;
  nightsThisMonth: number;
  obgynThisMonth: number;
  yesterdayShiftId: string | null;
}

export function initDoctorStates(
  doctors: Doctor[],
  firstDateOfMonth: string
): Map<string, DoctorState> {
  const weekStart = getWeekStart(firstDateOfMonth);
  const states = new Map<string, DoctorState>();
  for (const doc of doctors) {
    states.set(doc.id, {
      doctorId: doc.id,
      currentWeekStart: weekStart,
      shiftsThisWeek: 0,
      nightsThisWeek: 0,
      nightsThisMonth: 0,
      obgynThisMonth: 0,
      yesterdayShiftId: null,
    });
  }
  return states;
}

export function rollWeekIfNeeded(state: DoctorState, currentDateISO: string): void {
  const weekStart = getWeekStart(currentDateISO);
  if (weekStart !== state.currentWeekStart) {
    state.currentWeekStart = weekStart;
    state.shiftsThisWeek = 0;
    state.nightsThisWeek = 0;
  }
}


export function recordDayOutcome(
  state: DoctorState,
  shiftIdAssignedToday: string | null
): void {
  if (shiftIdAssignedToday) {
    state.shiftsThisWeek += 1;
    if (shiftIdAssignedToday === 'night') {
      state.nightsThisWeek += 1;
      state.nightsThisMonth += 1;
    }
    if (shiftIdAssignedToday === 'obgyn') {
      state.obgynThisMonth += 1;
    }
  }
  state.yesterdayShiftId = shiftIdAssignedToday;
}
