# Technical Requirements Document

My goal with this solution was not to cover every HR edge case. I tried to keep the service small and easy to reason about while being careful about the consistency problems that seemed most important in the prompt.

## 1. Problem Statement

ReadyOn is the main employee-facing interface for time-off requests, but the HCM remains the source of truth for balances and dimension validity.

That creates a consistency problem:

- employees want immediate feedback
- managers want approval decisions based on valid data
- HCM balances can change outside this service
- HCM validation exists, but the service should still behave defensively

The main risk is allowing local state to drift too far from HCM or approving requests that look valid locally but are no longer valid in the source system.

## 2. Goals

- Manage the lifecycle of a time-off request
- Keep balance integrity per `employeeId + locationId`
- Support both real-time HCM calls and inbound batch sync
- Fail safely when HCM data changes independently
- Provide a test suite that protects the most important consistency paths

## 3. Non-Goals

- Authentication and authorization
- A UI
- Multi-step approval chains
- Partial-day calendars, holidays, or accrual policies
- Event buses or async workers

I cut these fairly early. The balance consistency problem felt like the real challenge in the prompt, and I did not want to spend time on approval chains or calendar logic at the cost of getting that part wrong.

## 3.1 Assumptions

- I treated time-off as generic units rather than modeling calendars, holidays, or half-days.
- I assumed approval is a single-step manager action.
- I assumed HCM is the only authoritative source for balance values and dimension validity.
- I assumed balances are scoped only by `employeeId + locationId`, since that was explicit in the prompt.

## 4. Functional Requirements

The service must:

- expose REST endpoints for balances and time-off requests
- store balances per employee and location
- refresh a balance from HCM in real time
- accept batch balance updates from HCM
- create a pending time-off request
- approve, reject, or cancel a pending request
- validate balance availability defensively before creating a request
- consume balance in HCM when a request is approved
- handle invalid dimensions and insufficient balance gracefully

## 5. Main Challenges

### 5.1 External balance changes

This was the first thing that stood out to me in the prompt. HCM balances can change outside this service at any time. The prompt mentioned year rollover and anniversary grants specifically, and that was enough for me to treat real-time refresh as a requirement before reserving anything locally.

### 5.2 Local race conditions

Two requests can be created close together against the same balance snapshot.

### 5.3 HCM cannot be trusted as the only guardrail

Even though HCM may reject invalid or insufficient requests, the service should not create obviously invalid requests if it can detect the issue locally.

### 5.4 Batch sync vs in-flight requests

Inbound batch updates should refresh authoritative balance values without losing local knowledge about pending reservations.

## 6. Proposed Solution

### 6.1 Domain Model

#### Balance

- `employeeId`
- `locationId`
- `authoritativeUnits`
- `reservedUnits`
- `version`
- `lastSyncedAt`

`authoritativeUnits` is the latest balance known from HCM.  
`reservedUnits` tracks local pending requests that have not yet been consumed in HCM.

Available balance is derived as:

`availableUnits = authoritativeUnits - reservedUnits`

#### TimeOffRequest

- `employeeId`
- `locationId`
- `units`
- `status`
- `requestedBy`
- `approvedBy`
- `reason`
- `failureReason`
- `idempotencyKey`
- timestamps

Statuses:

- `PENDING`
- `APPROVING`
- `APPROVED`
- `REJECTED`
- `CANCELED`
- `SYNC_FAILED`

### 6.2 Request Lifecycle

#### Create request

1. Refresh balance from HCM
2. Check local availability
3. Reserve units locally
4. Persist request as `PENDING`

Why reserve on create:

- gives immediate feedback
- reduces obvious oversubscription from parallel local requests
- lets managers see pending demand reflected locally

#### Approve request

1. Atomically claim the request by moving it from `PENDING` to `APPROVING`
2. Call HCM to consume units
3. If HCM accepts:
   - mark request `APPROVED`
   - clear reserved units
   - update authoritative balance from HCM response
4. If HCM rejects because data changed:
   - mark request `SYNC_FAILED`
   - release local reservation
   - refresh local authoritative balance when possible

Using the intermediate `APPROVING` state avoids a race where two managers approve the same request at nearly the same time and both end up consuming balance in HCM.

#### Reject request

