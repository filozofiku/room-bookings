## Rezervime me grupe dhe mësimdhënës (resources-v2)

Formulari mbështet katër llojet e aktivitetit, asnjë ose disa grupe/mësimdhënës,
sallë opsionale dhe zhvillim fizik ose online. “Publik” aktivizon njoftimin me email për listën e konfiguruar: 24 orë para
fillimit, ose në ekzekutimin e parë nëse rezervimi bëhet brenda këtij afati.
GitHub Actions mund të vonohet. Hollësitë e të gjitha rezervimeve, edhe atyre
jo publike, mbeten të dukshme në oraret e burimeve të përzgjedhura. Të gjitha rezervimet shfaqen te “Rezervimet” në orarin publik,
dhe vazhdojnë të shfaqen në sallat, grupet dhe mësimdhënësit përkatës.
Rezervimet që mbivendosen shfaqen krah për krah në pamjen javore.

Konfliktet për grupe, sallë dhe mësimdhënës shfaqen së bashku pranë butonit të
rezervimit. Aktivitetet publike mund të kenë përshkrim deri në 500 fjalë, i cili
shfaqet në hollësitë e aktivitetit në orarin publik. Kufiri kontrollohet edhe nga
rregullat e Firebase. Te “Orari mësimor” navigimi bëhet me shigjeta javore;
te “Sallat e lira” mbetet zgjedhja e datës.

Kërkimi i grupeve dhe mësimdhënësve filtron listat pa hequr përzgjedhjet e bëra.
Përdoruesit me `users/{uid}.canCancelAll: true` shohin “Të gjitha rezervimet” dhe
mund të anulojnë çdo rezervim. Kjo leje vendoset vetëm nga administratori përmes
Admin SDK; roli `admin` pa këtë leje nuk jep automatikisht anulim për të tjerët.
Anulimi heq në të njëjtin transaksion rezervimin, publikimin dhe zënien e burimeve.
Për rezervimet e të tjerëve kërkohet edhe arsyeja e anulimit dhe ruhet njoftimi
privat për krijuesin. Shërbimi i emailit dhe hapat e aktivizimit për Google Workspace
përshkruhen te [mailer/README.md](mailer/README.md). Pa konfigurimin e këtij
shërbimi, njoftimet ruhen në pritje dhe nuk dërgohen.

Për aktivizim llogarie: `node scripts/manage-booking-user.mjs EMAIL teacher --apply`.
Për lejen e anulimit të çdo rezervimi, përdorni `cancel-all` në vend të `teacher`.
Pa `--apply` bëhet vetëm kontrolli paraprak. Llogaritë e reja hyjnë me Google;
skripti nuk vendos fjalëkalim dhe nuk dërgon email.

Modeli aktiv:
- `resourceCatalog/current`: emrat dhe identifikuesit e sallave, grupeve dhe mësimdhënësve.
- `weeklyResources/{weekday}`: intervalet e zëna sipas tre eksporteve zyrtare HTML.
- `eventDays/{date}`: hartë `resourceId__periodId → reservationId`, për mbrojtje atomike nga mbivendosjet.
- `reservations` dhe `publicBookings`: hollësitë e aktivitetit; vetëm dokumenti privat përmban `ownerUid`.
- `settings/control`: `slotStorage: resources-v2`, `periodOrder`, `validPeriodRanges`; datat dhe përjashtimet mbeten në `calendarDays`.

Për migrim ose përditësim të orarit, përdorni të njëjtat tri HTML si faqja publike:

```sh
node scripts/migrate-resources.mjs /path/to/public-schedule
node scripts/migrate-resources.mjs /path/to/public-schedule --apply
firebase deploy --only firestore:rules --project filozofiku
# Publikoni aplikacionin dhe skedarët public-schedule në dy faqet GitHub Pages.
node scripts/migrate-resources.mjs /path/to/public-schedule --reopen
```

Kërkohet `GOOGLE_APPLICATION_CREDENTIALS`. Kontrolli paraprak nuk shkruan asgjë.
`--apply` pezullon rezervimet, kontrollon konfliktet ekzistuese, ruan kopje rezervë
me leje private në `/tmp` dhe përgatit të dhënat. Nëse dështon, rezervimet mbeten
pezull derisa problemi të zgjidhet. `--reopen` rikthen gjendjen e mëparshme pasi të
jenë publikuar rregullat dhe të dyja faqet. Eksportet duhet të kenë të njëjtën datë
gjenerimi dhe të përputhen me periudhat e konfiguruara. Importuesi i vjetër CSV
refuzon shkrimin kur është aktiv modeli resources-v2.

