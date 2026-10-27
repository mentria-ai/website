# Legacy unlock fixtures and the migrate phase

`scripts/unlock-browser-check.mjs` makes real lock state with the code from before the one unlock, then moves the same browser session to the new build and checks that every person migrates without losing anything.

- **Seed phase.** It serves a build of the old code, opens each page in headless Chrome and clicks through the real setup screens with a virtual passkey authenticator. Nothing writes storage directly; the script only reads state back to report it.
- **Migrate phase.** It switches the server root to a beta build of the new code in the same browser contexts, then drives each group through the real pages: the new build arriving, the tester switch, Later, the first link, reloads, a reopen after the grace, the one unlock, and the retirement of the old locks. G9's backup files are then restored on fresh devices that already have a keyring.

## Run

```bash
git checkout 9570a53
npm run build && rm -rf "$TMPDIR/unlock-legacy-build" && mv build "$TMPDIR/unlock-legacy-build"
git checkout -
RELEASE_TAG=beta npx @11ty/eleventy --quiet --output="$TMPDIR/unlock-beta"
node scripts/unlock-browser-check.mjs "$TMPDIR/unlock-beta" "$TMPDIR/unlock-legacy-build"
node scripts/unlock-browser-check.mjs "$TMPDIR/unlock-beta" "$TMPDIR/unlock-legacy-build" --only=G4,G5
node scripts/unlock-browser-check.mjs - "$TMPDIR/unlock-legacy-build"
```

