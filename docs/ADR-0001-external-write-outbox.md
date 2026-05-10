# ADR-0001: External write outbox risk

## Status

Accepted as a future production hardening TODO.

## Context

Appointment confirmation currently calls the active `ScheduleAdapter` and then updates the Postgres appointment mirror to `booked_pending_admin_confirmation`. This keeps all external writes behind adapter interfaces, but it does not yet provide an outbox or transactional message boundary.

## Risk

If the external adapter write succeeds and the following Postgres update fails, a retry can observe the appointment as not booked and may attempt another external write. This can create duplicate external appointments in providers that do not offer strong idempotency keys.

## Decision

Do not implement a transaction/outbox workflow in the initial skeleton. Before enabling production external writes, add an outbox or equivalent idempotent external-write workflow that records the intended write in Postgres before dispatch, persists provider idempotency keys, and reconciles provider results back into `core.external_appointments`.
