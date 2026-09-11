/**
 * Fidelity -> YNAB balance sync (Google Apps Script).
 *
 * Reads Fidelity daily-balance emails out of Gmail, compares each account's
 * balance against YNAB, and posts a balance-adjustment transaction for any
 * account that drifted by more than MIN_DIFFERENCE_DOLLARS.
 *
 * All configuration lives in Script Properties
 * (Project Settings -> Script properties). See README.md for the full list.
 */

// Ignore sub-cent rounding noise between Fidelity and YNAB.
const MIN_DIFFERENCE_DOLLARS = 0.01;

/**
 * Loads and validates configuration from Script Properties.
 * @returns {Object} config
 */
function getConfig_() {
  const props = PropertiesService.getScriptProperties();

  const required = (name, hint) => {
    const value = props.getProperty(name);
    if (!value) {
      throw new Error(
        'Missing required Script Property "' + name + '". ' +
        'Set it in Project Settings -> Script properties.' +
        (hint ? ' ' + hint : '')
      );
    }
    return value;
  };
  const optional = (name, fallback) => props.getProperty(name) || fallback;

  const mapJson = required(
    'FIDELITY_YNAB_ACCOUNT_MAP_JSON',
    'Expected JSON like {"XXXXX1234":"<ynab-account-uuid>", ...}.'
  );
  let accountMap;
  try {
    accountMap = JSON.parse(mapJson);
  } catch (e) {
    throw new Error(
      'Script Property "FIDELITY_YNAB_ACCOUNT_MAP_JSON" is not valid JSON: ' + e.message
    );
  }
  if (!accountMap || typeof accountMap !== 'object' || Array.isArray(accountMap) ||
      Object.keys(accountMap).length === 0) {
    throw new Error(
      'Script Property "FIDELITY_YNAB_ACCOUNT_MAP_JSON" must be a non-empty JSON object ' +
      'mapping Fidelity account IDs (as they appear in the email, e.g. "XXXXX1234") ' +
      'to YNAB account UUIDs.'
    );
  }

  return {
    ynabAccessToken: required(
      'YNAB_ACCESS_TOKEN',
      'Create one in YNAB -> Developer settings.'
    ),
    ynabBudgetId: required(
      'YNAB_BUDGET_ID',
      'Find it in your YNAB budget URL or via the YNAB API.'
    ),
    gmailLabel: required(
      'GMAIL_INVESTMENTS_LABEL',
      'Gmail label name to search, e.g. "finances-fidelity-daily-balance".'
    ),
    gmailLabelId: required(
      'GMAIL_INVESTMENTS_LABEL_ID',
      'Gmail label ID for messages to process.'
    ),
    gmailDoneLabelId: required(
      'GMAIL_INVESTMENTS_DONE_LABEL_ID',
      'Label ID applied after a successful run.'
    ),
    gmailErrorLabelId: required(
      'GMAIL_INVESTMENTS_ERROR_LABEL_ID',
      'Label ID applied when the YNAB call fails.'
    ),
    accountIdToYnab: accountMap,
    // Optional knobs
    memoPrefix: optional('SYNC_MEMO_PREFIX', 'Fidelity'),
    payeeName: optional('SYNC_PAYEE_NAME', 'Balance Adjustment'),
  };
}

/**
 * Extracts account ID and total account value from a Fidelity balance email.
 * @param {string} body - The message body text
 * @returns {{accountId: string, totalValue: string} | null}
 */
function parseMessageBody_(body) {
  // Extract account ID: "Account: XXXXX1234"
  const accountIdMatch = body.match(/Account:\s*(\S+)/);
  const accountId = accountIdMatch ? accountIdMatch[1] : null;

  // Extract total account value: "Total Account Value: $263,363.58"
  const totalValueMatch = body.match(/Total Account Value:\s*\$([\d,]+\.\d{2})/);
  const totalValue = totalValueMatch ? totalValueMatch[1] : null;

  if (accountId && totalValue) {
    return {
      accountId: accountId,
      totalValue: totalValue
    };
  }

  return null;
}