- release reservation
- mark request `REJECTED`

#### Cancel request

- release reservation
- mark request `CANCELED`

### 6.3 Sync Strategy

#### Real-time sync

Used in two places:

- before request creation
- when approval fails and the service wants to recover local state

#### Batch sync

`POST /hcm-sync/balances`

The batch updates only the authoritative balance snapshot. It does not delete or overwrite `reservedUnits`, because pending local requests are still relevant operationally.

This means a batch update can reveal a conflict by reducing the available balance below zero. That is intentional and useful.

## 7. Consistency Strategy

Most of the consistency work in this service happens in three places.

First, before reserving anything locally, the service refreshes the balance from HCM and checks both dimension validity and available units. That is the main defensive layer, since I did not want to rely on HCM errors as the only guardrail.

Second, reservation uses `Balance.version` as an optimistic concurrency check. If the balance changes while two requests are trying to reserve at the same time, one of them has to retry instead of silently overwriting the other.

Third, approval claims the request by moving it from `PENDING` to `APPROVING` before the HCM mutation happens. That is what blocks two concurrent approvals from both consuming the same balance in HCM.

I also kept an optional `idempotencyKey` on request creation so the client can safely retry the same create call without double-reserving balance.

## 8. API Design

### Balances

- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /hcm-sync/balances`

### Time-Off Requests

- `POST /time-off-requests`
- `GET /time-off-requests/:requestId`
- `POST /time-off-requests/:requestId/approve`
- `POST /time-off-requests/:requestId/reject`
- `POST /time-off-requests/:requestId/cancel`

I chose REST over GraphQL because the resources and transitions are simple and explicit, and this keeps the take-home easier to review.

## 9. Security Considerations

Within the scope of this exercise, the main security and safety concerns are:

- validate all incoming input
- avoid trusting HCM blindly
- fail closed on invalid dimensions
- avoid duplicate request creation through idempotency
- avoid over-reserving through optimistic concurrency

Full authn/authz is intentionally out of scope, but in production I would put all mutating endpoints behind authenticated service or user identity and role checks.

## 10. Alternatives Considered

I briefly considered consuming balance in HCM immediately on request creation instead of reserving locally, but I did not like what that does to the approval flow. A manager rejection would need a compensating HCM call, which felt worse than carrying a local reservation until approval.

I also considered skipping local reservation entirely and only checking HCM again on approval. That would make the local model simpler, but it also means multiple pending requests can sit on top of the same visible availability, which seemed like the wrong trade-off for this prompt.

An outbox or more event-driven design would be more realistic at larger scale, but I felt that would add too much infrastructure and ceremony for a take-home where the important part is showing how the consistency rules work.

## 11. Test Strategy

I prioritized integration-style tests across controller + service + Prisma + mocked HCM behavior.

Covered scenarios:

- health check
- refresh from HCM
- create request and reserve balance
- idempotent request creation
- successful approval
- double approval protection
- approval failure after external HCM change
- manager rejection
- request cancellation
- invalid dimension handling
- batch sync while reservations exist

The HCM is mocked with the same request/response contract the client uses, which keeps tests focused on business behavior rather than implementation internals.

I also included a small runnable mock HCM server so the REST integration can be exercised manually, not only through the automated tests.

Coverage from the current run:

- Statements: `85.03%`
- Branches: `50.63%`
- Functions: `98.11%`
- Lines: `84.86%`

## 12. Limitations and Next Steps

If I were extending this beyond the take-home, the next items would be:

- stronger audit history for every balance transition
- authenticated identities and role checks
- richer approval metadata
- pagination/filtering for request lists
- stronger reconciliation/reporting for negative available balances after external changes
- background re-sync jobs and retry policy for transient HCM outages

## 13. Final Rationale

The version I wanted to submit was not the one with the most features. I wanted it to be the one where the consistency behavior was easiest to defend.

The main choices I cared about were:

- refresh against HCM before reserving locally
- reserve locally while a request is still pending
- only finalize after HCM accepts the balance consumption
- keep reservations intact during batch sync
- recover explicitly when HCM changed outside the service

If I had more time, I would spend it on the branch coverage gap and on a background reconciliation path for HCM failures during approval. But for this take-home, I think the critical paths are covered and the trade-offs are clear enough to defend.
