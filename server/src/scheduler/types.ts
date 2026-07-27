export type ShiftId = 'morning' | 'day' | 'obgyn' | 'afternoon' | 'night';

export type Weekday =
  | 'sunday' | 'monday' | 'tuesday' | 'wednesday'
  | 'thursday' | 'friday' | 'saturday';

export interface Doctor {
  id: string;  
  slug: string; 
  name: string;
  gender: 'male' | 'female';
  weeklyOff: Weekday;
  allowedShifts: ShiftId[];
  maxNightsPerMonth: number | null;
}

export interface ShiftType {
  id: ShiftId;
  name: string;
  minDoctors: number;
  femaleOnly: boolean;
  retentionPriority: number; 
}

export interface DoctorLeave {
  doctorId: string;
  leaveDate: string; 
}

export interface ExistingAssignment {
  id: string;
  assignmentDate: string;
  shiftTypeId: ShiftId;
  doctorId: string | null;
  isShiftActive: boolean;
  source: 'generated' | 'manual' | 'cleared';
  isManualOverride: boolean;
}


export interface GeneratedAssignment {
  assignmentDate: string;
  shiftTypeId: ShiftId;
  doctorId: string | null; 
  isShiftActive: boolean;
}


export const ROHAN_SLUG = 'rohan';
export const IMRAN_SLUG = 'imran';

export const OBGYN_ELIGIBLE_SLUGS = ['meera', 'priya', 'kavya'];
