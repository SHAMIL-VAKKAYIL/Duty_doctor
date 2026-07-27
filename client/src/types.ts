export type ShiftId = 'morning' | 'day' | 'obgyn' | 'afternoon' | 'night';

export interface Doctor {
  id: string;
  slug: string;
  name: string;
  gender: 'male' | 'female';
  weeklyOff: string;
  allowedShifts: ShiftId[];
  maxNightsPerMonth: number | null;
}

export interface Assignment {
  id: string;
  assignmentDate: string; // ISO date
  shiftTypeId: ShiftId;
  doctorId: string | null;
  isShiftActive: boolean;
  source: 'generated' | 'manual' | 'cleared';
  isManualOverride: boolean;
}

export interface RosterResponse {
  generatedAt: string | null;
  assignments: Assignment[];
}

export const SHIFT_ORDER: ShiftId[] = ['morning', 'day', 'obgyn', 'afternoon', 'night'];

export const SHIFT_LABELS: Record<ShiftId, string> = {
  morning: 'Morning',
  day: 'Day',
  obgyn: 'OBGYN',
  afternoon: 'Afternoon',
  night: 'Night',
};
