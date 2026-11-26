# Dated class cancellations

Academic staff open **Anulimi i mësimit**, immediately below **Rezervimet e mia**.
They select a week and cancel or restore one dated occurrence of their own regular
teaching. Other weeks remain unchanged. The public room, teacher, group, list and
Today views keep the class visible with diagonal hatching and an explicit
**Anuluar** label. Public views update through their existing calendar-day listeners.

Cancelling releases every room, atomic student subgroup and teacher period for
that occurrence. Booking creation, edits and approval all use those released keys.
Restoring checks current reservations first: if any resource has been booked in
the meantime, restoration is refused. The booking must be moved or cancelled
before the original class can be restored. Transactions and security rules check
both documents' final state, including competing booking/restoration requests.

`regularClasses/{class-id}` is an administrator-maintained catalog derived from
the official FET CSV and student hierarchy, including classes without a room.
`users/{uid}.teacherIds` is protected by the existing profile rules. Initial links
use unique normalized institutional email names, never editable display names.
The account-provisioning script also sets these links for new staff accounts.
An administrative booking/cancellation permission alone does not authorize a
user to cancel another teacher's regular classes.

A calendar date stores `cancelledClasses`, `releasedKeys`, `changedClassId`,
`classChangeBy` and `classChangeAt`. Public snapshots contain timetable details
and teacher IDs, without account UIDs or student email addresses. The underlying
weekly resource locks and original timetable are preserved.

Preview initialization against the exact currently imported timetable:

```sh
node scripts/configure-class-cancellations.mjs CSV_FILE FET_FILE
node scripts/configure-class-cancellations.mjs CSV_FILE FET_FILE --apply
```

Initialization verifies the CSV fingerprint and every weekly resource lock. It
writes the class catalog and account links atomically and retains a local backup.
No class occurrence is cancelled by initialization. Publish the Firebase rules,
booking app and public timetable together. Existing open browser tabs should be
refreshed after deployment.

Future CSV imports maintain the class catalog and recalculate cancellation
snapshots and released keys for the new assignments before reconciling bookings.
A class moved to a different weekday does not retain its old dated cancellation.
The importer refuses oversized transactions rather than partially applying them.
