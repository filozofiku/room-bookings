// Navigation reflects verified account access; Firestore still enforces permissions.
export const hasStaffAccess = profile => profile?.active === true && ['teacher', 'admin'].includes(profile.role);

export function setStaffNavigation(authorized, email = '') {
  for (const node of document.querySelectorAll('[data-staff-only]')) node.hidden = !authorized;
  for (const node of document.querySelectorAll('[data-staff-entry]')) node.hidden = authorized;
  for (const node of document.querySelectorAll('[data-staff-identity]')) node.textContent = authorized ? email : '';
}

// This optional enhancement never holds up the public timetable or reservations.
export async function connectStaffNavigation(config) {
  const [{initializeApp, getApps, getApp}, {getAuth, onAuthStateChanged, signOut}, {getFirestore, doc, getDoc}] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js')
  ]);
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app), db = getFirestore(app);
  let generation = 0;
  document.querySelector('[data-staff-logout]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await signOut(auth); }
    catch { location.href = 'https://filozofiku.github.io/room-bookings/'; }
    finally { button.disabled = false; }
  });
  return onAuthStateChanged(auth, async user => {
    const current = ++generation;
    setStaffNavigation(false);
    if (!user) return;
    try {
      const profile = await getDoc(doc(db, 'users', user.uid));
      if (current === generation) setStaffNavigation(profile.exists() && hasStaffAccess(profile.data()), user.email || '');
    } catch { /* Leave the staff entrance available if access cannot be verified. */ }
  });
}
