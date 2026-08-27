# Storage design: the decision

Two designs were explored in parallel. `design-a.md` promotes columns and reaches
for warehouse machinery. `design-b.md` minimises tables and leans on jsonb. The
shipped design takes the spine of B and grafts four things from A.

## What got rejected from A

Monthly and weekly **partitioning**, the `metric_daily` / `event_daily` **rollup
tables**, and the `ingest_batch` body-hash **fast path**. All three are correct
engineering for a fleet. This is one developer on two machines, which the measured
volume puts in the low thousands of rows a day. A BRIN index and a `DELETE` cron
cover retention, and the per-row dedupe key already gives the correctness that
`ingest_batch` was optimising. Machinery that never earns its keep is machinery the
next reader still has to understand.

The `device` **dimension table** went too. Its stated job was display metadata the
wire does not carry, but the wire does carry it: `device.name` is a free-form string
the operator sets, so `device.name=Work Laptop` is already the label. A surrogate id
would have bought a join on every query to solve a problem that does not exist.

## What got rejected from B

**`value IS NULL` as the metric-versus-event discriminator.** B argues no `kind`
column is needed because metric rows always have a value and event rows never do.
That is true today and it is still the wrong shape. It makes every reader decode an
absence to learn what a row is, and it breaks the first time an event carries a
number. Splitting into `metric_point` and `event` costs one extra table and makes
the two things the system actually has into two things the schema actually has.

The split also dissolves B's own second weakness. B kept one heap, then had to
special-case retention per signal name inside the cron because holding 400 days of
`hook_execution_start` to preserve 400 days of `cost.usage` is absurd. With two
tables the events table simply has a shorter window.

## What got grafted from A

**Rejecting `aggregationTemporality != 1` with a 400.** This is the single most
valuable guard in either document. Claude Code exports DELTA today, so ingest sums
increments. If a future release switched to CUMULATIVE, summing would silently
inflate every number on the dashboard with no error anywhere. A loud rejection at
the boundary beats a quiet wrong answer.

**Promoting `duration_ms` and `model`.** B stores every attribute as a jsonb string
and names the cost honestly: latency percentiles pay a text cast per row and the
planner has no statistics for them. The two heaviest panels are tool latency and API
latency, and half the metric panels group by model. Two real columns fix the worst of
it. Everything else stays in `attrs`, which is where B's flexibility argument holds.

**The `session` table.** Ten attributes are constant for a session's lifetime and
would otherwise repeat on every row. One upsert per ingest batch strips them out and
gives session count and session duration a natural home.

## The shipped schema

Three tables. `session` holds per-session constants. `metric_point` holds the six
measured metrics. `event` holds the log records. Dedupe is a uuid derived from a
sha256 over the raw wire strings, so a retried export collides and a datapoint 300
nanoseconds later does not.
