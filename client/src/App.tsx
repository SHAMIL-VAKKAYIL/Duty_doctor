import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Assignment, Doctor } from './types';
import { SHIFT_ORDER, SHIFT_LABELS } from './types';
import { fetchDoctors, fetchRoster, generateRoster } from './api';
import EditAssignmentModal from './EditAssignmentModal';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function weekdayShort(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export default function App() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(6);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doctorById = useMemo(() => {
    const m = new Map<string, Doctor>();
    for (const d of doctors) m.set(d.id, d);
    return m;
  }, [doctors]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, roster] = await Promise.all([
        fetchDoctors(),
        fetchRoster(year, month),
      ]);
      setDoctors(docs);
      setAssignments(roster.assignments);
      setGeneratedAt(roster.generatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const assignmentMap = useMemo(() => {
    const m = new Map<string, Assignment>(); // key: date|shiftId
    for (const a of assignments) m.set(`${a.assignmentDate}|${a.shiftTypeId}`, a);
    return m;
  }, [assignments]);

  const hasManualOverrides = assignments.some((a) => a.isManualOverride);

  async function handleGenerate() {
    if (hasManualOverrides) {
      const proceed = window.confirm(
        'This month has manual overrides. Regenerating will keep them untouched ' +
        'unless you choose to reset. Click OK to regenerate (overrides preserved), ' +
        'or Cancel to stop.'
      );
      if (!proceed) return;
    }
    setGenerating(true);
    setError(null);
    try {
      await generateRoster(year, month, false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate roster');
    } finally {
      setGenerating(false);
    }
  }

  const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Duty Doctor Roster</h1>
          <div className="subtitle">Emergency department monthly scheduling</div>
        </div>
        <div className="controls">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })}
              </option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate roster'}
          </button>
        </div>
      </header>

      <div className="status-line">
        {generatedAt ? `Last generated ${new Date(generatedAt).toLocaleString()}` : 'Not yet generated for this month'}
        {error && <span style={{ color: 'var(--danger)', marginLeft: 12 }}>{error}</span>}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="grid-scroll">
          <table className="roster">
            <thead>
              <tr>
                <th className="date-col">Date</th>
                {SHIFT_ORDER.map((s) => <th key={s}>{SHIFT_LABELS[s]}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const date = isoDate(year, month, day);
                return (
                  <tr key={date}>
                    <td className="date-col">{day} {weekdayShort(year, month, day)}</td>
                    {SHIFT_ORDER.map((shiftId) => {
                      const a = assignmentMap.get(`${date}|${shiftId}`);
                      const doctor = a?.doctorId ? doctorById.get(a.doctorId) : null;
                      const inactive = a ? !a.isShiftActive : false;
                      const empty = a ? a.isShiftActive && !a.doctorId : false;

                      const classes = ['cell-inner'];
                      if (a?.isManualOverride) classes.push('override');
                      if (inactive) classes.push('inactive');
                      if (empty) classes.push('empty');

                      return (
                        <td key={shiftId}>
                          <div
                            className={classes.join(' ')}
                            onClick={() => a && setEditing(a)}
                          >
                            {!a ? (
                              <span className="doctor-name">—</span>
                            ) : inactive ? (
                              <span className="doctor-name">Not staffed</span>
                            ) : empty ? (
                              <span className="doctor-name">Unfilled</span>
                            ) : (
                              <span className="doctor-name">{doctor?.name ?? '—'}</span>
                            )}
                            {a?.isManualOverride && <span className="override-flag">MANUAL</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditAssignmentModal
          assignment={editing}
          doctors={doctors}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}