- Never run `git fetch --depth` in a local clone: it makes the whole clone shallow. A local checkout already has 9570a53; the CI step for `unlock-storage-check.mjs` fetches it only when `git cat-file -e` says it is missing.
- The first argument is the new build, which must be a beta build (`RELEASE_TAG=beta`); `-` means seed only.
- The script needs Chrome at `/Applications/Google Chrome.app`, `puppeteer-core` in `node_modules` (link the main checkout's folder in a worktree) and port 8099 free. `UNLOCK_PORT=<port>` picks another port.
- A full run (seed and migrate) takes about six minutes: seeding about two, 90 s of it in G2b, and the migrate phase about four, one of them a real wait with every page closed. `--only=` takes a comma list and runs the same steps for those groups only.

Each seeded group prints `SEEDED <group>` followed by the `localStorage` key names, the IndexedDB database names, the service worker scopes and cache names, non-secret facts about each legacy lock (field names, passkey ids), the passkeys on the authenticator, the secrets (values only for the ones the script chose) and any downloaded files. A group that cannot be seeded prints `FAIL <group>`.

Each migrate check prints `PASS <group>: <check>` with a line of facts, or `FAIL <group>: <check>` with the reason and the script line. A check fails on a broken assertion, a native dialog or any new uncaught page error. A failed check skips the rest of that group (`SKIP ... (needs "<check>")`), except the Remember check (step 6), which never blocks later steps; other groups go on. The run ends with one line that times the two phases separately (`seed: 10/10 groups (<s>); migrate: <n> passed, <n> failed, <n> skipped (<s>); total <s>`), a per-group summary, and exit 1 when anything failed or was skipped.

## Groups

| Group | Made on | What it holds | Secrets returned |
|---|---|---|---|
| G2a | Comms onboarding | `identity.vault` with `pass` (the 20-symbol code) and `prf`; `comms.idkeys`, `comms.profile` | captured recovery code |
| G2b | Comms onboarding with the authenticator removed for the enrol step | `identity.vault` with `pass` only; Comms shows "Welcome back" with the code field on reopen | captured recovery code |
| G2c | G2a, then About: passkey unlock and "Remember this device" | `identity.vault` with `pass`, `prf`, `device`; IndexedDB `mentria-identity`; About opens unlocked on reload | captured recovery code |
| G3 | About identity setup and Add passkey | `identity.vault` with `pass` (`correct horse 42`) and `prf` | passphrase |
| G4 | TOTP setup, Add quick unlock in the same page load, two accounts | `totp.vault` with `pass`, `prf`, `secrets`; the mandatory backup of the first account in `G4/` | passphrase, backup passphrase, accounts |
| G4n | TOTP setup, one account | `totp.vault` with `pass`, `secrets` (no `prf`); its mandatory backup in `G4n/` | passphrase, backup passphrase, account |
| G5 | Quick Notes: two notes, the second locked | `quick_notes.blob` with one `enc` note, `quick_notes.cred_id`, `quick_notes.salt`; the locked note reopens and decrypts after a reload | note titles and bodies |
| G6 | Finance setup on the store page: passkey on, device unlock on | `mentria-ext-finance` meta `wraps` = `pass`, `recovery`, one `prf`, `device`; opens by device unlock on reload | passphrase, captured recovery code |
| G6p | Finance setup with a passkey, then Settings > Add passkey | `wraps.prf` with two entries, no `device`; unlock screen on reload | passphrase, captured recovery code |
| G9 | TOTP (one account), one plain note, Finance (passphrase only), About identity (passphrase only), then About > Export | `G9/mentria-totp-backup-<date>.json` (v2 envelope) and `G9/mentria-backup-<date>.json` (v3) | every passphrase used, the full backup passphrase, captured Finance recovery code |

The values the script chooses are in `CHOSEN` at the top of the script: `correct horse 42` (identity), `totp pass 1234`, `totp backup 5678` (TOTP backup files), `finance pass 12345`, `full backup 24680` (G9 full backup). Recovery codes made by the pages are captured from the screen, returned to the caller and never printed.

Files land in `$TMPDIR/unlock-fixtures/<group>/`; a group's folder is emptied when that group starts.

## Migrate phase

`PLANS` in the script says, per group, which page is the service page, how the new build arrives, which old unlock is used for Later and for the link, what the setup sheet must offer, and how the one unlock is done afterwards.

| Group | Page | New build | Later after | Link after | Setup sheet | One unlock |
|---|---|---|---|---|---|---|
| G2a | `/comms/`, then `/about/` | worker removed | code | passkey | saved code, typed and checked; keyring passkey | passkey |
| G2b | `/comms/`, then `/about/` | worker removed | code | code | the typed code, preselected; keyring passkey | the old Comms code |
| G2c | `/about/`, then `/comms/` | worker removed | old device key, then "Set up the one unlock" | same | new code; keyring passkey | passkey |
| G3 | `/about/` | worker removed | passkey | passphrase | new code; passphrase kept | passphrase |
| G4 | `/tools/totp/` | Update chip | passphrase | passkey | new code; keyring passkey | passkey |
| G4n | `/tools/totp/` | worker removed | passphrase | passphrase | new code; passphrase kept | passphrase |
| G5 | `/tools/quick-notes/` | worker removed | the locked note's Unlock | same | new code | code |
| G6 | `/extensions/finance/` | Update chip | device unlock (sheet opens by itself) | same | Finance code, typed and checked | Remember this device |
| G6p | `/extensions/finance/` | worker removed | passphrase | passkey | Finance code, typed and checked | Finance code |
| G9 | `/about/`, then `/tools/totp/` and `/extensions/finance/` | worker removed | TOTP passphrase | About passphrase and setup; then, with the keyring locked, the TOTP passphrase and the card; then the Finance passphrase into the open keyring with no sheet | new code; passphrase kept | passphrase |

Steps, in order, per group (checks are named as printed):

1. **The new build arrives.** Most groups: in the group's page, unregister the service worker and delete every Cache Storage entry (site data stays). G4 and G6: the page is opened under the legacy worker, the real Update chip (`#m-update`, then `#m-update-go`) is pressed, and the check waits until the page runs the beta build under the new worker and the legacy cache is gone. A storage snapshot taken here is the baseline; for G4 and G6 it is taken before the first new-build load of the service page.
2. **The tester switch turns on**: the checkbox on `/beta/unlock/`.
3. **Later leaves everything exactly as before**: the old unlock (with the link line shown above it), then Not now in the setup sheet. The service must open the old way, no keyring may exist, and a full snapshot (every `localStorage` value, every IndexedDB record) may differ from the baseline only in the volatile keys listed in `VOLATILE` (visit counters, the tester switch).
4. **Link**: a fresh load, the old unlock, then the whole setup sheet. The service must open with its real data: TOTP codes match RFC 6238 for the chosen secrets, the identity secret matches the vault kcv and opens the Comms keys, the locked note shows its text, the Finance ledger opens.
5. **Every legacy wrap is still present**: each old wrap is byte-identical to the baseline, and the old identity device key still decrypts the vault's `device` wrap to the identity (kcv match, G2c). Expected changes: TOTP gains only `kid` (its key set is checked exactly); the locked note moves to the notes key; Finance gains `linked`. A keyring device key may appear only for a person who had a device unlock (G2c, G6), and a device wrap may go only when that device unlock was handed to the keyring's Remember this device; the handed-over record must keep exactly its other keys. Everything else the link writes must match `LINK_ALLOWED`. The Finance ledger still holds its synced `vaultwrap` records.
6. **A device unlock the person had on carries over to Remember this device** (only groups whose legacy state had one: G2c identity, G6 Finance): the keyring must have its device key after the link.
7. **A reload opens without a screen**: a page probe (`PROBE`, installed before every document) records any card (`.m-unlock`), sheet (`.m-ulayer`), old lock screen (`#about-identity-unlock`, `#comms-id-locked`, `#comms-onboard`, `#totp-locked`, `#qn-unlock-btn`, `.flock`) or WebAuthn call; none may appear, and the launch decision must be `continue`.
8. **Closing all pages and opening one after the grace relocks**: every group's page goes to `about:blank`, the script waits until 62 s have passed since the last one, then reopens the service page in the same tab. The decision must be `reopen` with the tab marker present and the last-seen time older than 60 s, and the card must show (the probe must see it). G6 and G2c reopen by themselves through Remember this device, which their legacy device unlock was handed to.
9. **One unlock then opens every linked service**: one unlock in the card, then each linked service page opens with no screen.
10. **An old device seen 5 days ago keeps the old locks**: from `/robots.txt` with no other page of that device open (the runtime heals cross-tab record overwrites), every link is moved back 31 days and `devices.legacy` is added with `keyring: 0` and `lastSeen` 5 days ago. The old wraps must still be the ones from link time. Each service page opens; `retirement()` must report only `old-device`, nothing may be deleted, retired or signalled, and the old identity device key still opens the identity.
11. **After 31 days the service deletes exactly its old locks**: `devices.legacy` moves to 31 days ago. Each service page must mark itself retired and delete exactly the legacy wraps that were present at link time (from `RETIRES`; never an empty set), signal each old passkey once through `signalUnknownCredential` (stubbed by the probe), keep its data, and change nothing outside `RETIRE_ALLOWED`. Every signalled id must be a credential on the group's authenticator and none may be a keyring passkey. A second open signals nothing.
12. **After retirement the one unlock is the only lock and still opens everything**: Lock, then the service page shows only the card (none of the old unlock controls in `oldForms`), and one unlock opens every page of the group again.

| Service | Deleted by retirement | Kept |
|---|---|---|
| identity | `identity.vault` `pass`, `prf`, `device`; IndexedDB `mentria-identity` `device-wrap` | `kcv`, `v: 3`, `linked: true` |
| totp | `totp.vault` `pass`, `prf` | `secrets`, `kid`, `v: 2`, `linked: true` |
| notes | `quick_notes.salt`, `quick_notes.cred_id`, `mentria-qn-salt`, `mentria-qn-cred` | the notes |
| finance | meta `wraps.pass`, `recovery`, `prf`, `device`; ledger `vaultwrap` `pass`, `recovery` | the ledger, `kcv` |

After G9 migrates, two fresh contexts stand in for other devices. Each turns the switch on and makes a keyring on `/beta/unlock/`, then restores through About:

- **The v3 full backup restores on a device with a keyring**: the keyring stays the device's own; identity, TOTP and Finance come back and each links into that keyring with its old passphrase; the plain note reads back.
- **The TOTP-only backup restores on a device with a keyring**: the v2 file restores, its passphrase links the vault into the keyring, and the codes match.

## Browser setup

- One Chrome with a fresh profile at `$TMPDIR/unlock-check-profile` (`unlock-check-profile-<port>` with `UNLOCK_PORT`, so parallel runs on different ports never share or delete each other's profile), deleted at the start and the end of a run.
- One incognito-like browser context per group, so groups never see each other's storage, and one page target per group. Each page gets its own virtual authenticator (`AUTHENTICATOR`: ctap2, internal, resident keys, user verification, PRF). Passkeys live on that authenticator for that page target only: a second page in the same context would not see them, so every step of a group runs in its one page, and "closing all pages" sends that page to `about:blank`.
- All hosts except `localhost` fail to resolve, so Comms never reaches outside relays.
- `scripts/unlock-serve.mjs`: `serve(port)` returns `{ ready, setRoot(dir), root(), close() }`, sends the same content types as `scanner-serve.mjs` and `Cache-Control: no-store`. The root can change while pages stay open.
- Clicks scroll the target into view first (`scrollIntoView` also scrolls the store page around the Finance frame), and site dialogs are answered by clicking until they close.

## Using the seed from another script

```js
import { launch, openRig, seed, migrate } from './unlock-browser-check.mjs';
const browser = await launch();
const rig = await openRig(browser, 'G4');
const state = await seed(rig.page, 'G4');
```

`rig` holds `context`, `page`, `cdp` (the page's CDP session), `authenticatorId`, `downloads`, `pageErrors` and `nativeDialogs`. `state` holds `secrets`, `legacy`, `credentials` (from `WebAuthn.getCredentials`, private keys dropped; ids in standard base64, the same form as the `legacy` passkey ids), `storage`, `files`, `backupHeaders` and the page copy shown in dialogs (`messages`). `migrate(browser, [{ rig, out: state }])` runs the migrate phase once the server root points at the new build. G2b has a new, empty authenticator (`rig.authenticatorId`); the removed one is in `removedAuthenticatorIds`.

## Legacy behaviour seen while seeding

- TOTP: Add quick unlock after a passphrase unlock fails with "key is not extractable" and leaves a passkey on the authenticator that the vault never records. Right after setup, in the same page load, it works; G4 enrols there.
- Comms: when the passkey step cannot reach an authenticator, onboarding waits out its 90 s timeout before it shows the code and the "add a passkey" fallback.
- The legacy worker does not precache `/extensions/finance/`, so after the root switch it serves that page from the network (the new build) while it still controls the tab.

## Beta notes

- Pages that never load the bootstrap (pages with `layout: null`, such as some games) send no heartbeat and hold no open lock. With only such a page open for longer than the grace, the next Mentria page that opens counts as a reopen and asks to unlock again.
- A same-origin frame (the Finance app inside its store page) runs the runtime but holds no open lock and makes no launch decision; its parent page does both.