Testet: `node --test tests/booking-ui.test.mjs tests/booking-model.test.mjs`,
`tests/booking-app.browser.mjs`, `tests/public-schedule.browser.mjs` dhe
`tests/public-bookings.rules.mjs` me emulatorin Firestore. Testet e sigurisë
përfshijnë 1–16 periudha, të gjitha grupet/mësimdhënësit, burime opsionale,
konflikte FET/rezervimesh, anulim, publikim atomik dhe rezervime të njëkohshme.

---

Udhëzimet e mëposhtme përshkruajnë konfigurimin fillestar dhe modelin historik.
Për instalimin ekzistues resources-v2 përdorni procedurën më sipër.

# Daily occupancy upgrade (1–16 periods)

The booking interface is in Albanian. Start/end selectors show boundary times,
and reservation summaries show a time range rather than period IDs.

For an existing deployment, run `node scripts/migrate-daily-locks.mjs` to preview.
Then run it with `--apply`: this pauses booking, saves a private JSON backup under
`/tmp`, reconstructs `roomDays` from reservations, and stores the configured period
order in `settings/control`. It deliberately leaves booking paused. Deploy the
new Firestore rules and booking app, then run the migration script with `--reopen`
to restore the previous booking-open state. Reload existing browser tabs. The
old per-period locks remain untouched for reference, with browser writes denied.
The public feed and all existing reservations keep their IDs and metadata.

The new importer initializes daily occupancy mode for fresh databases and requires
the migration first for older ones. It still checks every imported class against
all existing reservations. Keep a copy of the migration backup outside `/tmp` if
long-term retention is needed.

Validation: `node --test tests/booking-ui.test.mjs`, the Firestore emulator suite
in `tests/public-bookings.rules.mjs`, and the mocked signed-in browser flow in
`tests/booking-app.browser.mjs` cover length limits, consecutive periods,
concurrent conflicts, atomic publication/cancellation, and Albanian presentation.

# Optimized edition: important upgrade steps

If you already configured the original starter (but **only dry-ran** the FET import), replace the source files with those in this archive. **Keep your existing `.env`, `data/semester.json`, `data/timetable.csv`, and Firebase project.**

1. Back up your current `fet-firebase-starter` folder.
2. From its parent directory, unpack this ZIP. It updates `scripts/import-fet.mjs`, `src/main.js`, `firestore.rules`, and docs.
3. Deploy the NEW Firestore security rules **before importing anything**: `npx -y firebase-tools@latest deploy --only firestore:rules --project YOUR_PROJECT_ID`.
4. With your existing `GOOGLE_APPLICATION_CREDENTIALS` environment variable, run `npm run import -- data/timetable.csv data/semester.json` (without `--apply`).
5. Inspect the number of changes, test rules in the emulator, then run the command with `--apply`.
6. Restart the local dev server and test available and blocked slots, including a 16-period reservation and cancellation.

If you previously imported any **dated FET roomSlots** from the original starter, STOP. The new importer refuses mixed formats; perform a careful migration instead.

---

# FET + Firebase room reservation starter

This is a **starter**, not an audited finished production application. It implements:

- Google sign-in, restricted to administrator-approved Firebase Authentication UIDs.
- View room availability on a particular calendar date.
- Book 1–16 consecutive timetable periods, on **one date only**.
- Cancel your own booking.
- Firestore transactions and Security Rules protecting the slot locks.
- Import the FET **timetable CSV** into compact weekly teaching slots (plus date metadata).
- Freeze new bookings and cancellations while replacing a timetable.
- Efficient weekly FET slots: no expansion into tens of thousands of dated class documents.
- Supports Albanian and English weekday names.

## 1. Set up Firebase

1. Open https://console.firebase.google.com/ and create a project.
2. Stay on the **Spark** plan. No Cloud Functions required.
3. Under **Build > Firestore Database**, create the default database, preferably in a suitable EU region. Select production mode, not open/test mode.
4. Under **Build > Authentication > Sign-in method**, enable **Google** sign-in and select a support email.
5. Under **Authentication > Settings > Authorized domains**, add your GitHub Pages hostname (for example, `YOURNAME.github.io`) and, if needed, `localhost`. Google sign-in uses a popup in this starter.
6. Under **Project settings > Your apps**, register a web app and copy the Firebase web config keys.

