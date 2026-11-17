# Email worker for Google Apps Script

This is the existing Firebase email worker adapted to Google Apps Script. It sends as
`zzha.filozofik@uni-pr.edu`, using MailApp authorization rather than an app password.
It needs no Firebase Blaze plan, web-app deployment, public endpoint, or spreadsheet.

The minute trigger scans pending reservation and public-email queues every five
minutes. Public reference data is cached for an hour. Completed weekly batches do
not reread all delivery receipts. Weekly public-event digests start on Monday at
08:00 Europe/Tirane and continue across runs until the initial batch is processed.

It covers reviewer requests (Arsim Sinani, rooms 102/127), approval/refusal decisions,
cancellations, modifications, and one weekly public-event digest per recipient.
It preserves the dashboard, delivery receipts, atomic leases and administrator retries.

## Setup in the university account

1. Sign in to **zzha.filozofik@uni-pr.edu** and visit https://script.google.com/.
   Create a **New project**, named `Njoftimet e rezervimeve`.
   If Apps Script is disabled, ask your university Workspace administrator to enable it.
2. Replace the editor's entire `Code.gs` with the contents of this folder's `Code.gs`.
   Save. Do not copy `src/` files individually; the generated file contains everything.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**.
   Open that file and replace its contents with this folder's `appsscript.json`. Save.
4. In **Project Settings → Script properties**, add:
   - `FIREBASE_REFRESH_TOKEN`: copy only the value from the local
     `firebase-worker.secret.json`, without its quotes or JSON braces.
   - `EMAIL_ENABLED`: `false`.
   Do not paste secrets into Code.gs, chat, GitHub, screenshots, or logs.
   Keep the Apps Script project private: project editors can access script properties.
5. Select **checkConnection** from the function selector and click **Run**.
   Authorize it as **zzha.filozofik@uni-pr.edu**. It needs permission to send mail,
   make external requests, manage its trigger, and verify the signed-in account.
   This check does **not** send email or mark notifications as sent. The execution log
   should show `Connection verified. No email sent.` in its report. A Workspace policy
   block must be resolved with your administrator; do not bypass organization controls.
6. Select **installMinuteTrigger** and click **Run**. This performs the connection
   check again, enables sending, and installs exactly one minute trigger for this account.
   **Existing pending notifications can now be sent to real recipients.**
   No Deploy button or published web-app URL is needed.
7. Open **Triggers** (clock icon) to confirm the timer. Open **Executions** to verify
   successful `runEmailWorker` runs. `showLastRun` prints a non-sensitive summary.
   Confirm a real notification is received and its status updates in the booking app.
8. After a successful scheduled run, disable the old GitHub email workflow:
   https://github.com/filozofiku/room-bookings/actions/workflows/cancellation-emails.yml
   → menu **… → Disable workflow**.
   Keep website deployment workflows enabled. Brief overlap uses the same Firestore
   leases and receipts, but avoid keeping both schedulers running indefinitely.

## Pause and rollback

Run **stopEmailWorker** to disable sending and remove this account's worker timer.
Keep the GitHub `Send reservation emails` workflow disabled during the quota review.
That fallback does not use the Apps Script daily database budget.
Never delete delivery records to force a retry. Use the booking application's retry button.
A failed record is not automatically reset during migration.

## Limits and delivery expectations

- Ordinary notification queues are checked every five minutes; delivery timing also
  depends on leases, quotas and available runtime.
- A persistent, per-project daily budget permits at most 6,000 accounted worker reads
  and 1,500 writes per Pacific quota day. Queries reserve their maximum bounded
  result count before the request, then refund unused reads. Failed requests retain
  their reservation. Writes include an allowance for security-rule reads.
  Reaching the budget defers mail until the next quota day, without clearing receipts.
  This protects against the worker's repeated reads; it is not a project-wide billing
  cap and does not cover website visitors, calendar services or other worker copies.
- `RESOURCE_EXHAUSTED` stops automatic Firestore attempts for the rest of that
  Pacific quota day. `checkConnection` remains an explicit, budgeted diagnostic.
- The script stops starting new work after three minutes or 50 accepted messages per run.
  Deferred work remains for later runs. It checks remaining MailApp recipient quota.
- The existing five-minute Firestore leases protect against concurrent delivery; a
  terminated run may leave a message waiting for its lease to expire.
- MailApp does not accept a custom Message-ID. Firestore deduplication is preserved,
  but a crash after mail acceptance and before recording `sent` can still cause a duplicate.
- “Dërguar” means accepted for sending, not proof of inbox delivery or reading.
- Google Workspace quotas and trigger-runtime limits apply. Current official references:
  https://developers.google.com/apps-script/guides/services/quotas
  https://developers.google.com/apps-script/guides/triggers/installable
  https://developers.google.com/apps-script/reference/mail/mail-app
