# Duty Doctor Roster

Constraint-based monthly roster generator for a hospital emergency department, built for the PARAM Healthcare full-stack take-home.

**Live app:** https://duty-doctor-nu.vercel.app
**API:** https://duty-doctor-x4at.vercel.app
**Repo:** https://github.com/SHAMIL-VAKKAYIL/Duty_doctor

---

## Stack

- **Backend:** Node.js + TypeScript + Express, deployed as a Vercel serverless function
- **Database:** Supabase (Postgres), accessed via raw parameterized SQL through `pg` — no ORM
- **Frontend:** React + TypeScript (Vite), deployed as a static Vercel site
- **AI tooling:** Used during development (see "AI tool usage" below). No AI/LLM API is called anywhere in the submitted application at runtime.

## Project structure

```
backend/    Express API, scheduler, raw SQL queries
client/     React frontend
supabase/   Schema + seed data (run this first)
```

## Setup

### 1. Database

Run `supabase/duty-doctor-roster-schema.sql` in your Supabase project's SQL Editor (paste the whole file, top to bottom — it includes the DDL and the seed data for the 6 doctors, 5 shift types, and 4 seed leave days from spec section 3a).

Verify the seed landed:
```sql
select count(*) from doctors;        -- 6
select count(*) from shift_types;    -- 5
select count(*) from doctor_leaves;  -- 4
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL with Supabase's TRANSACTION POOLER connection
# string (Project Settings → Connect → Direct Connection panel →
# "Transaction pooler", not "Direct connection" — the direct-connection
# limit is exhausted quickly under a serverless deploy where each
# invocation can open a new connection).
npm install
npm run dev
# confirm: curl http://localhost:3001/api/health
# should return {"ok":true,"dbTime":"..."}
```

### 3. Frontend

```bash
cd client
cp .env.example .env
# VITE_API_BASE_URL defaults to http://localhost:3001 for local dev;
# set it to the deployed backend URL for production builds.
npm install
npm run dev
```

## Deploying

Both `backend/` and `client/` deploy as separate Vercel projects.

- **Backend:** Vercel project rooted at `backend/`. Set `DATABASE_URL` as an environment variable in the Vercel dashboard (same pooler connection string as local `.env`).
- **Frontend:** Vercel project rooted at `client/`. Set `VITE_API_BASE_URL` to the backend's deployed URL.

## The scheduling algorithm

`backend/src/scheduler/` — the actual generation logic, built as a pure function (`generateRoster`) that takes doctors/shifts/leaves and returns assignments, entirely separate from the API and database layers so it can be reasoned about (and tested) in isolation.

Walks the month day by day, in this order per day:

1. **Rohan's fixed allocation** — 4 nights (Mon–Thu) + 1 morning + 1 afternoon per week, assigned directly rather than through the generic pool (see "Assumptions" below for which days carry his morning/afternoon).
2. **Imran's day-preferred allocation** — defaults to Day Shift on his working days; only ever placed on Night through the generic fill step below, when his monthly cap allows it.
3. **Generic fill**, in a deliberate order: **Night → OBGYN → Morning → Afternoon → Day.** OBGYN is filled early (right after Night) because it has the smallest eligible pool (3 doctors) — filling Morning/Afternoon first would let them consume an OBGYN-eligible doctor's one-shift-per-day slot before OBGYN is even considered, skewing distribution. (This was an actual bug caught and fixed during development — see git history / commit messages.)
4. **Unassigned-doctor → Day Shift fallback** (spec section 1) — note this can only ever fill **one** doctor, because the schema enforces one row per shift per date (`min_doctors = 1` for every shift type including Day).
5. **Reduced-staffing shift removal** (rules 12–15) — computed once per day, before the fill steps above run, based on a department-wide unavailability count (see "Assumptions").