## 2. Local prerequisites

On Arch Linux:

```sh
sudo pacman -S nodejs npm
npm install
cp .env.example .env
```

Fill out `.env` with the Firebase web config from project settings. These frontend config values are not service account secrets.

Install Firebase CLI separately:

```sh
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

`firebase use --add` creates a local `.firebaserc` binding for this project. Do NOT deploy until you have reviewed `firestore.rules` and ideally tested them with the Emulator Suite.

## 3. Service account for local FET import

In Firebase console > Project Settings > Service Accounts, use **Generate new private key**. Put the JSON file OUTSIDE your GitHub repository and `.gitignore`-protected project directory. Protect it as you would a password. For example:

```sh
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/fet-firebase/fet-admin-key.json"
```

In a managed Google Cloud environment, application-default credentials can be used instead of downloading a private key. This starter explicitly requires `GOOGLE_APPLICATION_CREDENTIALS` to be set before an import to reduce accidents.

The Admin SDK bypasses Firestore Security Rules, so protecting this credential is essential.

## 4. Configure the academic semester

Copy `data/semester.example.json` to `data/semester.json`.

- Change `startDate` and `endDate` to the REAL semester teaching dates.
- Add dates with no recurring FET classes to `holidays` (teachers may still book these dates). Add completely closed dates (no teacher booking) to `closedDates`.
- Most importantly, change each `fetHour` to match **exactly** the `Hour` column produced by YOUR FET timetable CSV. `label`, `start`, and `end` must match your real university period times. `id` values must be `p01`–`p99` in chronological order.
- The importer understands the standard FET timetable CSV header: `Activity Id,Day,Hour,Students Sets,Subject,Teachers,Activity Tags,Room,Comments`. It recognizes English and Albanian weekday names (`E premte`, etc.).
- This starter assumes all rooms share the same period grid, and that reservations occupy whole FET periods. Add additional handling before production if you use overlapping/incompatible timetable grids.

## 5. Import the FET timetable

Use the FET **timetable CSV**, not the activities CSV. FET exports a multi-period class as multiple rows. Example: `data/fet.example.csv`.

Copy your real CSV to `data/timetable.csv`, then run:

```sh
npm run import -- data/timetable.csv data/semester.json
```

This is a dry run: it reports the number of records and intended changes without writing.

Then apply it:

```sh
npm run import -- data/timetable.csv data/semester.json --apply
```

The importer creates one `weeklyRooms` document per weekday and room, containing its occupied periods (rather than repeating the class every calendar week). It also creates one `calendarDays` document per date, plus `rooms`, `periods`, and `settings/control`. Teacher bookings use dated `roomDays` occupancy maps. Historical `roomSlots` are read-only and no longer authoritative. Firestore rules check both the weekly FET occupancy and the dated teacher reservation.

**Important:** the importer initially sets `bookingOpen: false`. It only re-opens booking if all writes complete successfully. If the import fails or finds a conflict with an existing teacher reservation, **keep bookings closed**, fix the source conflict, then re-run.

To remain below Spark quotas, this version refuses to apply more than 12,000 changes at once. For a typical faculty schedule, the compressed weekly import needs far fewer writes. Watch Firebase Usage. Re-importing unchanged data should make few or no timetable updates.

## 6. Authorize teachers

Teachers first log in with Google to create a Firebase Auth account. An unapproved account displays its Firebase UID. As the administrator, open Firestore > Data and create:

Collection `users` -> document ID `<teacher Firebase UID>` with fields:

- `active` = boolean `true`
- `role` = string `teacher`
- `name` = string (optional)

Your own admin user can have `role = admin`. **Admin role does not grant unrestricted browser database write privileges.** Administrative changes are deliberately kept in the trusted local importer / Firebase console.

Teachers can sign in again after approval.

## 7. Run the website locally

```sh
npm run dev
```

Open the address Vite prints. To test Google sign-in on `localhost`, make sure it's present in Firebase Auth authorized domains. Use the Firebase Firestore emulator for rule testing before using real data.

## 8. Publish to GitHub Pages

```sh
npm run build
```

The output is in `dist/`. The starter includes `.github/workflows/deploy.yml` to deploy automatically with GitHub Actions.

1. Create a dedicated GitHub repository (for example, `room-bookings`) and push the starter files to the `main` branch.
2. Open GitHub repository Settings > Pages and choose **GitHub Actions** as the build/deploy source.
3. In repository Settings > Secrets and variables > Actions > **Variables**, add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_MESSAGING_SENDER_ID`. Copy their values from your `.env`; these are public Firebase web config values, not secrets.
4. Push changes or manually run the Deploy booking site workflow; it publishes `dist/` under `https://YOURNAME.github.io/room-bookings/`.

