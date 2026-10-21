# Legacy unlock fixtures

`scripts/unlock-browser-check.mjs` makes real lock state with the code from before the one unlock: it serves a build of that code, opens each page in headless Chrome and clicks through the real setup screens with a virtual passkey authenticator. Nothing writes storage directly; the script only reads state back to report it. The migrate phase, added later, switches the same browser session to the new build and checks what happens to this state.

## Run

```bash
git checkout 9570a53
npm run build && mv build "$TMPDIR/unlock-legacy-build"
node scripts/unlock-browser-check.mjs - "$TMPDIR/unlock-legacy-build"
node scripts/unlock-browser-check.mjs - "$TMPDIR/unlock-legacy-build" --only=G4,G5
```

The first argument is the new build; `-` means seed only. The script needs Chrome at `/Applications/Google Chrome.app`, `puppeteer-core` in `node_modules` (link the main checkout's folder in a worktree) and port 8099 free. A full run takes about two minutes, 90 s of it in G2b.

Each group prints `SEEDED <group>` followed by the `localStorage` key names, the IndexedDB database names, the service worker scopes and cache names, non-secret facts about each legacy lock (field names, passkey ids), the passkeys on the authenticator, the secrets (values only for the ones the script chose) and any downloaded files. A group that fails prints `FAIL <group>` with the reason, and the script exits 1.

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

## Browser setup

- One Chrome with a fresh profile at `$TMPDIR/unlock-check-profile`, deleted at the start and the end of a run.
- One incognito-like browser context per group, so groups never see each other's storage, and one page target per group. Each page gets its own virtual authenticator (`AUTHENTICATOR`: ctap2, internal, resident keys, user verification, PRF). Passkeys live on that authenticator for that page target only: a second page in the same context would not see them, so every step of a group runs in its one page.
- All hosts except `localhost` fail to resolve, so Comms never reaches outside relays.
- `scripts/unlock-serve.mjs`: `serve(8099)` returns `{ ready, setRoot(dir), root(), close() }`, sends the same content types as `scanner-serve.mjs` and `Cache-Control: no-store`. The root can change while pages stay open.

## Using the seed from the migrate phase

```js
import { launch, openRig, seed, ORIGIN } from './unlock-browser-check.mjs';
const rig = await openRig(browser, 'G4');
const state = await seed(rig.page, 'G4');
```

`rig` holds `context`, `page`, `cdp` (the page's CDP session), `authenticatorId`, `downloads`, `pageErrors` and `nativeDialogs`. `state` holds `secrets`, `legacy`, `credentials` (from `WebAuthn.getCredentials`, private keys dropped; ids in standard base64, the same form as the `legacy` passkey ids), `storage`, `files`, `backupHeaders` and the page copy shown in dialogs (`messages`).

Before loading the new build:

1. Keep the same `rig`: the same context, page target, CDP session and authenticator.
2. In that page, unregister the service worker and delete every Cache Storage entry, then call `server.setRoot(newBuild)` and navigate. The legacy worker registers on the first page of every group and would otherwise keep serving the old copies. Leave `localStorage` and IndexedDB alone.
3. G2b has a new, empty authenticator (`rig.authenticatorId`); the removed one is in `removedAuthenticatorIds`. Its identity has no passkey anywhere.
4. G2c and G6 open without a prompt on load (device unlock), as they did before.

## Legacy behaviour seen while seeding

- TOTP: Add quick unlock after a passphrase unlock fails with "key is not extractable" and leaves a passkey on the authenticator that the vault never records. Right after setup, in the same page load, it works; G4 enrols there.
- Comms: when the passkey step cannot reach an authenticator, onboarding waits out its 90 s timeout before it shows the code and the "add a passkey" fallback.