Rules 10/11 (equal night/OBGYN distribution) aren't eligibility gates — they're a preference used to choose among multiple already-eligible doctors each time a shift is filled (lowest running count wins, ties broken by doctor ID for deterministic output).

## Assumptions

The spec has a few genuinely ambiguous points. Documented here rather than silently resolved, since a different reader could reasonably land on either answer:

- **Week boundary = Monday–Sunday.** Not stated explicitly, but it's the only boundary consistent with Rohan's "4 nights Mon–Thu" rule. June 2026 happens to start on a Monday, so this month has no partial-week edge case, but the assumption would matter for other months.
- **Reduced-staffing trigger is department-wide, not shift-scoped.** "Unavailable" (rules 12–15) is counted across all 6 doctors, not scoped to whichever specific doctors are relevant to the shift being considered for removal. Read as a general staffing-pressure cascade — fewer hands available for *any* reason means the department runs fewer total shifts, dropping the lowest-`retention_priority` one first — the way a real department sheds lower-priority services under staffing pressure regardless of which specific staff are out. An equally defensible alternative reading would scope the count to only the doctors relevant to the shift being dropped.
- **"Unavailable" itself is the pre-assignment subset**: weekly off, approved leave, weekly 6-shift cap already reached, or a recovery block that excludes every non-Afternoon shift. The spec's own list also includes "same-day conflict" and "ineligible shift," but those are only knowable *after* that day's assignments are made — using them would make the check circular (today's staffing level would depend on today's assignments, which depend on today's staffing level).
- **Rohan's weekly Morning/Afternoon days.** The spec doesn't say which day of the week carries his 1 Morning + 1 Afternoon shift. With Mon–Thu fixed to Night and Friday off, only Saturday and Sunday remain — Saturday is used for Morning, Sunday for Afternoon.
- **Imran's night-shift cap is a ceiling, not a quota.** "Maximum 2 Night shifts per month" is read as "never more than 2," not "exactly 2 every month." He is only placed on Night through the generic fill step, when the pool is otherwise short — he isn't force-fed 2 nights just because the cap allows it.
- **"Unassigned doctor → Day Shift" can only fill one doctor**, a direct consequence of the schema's `UNIQUE (roster_month_id, assignment_date, shift_type_id)` constraint combined with every shift's `min_doctors = 1`. If three doctors are unassigned after mandatory allocation, only one can take the single Day Shift slot; the others get no shift that date.

## Manual overrides and regeneration

- Editing a cell in the UI calls `PATCH /api/roster/assignments/:id`, which re-validates the pick against the same rule engine the generator uses (`checkEligibility` — one shared implementation, not a duplicated copy).
- A rule violation returns `409` with a reason and message; nothing is written. The UI surfaces this inline and offers an explicit "Override anyway" action, which requires a note explaining why, before it will force the write.
- Any row saved this way is flagged `is_manual_override = true`, `source = 'manual'`.
- Regenerating a month (`POST /api/roster/:year/:month/generate`) **skips any row flagged `is_manual_override = true`**, both in application code and as a second, independent guard in the SQL itself (`WHERE is_manual_override = FALSE` on the upsert) — belt-and-suspenders, since this is a hard requirement, not a nice-to-have.
- Passing `{"resetManualOverrides": true}` in the generate request body is the only way to clear that protection and let a fresh generation overwrite manual picks for that month.

## AI tool usage

This project was built with GitHub Copilot for scaffolding assistance and Claude for architecture discussion, rule-by-rule algorithm design, and debugging (including catching and fixing a real distribution bug in the OBGYN fill order — see commit history). No AI/LLM API is called by the submitted application itself at runtime; all scheduling logic is deterministic TypeScript.

## Known limitations

- No authentication/authorization on the API — out of scope for this take-home, but the `roster_assignments` schema's RLS policies are currently "allow all" and would need real policies before any production use.
- No automated test suite; the generator was verified by running it against the real seed data and manually tallying distribution counts and rule compliance
