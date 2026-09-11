# Fidelity → YNAB balance sync

A [Google Apps Script](https://script.google.com) project that keeps your
[YNAB](https://www.ynab.com/) investment account balances in sync with
Fidelity, using Fidelity's daily-balance notification emails as the source
of truth.

## What it does

Each run of `main()`:

1. Finds unread Fidelity daily-balance emails in Gmail (via a label search).
2. Parses each email for the account ID (`Account: XXXXX1234`) and the
   balance (`Total Account Value: $263,363.58`).
3. Maps the Fidelity account ID to a YNAB account (configurable).
4. Compares the email balance against the current YNAB balance.
5. Posts a **balance-adjustment transaction** in YNAB for any account that
   drifted by more than $0.01, with payee "Balance Adjustment", status
   cleared + approved, and a memo like `Fidelity XXXXX1234 balance sync`.
6. Moves processed emails from the pending label to a "done" label, or to an
   "error" label if the YNAB call failed.

## Prerequisites

- A Google account with Apps Script and Gmail.
- Fidelity daily-balance notification emails, filtered in Gmail with a label.
- A [YNAB personal access token](https://api.ynab.com/) and your budget ID.
- (Optional) [clasp](https://github.com/google/clasp) to push from your machine.

## Setup

### 1. Create the Apps Script project

Create a new project at [script.google.com](https://script.google.com), then
copy in `Code.js`, `ynab.js`, and `appsscript.json`, or push with clasp
(see below). The project uses the **Advanced Gmail service**, which is
already enabled via `appsscript.json`. On first run you will be asked to
authorize the Gmail, external-request, and script scopes.

### 2. Configure Script properties

All secrets and IDs live in Script properties, never in source. In the Apps
Script editor go to **Project Settings** (gear icon) → **Script properties**
and add:

| Property | Description |
| -------- | ----------- |
| `YNAB_ACCESS_TOKEN` | YNAB personal access token (YNAB → Account Settings → Developer Settings). |
| `YNAB_BUDGET_ID` | Budget UUID, from your YNAB budget URL or the YNAB API. |
| `GMAIL_INVESTMENTS_LABEL` | Gmail **label name** searched for balance emails, e.g. `finances-fidelity-daily-balance`. |
| `GMAIL_INVESTMENTS_LABEL_ID` | Gmail label ID for the pending (to-process) label. |
| `GMAIL_INVESTMENTS_DONE_LABEL_ID` | Gmail label ID applied after a successful run. |
| `GMAIL_INVESTMENTS_ERROR_LABEL_ID` | Gmail label ID applied if the YNAB call fails. |
| `FIDELITY_YNAB_ACCOUNT_MAP_JSON` | JSON mapping Fidelity account IDs to YNAB account UUIDs (format below). |
| `SYNC_MEMO_PREFIX` | *(optional)* Memo prefix, defaults to `Fidelity`. |
| `SYNC_PAYEE_NAME` | *(optional)* YNAB payee name, defaults to `Balance Adjustment`. |

### `FIDELITY_YNAB_ACCOUNT_MAP_JSON` format

A single string value, valid JSON. Keys must match the `Account:` line in
your Fidelity emails exactly; values are YNAB account UUIDs.

```json
{
  "XXXXX1234": "00000000-0000-0000-0000-000000000001",
  "XXXXX5678": "00000000-0000-0000-0000-000000000002"
}
```

### Finding Gmail label IDs

Label IDs look like `Label_1234567890123456789`. Two easy ways to get them:

- Run a one-off Apps Script: `console.log(GmailApp.getUserLabelByName('Your Label').getId())`.
- Use the Gmail API `users.labels.list` in the [API Explorer](https://developers.google.com/gmail/api/reference/rest/v1/users.labels/list).

### 3. Verify configuration

Run the `testConfig` function once from the Apps Script editor. It validates
every Script property (including the JSON map) without touching Gmail or
YNAB, so you can catch typos before the first real run.

### 4. Create a trigger

In the editor: **Triggers** (clock icon) → **Add trigger**:

- Function: `main`
- Event source: Time-driven
- Type: Day timer, pick a time after your Fidelity emails normally arrive

`main()` returns `{ transactionsCreated, messagesProcessed, result, error }`
so failures are easy to spot in the Executions log.

## How the email parsing works

The parser expects the plain-text body of a Fidelity balance email to
contain, somewhere:

```
Account: XXXXX1234
...
Total Account Value: $263,363.58
```

Accounts not present in `FIDELITY_YNAB_ACCOUNT_MAP_JSON` are logged and
skipped. Balances that match YNAB within a cent produce no transaction.

## clasp

```bash
npm install -g @google/clasp
cp .clasp.json.example .clasp.json   # then fill in your script ID
clasp login
clasp push
```

`.claspignore` pushes only `appsscript.json`, `Code.js`, and `ynab.js`.
Local files like `client_secret.json` and `.clasp.json` are gitignored and
never pushed or committed.

## Security

- **Never commit tokens, label IDs, or account UUIDs to source.** They belong
  in Script properties (or per-user properties for multi-user add-ons).
- **Rotate any token that has ever appeared in git history** before making
  this repository public. A YNAB personal access token can be revoked in
  YNAB → Account Settings → Developer Settings and replaced.
- Script properties are visible to anyone with edit access to your Apps
  Script project, so keep that access limited.

## Files

| File | Purpose |
| ---- | ------- |
| `Code.js` | Entry point (`main`), config loading, email parsing, Gmail label flow. |
| `ynab.js` | Minimal YNAB API client (accounts, transactions, categories, months). |
| `appsscript.json` | Manifest: timezone, Advanced Gmail service, OAuth scopes. |
| `.claspignore` | Which files clasp pushes. |
| `.clasp.json.example` | Template for your local clasp config. |

## License

MIT. See [LICENSE](LICENSE).
