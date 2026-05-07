# Scout — past day navigation

Add a back/forward arrow system so the page can show past days. Today's view stays exactly as it is. Past days get a slim header (just the date) and no Run Now / no polling / no run cost line.

This is a small, contained change. Don't touch the script, the schema, the workflow, or any of the data layer beyond a single SQL tweak in `/api/latest`.

## Behaviour

**Live view (default, URL `/`)** — unchanged. Full "Morning, Ben" header, "Last scanned…" line, "This run: N tokens · ~$X" line, Run Now button, polling. *Add* a single `←` arrow below the header that navigates to `/?date=YYYY-MM-DD` where the date is yesterday in UTC.

**Archive view (URL `/?date=YYYY-MM-DD`)** — slim header. Just the date in big type, formatted "Wednesday, 6 May 2026" (`en-GB`, UTC timezone, full weekday + day + month + year). Below it, two arrows: `←` and `→`. No Run Now button, no last-scanned line, no run cost line, no polling.

**Arrow behaviour**

- `←` steps back one UTC day. Disabled (greyed, non-clickable) when the current viewed date equals `earliest_run_date` from the API. On live view, `←` is always enabled if any runs exist at all.
- `→` steps forward one UTC day. Only present in archive view (today's live view doesn't show it). When the next day equals today's UTC date, the arrow navigates to `/` (drops the date param entirely — back to live view).
- All navigation is `window.location.href = ...` per CLUES, not `router.push`.

**Empty-day placeholder.** If the URL date has no run in the database, the archive view shows the date header + arrows + a centred placeholder reading "No run on this day." Nothing else. Ratings, failure banner, etc. don't apply. Arrows still navigate normally.

**Failed-day handling.** If a past day's run failed, show the existing failure banner (same component as live view) below the date header. Arrows still work normally.

**URL guards (in `app/page.tsx` server component).**

- If `?date=` equals today's UTC date → redirect to `/`
- If `?date=` is in the future (UTC) → redirect to `/`
- If `?date=` is malformed (not `YYYY-MM-DD`, or `new Date('${date}T00:00:00Z')` is invalid) → redirect to `/`

Use `redirect()` from `next/navigation` for these.

## API change — `app/api/latest/route.ts`

Accept an optional `date` query param (`YYYY-MM-DD`).

- If absent: behaviour as today (latest run, latest run's items).
- If present: return the latest run whose `DATE(ran_at AT TIME ZONE 'UTC') = $1::date`, plus that run's items. If no run matches, return `{ run: null, items: [] }` (with the rest of the response shape preserved).

Add a new field to the response in both cases: `earliest_run_date` — the earliest UTC date of any run in the database. SQL:

```sql
SELECT TO_CHAR(MIN(ran_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS earliest
FROM runs
```

If no runs exist at all, `earliest_run_date` is `null`.

The query for the date-filtered run:

```sql
SELECT [existing columns]
FROM runs
WHERE DATE(ran_at AT TIME ZONE 'UTC') = $1::date
ORDER BY ran_at DESC
LIMIT 1
```

## `lib/types.ts`

Add `earliest_run_date: string | null` to `LatestResponse`. Allow `run: RunRow | null` if it isn't already.

## `app/page.tsx`

Server component. Read `searchParams.date`. Apply the URL guards above. Pass the date through to the `/api/latest` fetch URL as a query param when present. Pass `viewDate` (string or null) and `isLive` (boolean) into Shell as props.

## `app/Shell.tsx`

The bulk of the work. Two modes driven by props:

- `isLive === true` → existing rendering, plus a `←` button below the existing header (or wherever fits the design — small, subtle, not competing with Run Now).
- `isLive === false` → archive header (date in big type using the existing serif heading style; ditch the "Morning, Ben" line, the last-scanned line, and the cost line); both arrows below; no Run Now button; no polling (don't start the interval).

Use a small helper for date arithmetic, native only, no libraries:

```ts
function shiftDateUTC(yyyymmdd: string, deltaDays: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatArchiveDate(yyyymmdd: string): string {
  return new Date(`${yyyymmdd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
```

Arrow click handlers compute the target URL and assign to `window.location.href`. The forward arrow checks whether the next day equals `todayUTC()` and uses `/` if so.

Back-arrow disabled state: when `viewDate === data.earliest_run_date` (in archive mode) or when `data.earliest_run_date === null` (no runs at all). Render as a non-clickable, faded element.

## Styling — `app/globals.css`

Add minimal styling for:
- `.date-header` — large serif date for archive mode, matching the existing heading style.
- `.day-nav` — flex row containing the arrows, centred under the header, ~24px tall, generous spacing between left and right arrows.
- `.day-nav button` — bare-bones button (no background, just the arrow character), with a hover state and a `:disabled` faded state at ~30% opacity.
- `.empty-day` — centred placeholder for the no-run-on-this-day state, similar feel to `.empty-state` but with its own copy.

Use the existing OKLCH palette and design tokens. Don't introduce any new colour variables.

## Don't add

- A "Today" jump button. Forward arrows step one day at a time; the spec is intentional.
- A calendar date picker. Arrows only.
- Any kind of multi-run-per-day stepping. Latest run for a date only.
- Any change to the `runs` or `items` schema.
- Any new dependency.

## Verify and ship

1. `npm run build` — no TypeScript errors.
2. Manual check (locally or by reading the flow): visit `/`, click `←`, land on `/?date=<yesterday>` with slim header. Click `→`, land back on `/`. Hand-edit URL to a far-past date, verify empty-day placeholder. Hand-edit URL to today's date, verify redirect to `/`. Hand-edit URL to a future or malformed date, verify redirect to `/`.
3. Delete `SCOUT_ARCHIVE_PROMPT.md` from the repo root and remove the **ACTIVE TASK** banner at the top of `CLAUDE.md`.
4. Commit on `main`: `feat: past day navigation with back/forward arrows`.
