const YNAB_ENDPOINT = "https://api.ynab.com/v1";

class YNAB {

    constructor(accessToken, budgetId) {
      this.budgetId = budgetId;
  
      this.options = {
        "headers": {
            "Authorization": "Bearer " + accessToken
        }
      };
    }

    getAcountDetails(accountId) {
      return this._ynabApi('get', `/budgets/${this.budgetId}/accounts/${accountId}`).data.account;
    }

    createTransactions(transactions) {
      if (transactions.length <= 0) {
        return;
      }
      
      return this._ynabApi('post', `/budgets/${this.budgetId}/transactions`, {
        transactions
      });
    }

    /**
     * @returns {{ category_groups: Array<Object> }}
     */
    getCategories() {
      return this._ynabApi('get', `/budgets/${this.budgetId}/categories`).data;
    }

    /**
     * @param {string} monthIso First day of month, e.g. "2026-03-01"
     * @returns {Object} YNAB month payload (categories, budgeted, etc.)
     */
    getMonth(monthIso) {
      return this._ynabApi('get', `/budgets/${this.budgetId}/months/${monthIso}`).data.month;
    }

    /**
     * @param {string} sinceDate "YYYY-MM-DD"
     * @returns {Array<Object>} transactions
     */
    getTransactionsSince(sinceDate) {
      const path = `/budgets/${this.budgetId}/transactions?since_date=${encodeURIComponent(sinceDate)}`;
      return this._ynabApi('get', path).data.transactions;
    }
  
    /**
     * Calls the YNAB API
     *
     * @param {string} method get | post
     * @param {string} path path with optional query string
     * @param {Object=} data JSON body for mutating requests
     * @returns {Object} parsed JSON body
     */
    _ynabApi(method, path, data) {
      const m = String(method).toLowerCase();
      const options = Object.assign({}, this.options, {
        muteHttpExceptions: true,
        method: m,
      });
      if (m === 'post' || m === 'put' || m === 'patch') {
        options.contentType = 'application/json';
        options.payload = JSON.stringify(data != null ? data : {});
      }

      const response = UrlFetchApp.fetch(YNAB_ENDPOINT + path, options);
      const code = response.getResponseCode();
      const text = response.getContentText();
      if (code >= 400) {
        throw new Error('YNAB ' + code + ': ' + text);
      }
      if (!text) {
        return null;
      }
      return JSON.parse(text);
    }
  }
  
