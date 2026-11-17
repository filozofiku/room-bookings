# Firestore quota audit — 17 November 2026

## Current state

New bookings are paused through the live `settings/control.bookingOpen=false`
control. Existing reservations remain stored and visible on the public timetable.
The user stopped the Apps Script email service. It must remain stopped, and the old
GitHub email workflow must remain disabled throughout this review. No billing was
enabled, no backlog mail was sent, and bookings were not reopened by this work.

The user chose immediate public updates instead of a shared public feed with a
five-to-ten-minute delay. The correction preserves Firestore real-time listeners.

## Evidence and cause

Google Cloud Monitoring reports approximately **53,196 document reads** during the
quota day 16 November 08:00 UTC–17 November 08:00 UTC (midnight Pacific):
51,529 query reads, 1,492 lookups and 175 not-found reads. The metric has multiple
resource representations; this total uses one representation and does not add
duplicates. Monitoring usage is approximate and can differ from billable usage.

During the sustained morning activity, the API recorded approximately 420 RunQuery,
120 ListDocuments and 180 GetDocument calls per hour. Query-document reads reached
roughly 9,800–9,900 per full hour before dropping. This pattern matches the old
Apps Script worker's one-minute loop after completing the weekly digest:

| Repeated operation | Approximate reads per minute |
| --- | ---: |
| Six empty ordinary notification queries | 6 |
| Mailing settings, week snapshot and resource catalog | 3 |
| All periods | 53 |
| All rooms | 21 |
| Completed weekly recipient receipts | 86 |
| Total | **169** |

That is about **10,140 reads per hour**, or 243,360 per day if allowed to continue.
Firestore charges for documents returned, not only for the number of API requests;
even an empty query has a minimum read charge. Repeatedly fetching records already
sent exhausted the free allowance without corresponding new bookings or emails.
This was a defect in the worker implementation supplied for this app.

The inventory check found 30 reservations and 86 mailing-list recipients. The
complete traffic report for 16 November recorded 12 visits and 75 page views. That
does not support public traffic as the main cause of this incident. The API pattern
and source code provide strong attribution to the worker; the aggregate metrics do
not identify the caller of every individual request or exclude smaller consumers.

The project has no billing account attached. Its database is Firestore Standard in
`nam5`. The free quota is 50,000 document reads/day and 20,000 writes/day, resetting
around midnight Pacific. Exceeding the read quota prevents further database reads
on the free plan; pausing mail does not immediately replenish the daily allowance.

## Corrections

1. Ordinary queues are scanned every five minutes. Minute-trigger runs between
   scans return before authentication or database access, except when starting or
   continuing the Monday 08:00 digest.
2. An initial-batch cursor resumes the recipient list across runs. A completion
   marker ends the full scan. Thereafter only pending/retrying delivery records
   are queried, with a 25-record limit; sent receipts are not downloaded again.
3. Public room/period reference data is shared across email types and cached for an
   hour. Recipient lists and unsubscribe preferences are still checked when sending.
4. A persistent Apps Script budget reserves bounded reads before each request:
   **6,000 accounted reads and 1,500 writes per Pacific quota day**. It includes a
   conservative allowance for worker commit rule lookups. Failed requests retain
   reservations. Exhaustion defers work; it never deletes delivery receipts or
   automatically resets failed mail. A database `RESOURCE_EXHAUSTED` response blocks
   automatic Firestore attempts for the remainder of that Pacific day.
5. The paused booking page loads the user and control documents before reference
   collections or booking history. Changing its language makes no extra reads.
6. Public reference subscriptions remain attached once per page. Selecting another
   day in the same week reuses its listeners; changing weeks replaces only that
   week's listeners. Reservation changes still appear through live subscriptions.

The worker allowance applies to one Apps Script project's request accounting. It
is not a Google-enforced project-wide quota or total cost cap. Public listeners,
calendar services, administrative tools and separate script copies use additional
reads. Do not run the legacy GitHub mailer alongside this worker or delete the
budget property to bypass its limit.

