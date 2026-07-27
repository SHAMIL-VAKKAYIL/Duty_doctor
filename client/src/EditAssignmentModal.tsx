import { useState } from 'react';
import type { Assignment, Doctor } from './types';
import { SHIFT_LABELS } from './types';
import { updateAssignment } from './api';

interface Props {
  assignment: Assignment;
  doctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}

export default function EditAssignmentModal({ assignment, doctors, onClose, onSaved }: Props) {
  const [doctorId, setDoctorId] = useState<string>(assignment.doctorId ?? '');
  const [isShiftActive, setIsShiftActive] = useState(assignment.isShiftActive);
  const [note, setNote] = useState('');
  const [violation, setViolation] = useState<{ reason?: string; message?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(force: boolean) {
    setSaving(true);
    setViolation(null);
    try {
      const result = await updateAssignment(assignment.id, {
        doctorId: doctorId || null,
        isShiftActive,
        force,
        note: note || undefined,
      });
      if (result.ok) {
        onSaved();
        return;
      }
      // 409 rule violation — surfaced to the admin, not silently retried.
      setViolation({ reason: result.reason, message: result.message });
    } catch (err) {
      setViolation({ message: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const needsForceNote = Boolean(violation) && !note;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{SHIFT_LABELS[assignment.shiftTypeId]} Shift</h3>
        <div className="modal-sub">{assignment.assignmentDate}</div>

        {violation && (
          <div className="modal-error">
            {violation.message || `Rule violation: ${violation.reason}`}
          </div>
        )}

        <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setViolation(null); }}>
          <option value="">— Clear slot —</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={isShiftActive}
            onChange={(e) => setIsShiftActive(e.target.checked)}
          />
          Shift active this day
        </label>

        {violation && (
          <textarea
            placeholder="Note explaining why this override is needed (required to force)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {violation ? (
            <button
              className="primary"
              disabled={saving || needsForceNote}
              onClick={() => save(true)}
            >
              {saving ? 'Saving…' : 'Override anyway'}
            </button>
          ) : (
            <button className="primary" disabled={saving} onClick={() => save(false)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