The Vite config sets `base: './'` to work when hosted within a repository path.

`.env` is read at **build time**, so ensure it is configured when running `npm run build`. The built frontend Firebase config is public, which is normal; **never include the Admin SDK private key**.

Do not place this application's `index.html` directly beside an existing index.html unless you intend to replace it. Use a separate repo (`room-bookings`) or a subdirectory on your existing Pages website.

## 9. Test these cases before opening it to faculty

1. An unauthorized Google user cannot read room slots or create bookings.
2. An approved teacher sees FET weekly classes as unavailable on the correct calendar weekdays.
3. Two teachers attempting the same free slot cannot both succeed.
4. Booking several periods fails if ANY included period is occupied.
5. A teacher cannot delete someone else's reservation or overwrite a FET slot.
6. Deleting your own reservation releases exactly its associated room slots.
7. When `bookingOpen` is false, new reservations and cancellations are blocked.
8. Importing a revised timetable with a conflicting teacher booking fails without overwriting that booking.
9. On holidays, recurring FET classes are ignored; on closed dates, bookings are blocked.
10. A booking exists only on its selected date; no weekly repetition.

Firebase docs on rules emulator: https://firebase.google.com/docs/firestore/security/test-rules-emulator

## Limitations / next steps

- Room, teacher and student subgroup conflicts are protected in resources-v2 (see above).
- Bookings may be created only within the configured semester range; no recurring teacher bookings.
- Bookings support 1–16 consecutive periods. Daily occupancy maps keep security checks below Firestore access limits.
- The FET importer models room occupancy, not the full student/teacher activity hierarchy. Store extra metadata separately if you want unified public timetable views.
- Holiday rules should be reviewed for institution-specific exceptions and make-up sessions.
- A failed large import is **not atomic** across all documents. Use a maintenance window and a backup, and verify completion before reopening booking.
- For real production data, add emulator-based automated security tests, more detailed import history/rollback, usage monitoring and a backup/export routine.
- For faculty-wide usage, keep an eye on the free daily read/write quota. Spark can stop service when it is exhausted.


## Updated storage model (compact weekly schedule)

- `weeklyRooms/{weekday}__{roomId}`: one document per weekday and room, containing an array of occupied period IDs and a map with activity details. Weekday uses JavaScript convention: Sunday `0`, Monday `1`, ..., Saturday `6`.
- `calendarDays/{YYYY-MM-DD}`: administrator-provided `weekday` string, `fetActive` boolean, and `bookingAllowed` boolean. This prevents clients from lying about weekdays.
- `roomDays/{YYYY-MM-DD}__{roomId}`: a `bookings` map from period ID to reservation ID, plus the last changed reservation ID.
- `reservations/{id}`: one-time teacher event.

For each booking, the browser transaction reads the selected date metadata, one date-specific room occupancy document, and one FET room/weekday document. Security rules separately enforce that no weekly FET lock applies to the date.

**Migration:** This is a replacement for the initial importer. If you already applied the original importer (and have dated `roomSlots` with `source: fet`), do not mix formats; the optimized importer refuses to run. In that case, devise a maintenance migration before importing. If you only ran dry runs, you can switch immediately.

**Caveat:** This is a development example. Security rules need emulator tests, especially 16-period transactions (Security Rules have cross-document access limits). Before production, validate simultaneous booking, cancellation, import conflicts, holiday handling, and all authorization paths in the emulator.

## Public timetable reservations

The completed public feed integration lives in [public-schedule/README.md](public-schedule/README.md).
It includes the updated public HTML, live date-specific reservations, free-room
filtering, stricter atomic publication rules, and a dry-run-first backfill for
existing bookings. Follow its deployment order when upgrading both websites.
