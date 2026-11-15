# Faculty reporting dashboard

Open `https://filozofiku.github.io/room-bookings/?section=reports` after signing in.
The navigation link and all report reads require an active approved user whose
`users/{uid}.canCancelAll` is `true`. An admin role alone does not grant access.
Signing out clears the report, including an in-flight load and export handlers.

## Measures and dates

The month, semester, all-history and custom filters use **Europe/Tirane** calendar
dates. Business actions are attributed to the time of the action, independently
of the scheduled event date. CSV exports contain aggregate figures and coverage
information, never student email addresses or staff account identifiers.

- Staff adoption counts distinct reservation owners who created a reservation or
  submitted a request in the period. A reviewer is not counted simply for making
  a decision. A staff account is counted once across both actions.
- Reservations distinguish direct creation, creation after approval, edit actions,
  cancellations and administrative timetable adjustments. Multiple edits of one
  reservation are separate edit actions.
- Requests distinguish submission, approval and decline. Pending requests are the
  backlog **as of the selected end date**, including requests submitted earlier.
- Median response time uses decisions made during the period and the original
  request submission timestamp. Both approvals and declines are included; the
  sample size is shown. Missing or invalid timestamps are excluded.
- Initial, change and cancellation notification measures count **batches created**
  in the period. A batch can have multiple recipients.
- Messages sent count successful notification/recipient pairs by send time.
  Distinct addresses reached are deduplicated across batches and notice types.
  Retries do not increase either count. Accepted for sending does not mean inbox
  delivery or reading. Staff public-event mail is not counted as student reach.
- Sending problems show **current** pending, failed, partial and awaiting-approval
  states for student and staff notification jobs created in the selected period.
  Partial delivery can overlap with pending or failed. Recorded self-edits,
  skipped notices and refused-request notices are not failed mail.

## Permanent history and rollout

`activityEvents` is an immutable, private collection. Each business operation
writes its deterministic event ID in the same transaction as the reservation or
request change. Firestore validates the event against that operation. Neither
teachers nor elevated users can update or delete these events.

For deployment compatibility, the rules initially accept older clients. After
deploying the new rules **and** booking app, run:

```sh
node scripts/configure-reporting.mjs --enable-audit
```

This sets `auditLoggingRequired: true` and initializes `auditCompleteFrom` once.
Afterward, old browser tabs cannot perform an unlogged operation; reload them.
This setting must not be enabled before the updated app is live.

The dashboard merges retained reservations, request decisions/submission notices,
modification/cancellation notices and timetable imports with the new history,
deduplicating each operation. Older history is explicitly labelled reconstructed
and incomplete. Deleted reservations without retained evidence cannot be recovered.
New imports made with `scripts/import-resource-csv.mjs` also log adjustments.

## Student sending receipts

The shared mailer now records `recipientSentAt` alongside `sentRecipients` after
each recipient is accepted. This preserves timestamps for partial batches and
across retries. The updated rules permit only the restricted mail worker to write
these sending fields. The existing templates and scheduling are unchanged.

For an Apps Script sender, rebuild with `node scripts/build-apps-script.mjs` and
replace the existing project's `Code.gs` with the resulting file. This is a code
update to the existing project; do not install a second timer or change the token.
If that project has not been updated yet, completed legacy batches still use
their batch completion timestamp. The report discloses this approximation.
Older partial deliveries without any send timestamp are disclosed and excluded
from period send totals instead of assigning them a false date.

## Cloudflare traffic synchronization

The public beacon token is **not** an API credential. Cloudflare's credential is
never sent to the browser, stored in Firestore, bundled into HTML, or logged.
A scheduled GitHub Actions job writes only aggregate `trafficDaily` snapshots
and `reportSettings/traffic` synchronization status. The browser reads that cache.

1. Create a Cloudflare custom API token, limited to this account, with
   **Account / Account Analytics / Read** and **Account / Account Settings / Read**.
   The latter allows discovery of the site tag associated with the installed beacon.
2. In `filozofiku/room-bookings` → Settings → Secrets and variables → Actions,
   add repository secret `CLOUDFLARE_ANALYTICS_API_TOKEN`.
3. The sync discovers the account and site using the exact installed beacon token.
   Optional repository variable `CLOUDFLARE_ACCOUNT_ID` limits discovery to the
   account ID in your dashboard URL. Optional variable `CLOUDFLARE_SITE_TAG` skips site
   discovery; it is the site's tag, not its public beacon token.
4. With the existing local Firebase Admin credentials, run:

   ```sh
   node scripts/configure-reporting.mjs --worker
   gh secret set REPORTING_FIREBASE_REFRESH_TOKEN --repo filozofiku/room-bookings < /tmp/fet-reporting-worker.secret
   ```

   The private file is created with owner-only permissions and no token is printed.
   The `reporting-worker` identity can write only validated traffic snapshots and
   traffic status. It cannot read reservation/notification history, change users,
   or send email. No Firebase Admin private key is uploaded to GitHub.
5. Run **Update dashboard traffic statistics** in GitHub Actions. It then runs
   hourly. The worker re-fetches up to seven days, replacing daily snapshots
   rather than adding counters. This corrects late-arriving data without duplication.

Traffic starts from 15 November 2026, when the beacon was published. The cache
uses local calendar days, with correct 23/25-hour DST boundaries. Today's day is
partial and marked as such; cached days and last successful sync are shown.
Missing credentials, failed API queries or unqueried days are **unavailable**,
never silently represented as zero. Failed refreshes preserve previous snapshots.

Visits and page views come from the account-scoped RUM dataset, scoped to the
installed site tag, hostname and non-bot traffic. Top pages use reported paths.
Query strings and fragment values are not retained in the cache. Cloudflare does
not supply a unique-person count here; estimated visitors are explicitly
unavailable. Hash-based subviews cannot be ranked separately when the source
reports only the containing page path. Adaptive sampling can apply.

References:

- [Cloudflare analytics token permissions](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)
- [Cloudflare Web Analytics site discovery](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/list/)
- [Cloudflare traffic metric definitions](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

## Validation

Pure calculation and sync tests:

```sh
node --test tests/reporting-model.test.mjs tests/cloudflare-reporting.test.mjs
```

Browser and security checks use the same isolated Playwright / Firebase test
dependencies as the existing tests. Run `tests/reporting.browser.mjs` and
`tests/reporting.rules.mjs` with `TEST_MODULES_DIR` set to those dependencies;
the latter also requires the local `FIRESTORE_EMULATOR_HOST`.