## Verification

Automated tests simulate all 1,440 minute-trigger runs in a day using the live
reference sizes (53 periods, 21 rooms) and 86 recipients. The corrected worker
uses fewer than 4,000 accounted reads with all 86 digests delivered once. Larger
mail workloads defer at the daily worker budget. Tests also cover persistent
budgets, Pacific daylight-saving boundaries, stopping after database exhaustion,
receipt preservation, Monday timing and continuation across runs.

Listener tests verify no resubscription within the same week, reuse of reference
listeners across weeks, immediate live changes and rejection of unverified cached
availability. A Chromium test verifies the paused booking page hides the form and
makes only two document reads, including after a language change.

These are controlled tests, not production measurements of the replacement script.
The existing Apps Script project cannot be edited through the currently connected
tools. Its new safeguards become active only after the owner replaces and saves
[Code.gs](../apps-script/Code.gs). Keep `EMAIL_ENABLED=false`; do not reinstall the
trigger, because `installMinuteTrigger` enables sending.

## Paid-plan assessment, preserving immediate updates

**Recommendation: move this existing project to Blaze before a broad public launch,
with usage and billing alerts, after explicit billing approval.** The free daily
read ceiling cannot safely be guaranteed under unpredictable public traffic while
maintaining immediate updates. Blaze keeps the free allowances and bills additional
usage, removing this free-plan daily cutoff. Other technical/service limits remain.

The Cloud Billing SKU catalog checked on 17 November lists Firestore Standard
`nam5` reads at **USD 0.06 per 100,000 reads above the daily free allowance**, and
writes at USD 0.18 per 100,000 above the write allowance. The regional us-central1
rate shown by default in some pricing tables does not apply to this database.

Illustrative read-only costs, assuming steady daily usage for 30 days:

| Total reads/day | Estimated paid reads/month |
| ---: | ---: |
| 50,000 | USD 0.00 |
| 100,000 | USD 0.90 |
| 250,000 | USD 3.60 |
| 1,000,000 | USD 17.10 |

These are scenarios, not a forecast or an invoice limit. Writes, deletes, storage,
network transfer, other services and taxes are additional where applicable. The
worker correction is still necessary on Blaze to avoid paying for wasteful work.

Before reopening, the operator should:

- Save the corrected Code.gs while leaving email sending disabled.
- If billing is approved, attach the institution's billing account and verify Blaze
  is active for this project. No database move or loss of existing reservations is
  needed. This audit has not attached a billing account or incurred new plan charges.
- Configure an initial project-scoped monthly alerts-only budget (for example USD
  10, with 50%, 90% and 100% thresholds and forecast alerts) and a named institutional
  recipient. These notifications do not stop charges. Any supported spend-cap product
  would need separate assessment; stopping a billed service can also stop bookings.
- Configure database-read monitoring alerts for abnormal sustained activity and
  track `LAST_RUN.databaseUsage` in Apps Script. Recheck observed usage after the
  corrected worker is intentionally enabled; do not infer a whole day from one tick.
- Explicitly resume bookings and the single email scheduler only after the chosen
  capacity arrangement and corrected code are verified. Review pending mail before
  enabling the scheduler, since enabling it can deliver the backlog.

## Official references

- [Firestore quotas and free allowances](https://firebase.google.com/docs/firestore/quotas)
- [Usage monitoring and billing differences](https://firebase.google.com/docs/firestore/monitor-usage)
- [Firestore pricing and listener billing](https://cloud.google.com/firestore/pricing)
- [Official nam5 pricing example](https://firebase.google.com/docs/firestore/billing-example)
- [Blaze and retained free allowances](https://firebase.google.com/pricing)
- [Cloud Billing SKU catalog](https://cloud.google.com/billing/v1/how-tos/catalog-api)
- [Budget types and notifications](https://docs.cloud.google.com/billing/docs/how-to/budgets)
