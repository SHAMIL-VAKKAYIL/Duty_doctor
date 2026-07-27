-- Duty Doctor Roster — Supabase schema (take-home reference)
-- Run in Supabase SQL Editor. Candidates must adapt/extend as needed.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE doctor_gender AS ENUM ('male', 'female');
CREATE TYPE weekday AS ENUM (
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
);

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  gender doctor_gender NOT NULL,
  weekly_off weekday NOT NULL,
  allowed_shifts TEXT[] NOT NULL DEFAULT ARRAY['morning', 'day', 'obgyn', 'afternoon', 'night'],
  max_nights_per_month INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shift_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  min_doctors INT NOT NULL DEFAULT 1,
  female_only BOOLEAN NOT NULL DEFAULT FALSE,
  retention_priority INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Monthly roster container
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL CHECK (year >= 2020),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

-- ---------------------------------------------------------------------------
-- Leaves (seed + admin-added)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id, leave_date)
);

-- ---------------------------------------------------------------------------
-- Assignments — persisted roster (auto-generated + manual overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_month_id UUID NOT NULL REFERENCES roster_months(id) ON DELETE CASCADE,
  assignment_date DATE NOT NULL,
  shift_type_id TEXT NOT NULL REFERENCES shift_types(id),
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  is_shift_active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'generated'
    CHECK (source IN ('generated', 'manual', 'cleared')),
  is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (roster_month_id, assignment_date, shift_type_id)
);

CREATE INDEX IF NOT EXISTS idx_roster_assignments_month_date
  ON roster_assignments (roster_month_id, assignment_date);

CREATE INDEX IF NOT EXISTS idx_doctor_leaves_date ON doctor_leaves (leave_date);

-- ---------------------------------------------------------------------------
-- Seed shift types
-- ---------------------------------------------------------------------------
INSERT INTO shift_types (id, name, starts_at, ends_at, min_doctors, female_only, retention_priority)
VALUES
  ('morning', 'Morning Shift', '08:00', '14:00', 1, FALSE, 2),
  ('day', 'Day Shift', '10:00', '18:00', 1, FALSE, 4),
  ('obgyn', 'OBGYN Shift', '10:00', '18:00', 1, TRUE, 5),
  ('afternoon', 'Afternoon Shift', '14:00', '20:00', 1, FALSE, 3),
  ('night', 'Night Shift', '20:00', '08:00', 1, FALSE, 1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed fictional doctors (section 2 of task spec)
-- ---------------------------------------------------------------------------
INSERT INTO doctors (slug, name, gender, weekly_off, allowed_shifts, max_nights_per_month, notes)
VALUES
  ('meera', 'Dr. Meera Kapoor', 'female', 'wednesday',
    ARRAY['morning', 'day', 'obgyn', 'afternoon', 'night'], NULL,
    'Subject to post-night recovery rule'),
  ('rohan', 'Dr. Rohan Khanna', 'male', 'friday',
    ARRAY['morning', 'afternoon', 'night'], NULL,
    'Exempt from post-night recovery; consecutive nights allowed'),
  ('aditya', 'Dr. Aditya Nair', 'male', 'thursday',
    ARRAY['morning', 'day', 'obgyn', 'afternoon', 'night'], NULL,
    'Subject to post-night recovery rule'),
  ('priya', 'Dr. Priya Sharma', 'female', 'tuesday',
    ARRAY['morning', 'day', 'obgyn', 'afternoon', 'night'], NULL,
    'Subject to post-night recovery rule'),
  ('imran', 'Dr. Imran Siddiqui', 'male', 'sunday',
    ARRAY['day', 'night'], 2,
    'Day shift preferred; subject to post-night recovery rule'),
  ('kavya', 'Dr. Kavya Menon', 'female', 'saturday',
    ARRAY['morning', 'day', 'obgyn', 'afternoon', 'night'], NULL,
    'Subject to post-night recovery rule')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed 4 leave days (section 3a — June 2026)
-- ---------------------------------------------------------------------------
INSERT INTO doctor_leaves (doctor_id, leave_date, reason)
SELECT d.id, v.leave_date::DATE, 'Seed leave'
FROM (VALUES
  ('meera', '2026-06-05'),
  ('aditya', '2026-06-12'),
  ('priya', '2026-06-19'),
  ('kavya', '2026-06-23')
) AS v(slug, leave_date)
JOIN doctors d ON d.slug = v.slug
ON CONFLICT (doctor_id, leave_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS (service role / API access — tighten for production)
-- ---------------------------------------------------------------------------
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON doctors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON shift_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON roster_months FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON doctor_leaves FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON roster_assignments FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE roster_assignments IS
  'One row per date + shift. Manual overrides set is_manual_override=true and source=manual.';
