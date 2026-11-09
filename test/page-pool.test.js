const assert = require('assert');
const { EventEmitter } = require('events');
const PagePool = require('../app/page-pool');

const createBrowser = () => {
  const browser = new EventEmitter();
  browser.connected = true;
  browser.failNewPage = false;
  browser.newPage = async () => {
    if (browser.failNewPage) {
      throw new Error('newPage failed');
    }
    return createPage(browser);
  };
  return browser;
};

const createPage = browser => ({
  close: async () => {},
  browser: () => browser
});

const silent = () => {};

// withPage() recycles in the background; let that settle.
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

describe('PagePool health and recovery', () => {
  let pool;

  afterEach(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  it('is healthy when pages are available and browser is connected', () => {
    const browser = createBrowser();
    pool = new PagePool([createPage(browser)], { debug: silent });
    assert.strictEqual(pool.isHealthy(), true);
  });

  it('calls onBrowserDisconnected and reports unhealthy when browser disconnects', () => {
    const browser = createBrowser();
    let notified = 0;
    pool = new PagePool([createPage(browser)], {
      debug: silent,
      onBrowserDisconnected: () => { notified++; }
    });

    browser.connected = false;
    browser.emit('disconnected');

    assert.strictEqual(notified, 1);
    assert.strictEqual(pool.isHealthy(), false);
    assert.strictEqual(pool.getStatus().browserConnected, false);
  });

  it('reports unhealthy when every slot has failed', async () => {
    const browser = createBrowser();
    pool = new PagePool([createPage(browser)], {
      debug: silent,
      recoverInterval: 0
    });

    browser.failNewPage = true;
    await pool.withPage(async () => {});
    await settle();

    assert.strictEqual(pool.getStatus().failed, 1);
    assert.strictEqual(pool.isHealthy(), false);
  });

  it('automatically recovers failed slots', async () => {
    const browser = createBrowser();
    pool = new PagePool([createPage(browser)], {
      debug: silent,
      recoverInterval: 10
    });

    browser.failNewPage = true;
    await pool.withPage(async () => {});
    await settle();
    assert.strictEqual(pool.getStatus().failed, 1);

    browser.failNewPage = false;
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(pool.getStatus().failed, 0);
    assert.strictEqual(pool.getStatus().available, 1);
    assert.strictEqual(pool.isHealthy(), true);
  });

  it('serves queued requests once a failed slot is recovered', async () => {
    const browser = createBrowser();
    pool = new PagePool([createPage(browser)], {
      debug: silent,
      recoverInterval: 10,
      acquireTimeout: 1000
    });

    browser.failNewPage = true;
    await pool.withPage(async () => {});

    const pending = pool.withPage(async () => 'done');
    browser.failNewPage = false;

    assert.strictEqual(await pending, 'done');
  });

  it('returns the result without waiting for the page to be recycled', async () => {
    const browser = createBrowser();
    const originalNewPage = browser.newPage;
    let releaseNewPage;
    browser.newPage = () => new Promise(resolve => {
      releaseNewPage = () => resolve(originalNewPage());
    });

    pool = new PagePool([createPage(browser)], { debug: silent });

    const result = await pool.withPage(async () => 'pdf');
    await settle();

    // Result delivered while the slot is still recycling.
    assert.strictEqual(result, 'pdf');
    assert.strictEqual(pool.getStatus().recycling, 1);
    assert.strictEqual(pool.getStatus().available, 0);

    releaseNewPage();
    await settle();

    assert.strictEqual(pool.getStatus().recycling, 0);
    assert.strictEqual(pool.getStatus().available, 1);
  });
});