- The script logs counts and sanitized errors, not message contents, recipients, or tokens.
  It retains the existing Albanian do-not-reply footer and uses the university sender.

## Maintenance

After changing shared mailer code, rebuild and copy the new Code.gs into Apps Script:

```sh
node scripts/build-apps-script.mjs
node --test tests/apps-script.test.mjs
```

To prepare a new private token file if one has not already been generated:

```sh
node scripts/prepare-apps-script-token.mjs --apply
```

This requires the existing local Firebase Admin credentials. It creates a restricted
worker refresh token, does not export Admin credentials, and does not replace GitHub's
secret. The private file is ignored by Git and is created with owner-only permissions.

## Weekly public-event digests

To update the **existing** email project, preserve its Script properties and minute
trigger. No new web-app deployment, OAuth scope, or trigger is required.

1. Publish the booking website, including `public/unsubscribe.html` and
   `public/unsubscribe.js` (Vite copies these into the published root).
2. Publish `firestore.rules` to project `filozofiku`. The new rules add private
   `publicEventRecipients` and `publicEventWeeks` collections. A valid personal token
   grants only permission to opt out; it never grants access to the mailing list.
   Legacy per-event workers cannot create new public-event delivery records under
   these rules, preventing the old 48-hour sender from continuing after migration.
3. Rebuild with `node scripts/build-apps-script.mjs`, then replace the existing
   project's entire `Code.gs` with [Code.gs](Code.gs) and **Save**. Keep the existing
   `appsscript.json`, `FIREBASE_REFRESH_TOKEN`, `EMAIL_ENABLED` and minute trigger.
4. Run **checkConnection**. It sends nothing and does not create a weekly snapshot.
   The existing minute trigger then uses the saved code automatically.
5. Keep the old GitHub `Send reservation emails` workflow disabled. Verify the first
   Monday digest through **showLastRun**, the booking email-status panel and an
   actual recipient. No production email is sent by the local tests.

The week runs Monday–Sunday. The roster is saved once on the first Monday run at or
after 08:00, including events earlier that Monday. Additions after that snapshot do
not generate extra emails. An empty week sends an explicit no-events message.
Cancellations, public visibility, updated details, mailing-list membership and
unsubscribe preferences are checked before each handoff. Only unfinished deliveries
retry during that same week; sent recipients keep their receipt. Opt-outs persist
when the recipient file is reimported and across future weeks.

Each event links to the existing Google Calendar connection service and its live
calendar feed for Apple Calendar / Outlook. Recipients can opt out using their
personal email link and one confirmation button without signing in. The opt-out
applies only to weekly public-event emails. Timer delays, quotas and provider
acceptance still limit exact delivery time; 08:00 is the scheduled start.

Validation:

```sh
node scripts/build-apps-script.mjs
node --test tests/public-event-email.test.mjs tests/apps-script.test.mjs tests/email-format.test.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8086 TEST_MODULES_DIR=/tmp/fet-weekly-validation node --test tests/public-event-subscriptions.rules.mjs tests/public-bookings.rules.mjs tests/email-delivery.rules.mjs
TEST_MODULES_DIR=/tmp/fet-weekly-validation node tests/unsubscribe.browser.mjs
```


## Request recipient: Arsim Sinani

Requests for rooms 102/127 now notify `arsim.sinani@uni-pr.edu`. To activate this
change in the existing Apps Script project, replace its entire `Code.gs` with the
rebuilt file and save. Keep the current properties and minute trigger. Run
`checkConnection`; do not reinstall the trigger or reset delivery records.

The sender remains `zzha.filozofik@uni-pr.edu`. Previously sent reviewer notices are
not automatically resent. One-time handoff emails must be selected from requests
that are still pending, and recorded separately from the original delivery history.

If `checkConnection` reports `RESOURCE_EXHAUSTED`, Firestore is refusing reads due
to quota. Changing the recipient does not clear that quota. The new worker avoids
minute-by-minute reads of public reference collections and completed weekly receipts.
When access returns, queued notifications can resume using the new recipient.

## Quota maintenance: 17 November 2026

See [the incident audit and paid-plan assessment](../docs/quota-audit-2026-11-17.md).
Bookings remain paused in `settings/control`; the email service must remain stopped.
To install the correction in the existing Apps Script project, replace the entire
`Code.gs` with this version and save, preserving all existing Script properties.
Keep `EMAIL_ENABLED=false`. Do **not** run `installMinuteTrigger` during maintenance:
it enables sending. Saving replacement code does not itself resume the service.
`checkConnection` sends no messages, but does make a small number of budgeted reads.
Do not clear budget, cursor or receipt properties to force a retry.
