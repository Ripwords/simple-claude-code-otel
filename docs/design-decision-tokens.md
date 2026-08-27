# Per-device tokens, and why identity moved to the server

The first version shipped one shared `INGEST_TOKEN` and took device identity from
the `device.name` resource attribute. That was wrong, and not only for the reason
per-device tokens are usually proposed.

## The security argument is the smaller half

A shared secret cannot be revoked for one machine. Losing a laptop means rotating
the token and re-running setup everywhere. Per-device tokens fix that, and that is
the obvious win.

## The identity argument is the larger half

`device.name` was client-declared. Three consequences followed, and all three were
real.

Any machine holding the shared token could claim to be any device. Nothing
server-side could contradict it.

A typo forked a machine's history in two. `work-laptop` and `work-laptip` were two
devices forever, and merging them was a manual data repair.

A machine that never set the attribute landed in an `unknown` bucket shared with
every other unnamed machine. The first version answered this with a dedicated
misconfiguration notice on the dashboard.

When the token is minted per device, the server already knows which device is
calling before it reads a byte of the payload. So identity comes from the token and
the payload is ignored for identity. All three problems stop existing rather than
being handled. The `unknown` bucket, the `isUnlabelled` state, the notice explaining
it, and the `resolveDevice` fallback chain are all deleted.

## Renaming becomes free

Because identity is now a surrogate `device.id` rather than the name on the wire,
the name is just a label on a row. Renaming a machine in the dashboard keeps every
metric point and event it ever sent. Under the old model a rename forked history,
which is the same failure as the typo.

Fact rows therefore key on `device_id uuid`, not `device text`. This is why the
change happened now. The database is empty today, so the migration costs nothing;
a week of real telemetry would have made it a data-rewrite.

## The foreign key is an invariant here, not a race

The first design deliberately had no foreign key from a fact row to its session,
because a fact must never be rejected for arriving before its dimension. Device is
the opposite case. A fact row cannot exist unless its device already does, since the
device's token is what authenticated the request. So `metric_point`, `event`, and
`session` all carry a real foreign key to `device`, with `on delete cascade`, which
also makes "delete this machine and its data" one statement instead of four.

## Lifecycle is derived, not stored

A device is pending, reporting, or revoked. That is fully determined by two
timestamps that are independently meaningful facts, `first_seen` and `revoked_at`.
A `status` column would duplicate them and could drift out of agreement with them,
so the status is computed at the query boundary and typed as a union in the API.

## What this does to new-device detection

The earlier feature detected a machine the dashboard had never heard of. Under
provisioning that event cannot happen, because a machine cannot report without a
token the dashboard minted. The useful signal inverts. It is now the moment a device
you created sends its first telemetry, which is the confirmation that setup worked,
and its absence is the thing worth a nudge. Pending devices show the command to run,
and a device that has just started reporting is announced once.

## What is not solved

Copying a token to a second machine makes both report as one device. That is true of
any bearer credential and no cheap mechanism fixes it. Rotation limits the blast
radius, and the dashboard shows a token prefix so an operator can tell which
credential is deployed where.
