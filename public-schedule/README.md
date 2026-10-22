# Public schedule integration

This is an updated copy of `filozofiku/filozofiku.github.io/index.html`, fetched on
2026-10-23. It retains the existing weekly timetable and adds live, date-specific
reservations to the room weekly and list views. The free-room search uses that same date, ignores recurring
classes on configured holidays, and refuses to claim availability when the feed
is unavailable or the date is not configured. It uses only room names shared by
Firebase and the HTML schedule. Keep the HTML exports and Firebase FET import in
sync; changing one does not update the other.

Reservations currently have no teacher or student-group identity. They appear in
the selected room’s calendar and list, not in teacher/student views. The date
selector chooses a Monday–Sunday calendar week; reservations never repeat in
other weeks. Clicking a reservation shows the reserver’s Google display name and
the original server timestamp, formatted in Europe/Tirane time. Existing names
are backfilled from Firebase Authentication; missing historical data is labeled
as unavailable. Adjacent periods display as one time range.
Dates do not repeat weekly. The three generated FET HTML files need no edits.

## Publish

1. Review and deploy the updated `firestore.rules` from the booking repository:
   `firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`.
2. Build and publish the updated booking app (`npm run build`, then the existing
   GitHub Pages workflow). The app now creates and deletes `publicBookings` in the
   same transaction as the private booking. Old app versions cannot create or
   cancel bookings under these rules; reload open booking tabs after deployment.
3. Preview existing reservations with `node backfill-public-bookings.mjs`, using
   the same Admin credentials as the importer. Then publish them with
   `node backfill-public-bookings.mjs --apply`. The script rechecks each reservation
   transactionally so concurrent cancellations cannot recreate public entries.
4. Run `node scripts/configure-public-schedule.mjs` to regenerate the public web
   config from `.env` (also accepts the existing `VITE_FIREBASE_*` environment
   variables). This publishes only Firebase web configuration, never Admin keys.
5. Copy these four files into the root of `filozofiku/filozofiku.github.io`:
   `index.html`, `booking-model.js`, `public-bookings.js`, `firebase-config.js`.
   Keep the three existing `WinterF_*.html` exports beside them.
   Commit and publish using that repository's existing GitHub Pages setup.
6. Open the public page without signing in. Choose a date, create a reservation in
   the booking app, and select its room and check that it appears in both views and removes the room
   from overlapping free-room searches. Cancel it and check that both update.

Public readers can read only the sanitized `publicBookings`, room/period metadata,
and individual calendar dates. Private reservation UIDs and account data remain
restricted. Booking titles, reserver display names and creation timestamps are intentionally
public; the booking form says so. Emails and account UIDs are not published.
The feed uses Firebase listeners and consumes Firestore reads for public visitors.
No Cloud Functions or paid server is required by this implementation.

## Checks

Run `node --test tests/booking-model.test.mjs` and `npm run build` in the booking
repository. Security integration tests are in `tests/public-bookings.rules.mjs`;
they require Firebase CLI, Java 21+, and `@firebase/rules-unit-testing`. Run them
against the local Firestore emulator, never the production project.
