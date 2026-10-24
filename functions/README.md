# Njoftimet për anulimin e rezervimeve

Kur një përdorues me `canCancelAll` anulon rezervimin e një përdoruesi tjetër,
rregullat kërkojnë një arsye jo të zbrazët (deri në 2000 karaktere) dhe dokumentin
`cancellationNotifications/{reservationId}` në të njëjtin transaksion. Dokumenti
ruan rezervimin origjinal, autorin e anulimit, arsyen dhe kohën. Përdoruesit nuk
mund ta ndryshojnë dokumentin ose marrësin. Arsyeja nuk publikohet në orarin publik.
Anulimi i rezervimit të vet nuk kërkon arsye dhe nuk krijon email.

Funksioni `sendCancellationEmail` zgjidh emailin e marrësit nga Firebase Auth,
sipas `booking.ownerUid`. Dërguesi është `zzha.filozofik@uni-pr.edu`, përmes
`smtp.gmail.com:587` me STARTTLS. Emaili në shqip përfshin titullin, datën, orën,
sallën dhe arsyen e saktë të anulimit. Nuk përdoret fjalëkalimi i zakonshëm i Gmail.

## Aktivizimi që ende kërkohet

Kodi është gati, por dërgimi kërkon konfigurimin e shërbimit:

1. Projekti Firebase `filozofiku` duhet të ketë planin Blaze për Cloud Functions.
   Aktivizimi i faturimit bëhet nga pronari i projektit; kodi nuk e aktivizon.
2. Në llogarinë `zzha.filozofik@uni-pr.edu`, krijoni një Google App Password,
   nëse politika e Google Workspace e lejon. Kjo zakonisht kërkon verifikimin
   me dy hapa. Mos e vendosni fjalëkalimin në chat, Git ose në frontend.
3. Ruajeni drejtpërdrejt si sekret, nga terminali:

   ```sh
   firebase functions:secrets:set CANCELLATION_SMTP_PASSWORD --project filozofiku
   ```

4. Instaloni varësitë dhe publikoni vetëm funksionin përkatës:

   ```sh
   npm ci --prefix functions
   firebase deploy --only functions:cancellation-notifications --project filozofiku
   ```

   Parametrat publikë kanë parazgjedhjet në `.env.example`; vetëm fjalëkalimi
   ruhet në Secret Manager. Nëse App Password nuk lejohet nga administratori
   i Google Workspace, duhet autorizim tjetër (p.sh. OAuth ose SMTP relay)
   dhe përshtatja përkatëse e konfigurimit përpara publikimit.

5. Aktivizoni dokumentet që kanë mbetur `pending` para publikimit të funksionit:

   ```sh
   node scripts/requeue-cancellation-notifications.mjs
   node scripts/requeue-cancellation-notifications.mjs --apply
   ```

6. Verifikoni një njoftim të autorizuar dhe statusin `sent`. Testet automatike
   përdorin transport të rremë dhe nuk dërgojnë email real.

## Dështimet dhe riprovimi

`pending → sending → sent` regjistron pranimin e emailit nga SMTP. Marrësi
zgjidhet në server; përdoruesi anulues nuk mund të zgjedhë një adresë tjetër.
Dështimet e përkohshme riprovohen deri në pesë tentativa, pastaj shënohen `failed`.
Kontrolloni funksionin dhe dokumentet `failed`; korrigjoni konfigurimin përpara
riprovimit. Një operator i besuar mund ta kthejë një dështim në `pending`, me
`attempts: 0`, përmes Admin SDK. Rregullat nuk lejojnë këtë veprim nga shfletuesi.

Një lease transaksional pengon dërgimet e njëkohshme dhe dokumentet `sent` nuk
ridërgohen. SMTP nuk ofron garanci exactly-once: nëse procesi ndalet pas pranimit
nga SMTP dhe para ruajtjes së statusit, riprovimi mund të krijojë një kopje të dytë.
Përdoret i njëjti Message-ID për riprovimet. Nuk regjistrohen kredenciale në log.