function main() {
  const config = getConfig_();
  const ynab = new YNAB(config.ynabAccessToken, config.ynabBudgetId);

  // 1. Get message IDs
  const messageIds = (Gmail.Users.Messages.list('me', { 'q': 'label:' + config.gmailLabel }).messages || [])
    .map(m => m.id);

  // 2. Get messages
  const messages = messageIds.map(id => GmailApp.getMessageById(id));

  // 3. Parse message bodies to extract account ID and total value
  const parsedData = messages.map(message => {
    const body = message.getPlainBody();
    const parsed = parseMessageBody_(body);
    return {
      messageId: message.getId(),
      parsed: parsed
    };
  }).filter(item => item.parsed !== null);

  // 4. Get YNAB balances for each account
  const dataWithYnabBalances = parsedData.map(item => {
    const fidelityAccountId = item.parsed.accountId;
    const ynabAccountId = config.accountIdToYnab[fidelityAccountId];

    let ynabBalance = null;
    if (ynabAccountId) {
      try {
        const accountDetails = ynab.getAcountDetails(ynabAccountId);
        ynabBalance = accountDetails.balance / 1000; // YNAB stores balance in milliunits
      } catch (error) {
        console.error('Error fetching YNAB balance for account ' + fidelityAccountId + ':', error);
      }
    } else {
      console.warn('No YNAB account mapped for Fidelity account ' + fidelityAccountId + '; skipping.');
    }

    const fidelityBalance = parseFloat(item.parsed.totalValue.replace(/,/g, ''));
    const difference = ynabBalance !== null ? fidelityBalance - ynabBalance : null;

    return {
      messageId: item.messageId,
      fidelityAccountId: fidelityAccountId,
      fidelityBalance: fidelityBalance,
      ynabAccountId: ynabAccountId,
      ynabBalance: ynabBalance,
      difference: difference
    };
  });

  // 5. Create YNAB transactions for accounts with meaningful differences
  const transactionsToCreate = dataWithYnabBalances
    .filter(item => item.ynabAccountId && item.difference !== null &&
      Math.abs(item.difference) > MIN_DIFFERENCE_DOLLARS)
    .map(item => {
      const today = new Date();
      const dateString = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

      return {
        account_id: item.ynabAccountId,
        date: dateString,
        amount: Math.round(item.difference * 1000), // Convert dollars to milliunits
        payee_name: config.payeeName,
        category_id: null,
        cleared: 'cleared',
        approved: true,
        memo: config.memoPrefix + ' ' + item.fidelityAccountId + ' balance sync'
      };
    });

  // Create transactions in YNAB
  let transactionsCreated = 0;
  let transactionError = null;
  if (transactionsToCreate.length > 0) {
    try {
      ynab.createTransactions(transactionsToCreate);
      transactionsCreated = transactionsToCreate.length;
      console.log('Created ' + transactionsCreated + ' transactions in YNAB');
    } catch (error) {
      console.error('Error creating YNAB transactions:', error);
      transactionError = error.toString();
    }
  }

  // 6. Update Gmail labels based on whether there were errors
  if (messageIds.length > 0) {
    try {
      const removeLabelId = config.gmailLabelId;
      // Use error label if there were any errors, otherwise use done label
      const addLabelId = transactionError
        ? config.gmailErrorLabelId
        : config.gmailDoneLabelId;

      Gmail.Users.Messages.batchModify({
        ids: messageIds,
        removeLabelIds: [removeLabelId],
        addLabelIds: [addLabelId]
      }, 'me');

      const labelType = transactionError ? 'error' : 'done';
      console.log('Updated labels for ' + messageIds.length + ' messages (' + labelType + ')');
    } catch (error) {
      console.error('Error updating Gmail labels:', error);
    }
  }

  return {
    transactionsCreated: transactionsCreated,
    messagesProcessed: messageIds.length,
    result: transactionError ? null : 'success',
    error: transactionError
  };
}

/**
 * Smoke test: validates Script Properties without touching Gmail or YNAB.
 * Run this from the Apps Script editor after configuring properties.
 */
function testConfig() {
  const config = getConfig_();
  console.log('Config OK.');
  console.log('Budget ID: ' + config.ynabBudgetId);
  console.log('Gmail label: ' + config.gmailLabel);
  console.log('Mapped Fidelity accounts: ' + Object.keys(config.accountIdToYnab).join(', '));
  return 'OK';
}
