import type { Doctor, RosterResponse } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || `Request failed (${res.status})`);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { status?: number; body?: unknown }).body = body;
    throw err;
  }
  return body as T;
}

export async function fetchDoctors(): Promise<Doctor[]> {
  const res = await fetch(`${API_BASE}/api/doctors`);
  return handle<Doctor[]>(res);
}

export async function fetchRoster(year: number, month: number): Promise<RosterResponse> {
  const res = await fetch(`${API_BASE}/api/roster/${year}/${month}`);
  return handle<RosterResponse>(res);
}

export async function generateRoster(
  year: number, month: number, resetManualOverrides = false
): Promise<{ ok: boolean; written: number; skippedManualOverrides: number }> {
  const res = await fetch(`${API_BASE}/api/roster/${year}/${month}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resetManualOverrides }),
  });
  return handle(res);
}

export async function updateAssignment(
  assignmentId: string,
  update: { doctorId: string | null; isShiftActive?: boolean; force?: boolean; note?: string }
): Promise<{ ok: boolean; reason?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/api/roster/assignments/${assignmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  // Deliberately not using handle() here — a 409 rule violation is an
  // expected, meaningful response the UI needs to read (reason/message),
  // not just an error to throw and swallow.
  const body = await res.json();
  return { ok: res.ok, ...body };
}
