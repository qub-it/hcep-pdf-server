
'use strict';

class PagePool {
    constructor(pages, options = {}) {
        if (!Array.isArray(pages) || pages.length === 0) {
            throw new Error('PagePool requires at least one page');
        }

        this.debug = options.debug || console.error;
        this.acquireTimeout = options.acquireTimeout ?? 30000;

        this.recoverInterval = options.recoverInterval ?? 5000;
        this.onBrowserDisconnected = options.onBrowserDisconnected || null;

        this.closed = false;
        this.waiters = [];
        this.recoverTimer = null;
        this.disconnectedBrowsers = new Set();

        this.slots = pages.map(page => ({
            page,
            browser: page.browser(),
            busy: false,
            recycling: false,
            failed: false,
            releasePromise: null
        }));

        this.watchBrowsers();
    }

    // A crashed/killed browser cannot be recovered by opening new pages:
    // every newPage() call would fail forever. Surface it so the owner can
    // terminate the process and let the orchestrator restart it.
    watchBrowsers() {
        const browsers = new Set(this.slots.map(slot => slot.browser));

        for (const browser of browsers) {
            if (!browser || typeof browser.on !== 'function') {
                continue;
            }

            browser.on('disconnected', () => {
                if (this.closed) {
                    return;
                }

                this.disconnectedBrowsers.add(browser);

                this.debug('Browser disconnected');

                if (this.onBrowserDisconnected) {
                    this.onBrowserDisconnected(browser);
                }
            });
        }
    }

    isBrowserConnected(browser) {
        if (this.disconnectedBrowsers.has(browser)) {
            return false;
        }

        // Puppeteer >= 22 exposes `connected`; older versions `isConnected()`.
        if (typeof browser.connected === 'boolean') {
            return browser.connected;
        }

        if (typeof browser.isConnected === 'function') {
            return browser.isConnected();
        }

        return true;
    }

    isHealthy() {
        if (this.closed) {
            return false;
        }

        return this.slots.some(slot =>
            !slot.failed &&
            this.isBrowserConnected(slot.browser)
        );
    }

    scheduleRecovery() {
        if (this.closed || this.recoverTimer || this.recoverInterval <= 0) {
            return;
        }

        this.recoverTimer = setTimeout(async () => {
            this.recoverTimer = null;

            try {
                await this.recoverFailedPages();
            } catch (e) {
                this.debug('Scheduled page recovery failed:', e.message);
            }

            if (this.slots.some(slot => slot.failed)) {
                this.scheduleRecovery();
            }
        }, this.recoverInterval);

        if (typeof this.recoverTimer.unref === 'function') {
            this.recoverTimer.unref();
        }
    }

    findAvailableSlot() {
        return this.slots.find(slot =>
            !slot.busy &&
            !slot.recycling &&
            !slot.failed &&
            slot.page !== null
        );
    }

    dispatch() {
        if (this.closed) {
            return;
        }

        while (this.waiters.length > 0) {
            const slot = this.findAvailableSlot();

            if (!slot) {
                return;
            }

            const waiter = this.waiters.shift();

            if (!waiter.active) {
                continue;
            }

            waiter.active = false;

            if (waiter.timer) {
                clearTimeout(waiter.timer);
            }

            slot.busy = true;

            let released = false;

            waiter.resolve({
                page: slot.page,

                release: () => {
                    if (released) {
                        return Promise.resolve();
                    }

                    released = true;

                    return this.release(slot);
                }
            });
        }
    }

    acquire(timeout = this.acquireTimeout) {
        if (this.closed) {
            return Promise.reject(
                new Error('PagePool is closed')
            );
        }

        const slot = this.findAvailableSlot();

        if (slot) {
            slot.busy = true;

            let released = false;

            return Promise.resolve({
                page: slot.page,

                release: () => {
                    if (released) {
                        return Promise.resolve();
                    }

                    released = true;

                    return this.release(slot);
                }
            });
        }

        return new Promise((resolve, reject) => {
            const waiter = {
                resolve,
                reject,
                active: true,
                timer: null
            };

            if (timeout > 0) {
                waiter.timer = setTimeout(() => {
                    if (!waiter.active) {
                        return;
                    }

                    waiter.active = false;

                    const index = this.waiters.indexOf(waiter);

                    if (index !== -1) {
                        this.waiters.splice(index, 1);
                    }

                    reject(
                        new Error('Timeout waiting for available page')
                    );
                }, timeout);
            }

            this.waiters.push(waiter);

            this.dispatch();
        });
    }

    release(slot) {
        if (!slot.busy || slot.recycling) {
            return slot.releasePromise || Promise.resolve();
        }

        slot.recycling = true;

        slot.releasePromise = this.recycle(slot);

        return slot.releasePromise;
    }

    async recycle(slot) {
        const oldPage = slot.page;

        slot.page = null;

        try {
            if (oldPage) {
                try {
                    await oldPage.close();
                } catch (e) {
                    this.debug(
                        'Page close failed:',
                        e.message
                    );
                }
            }

            if (this.closed) {
                return;
            }

            const newPage = await slot.browser.newPage();

            if (this.closed) {
                await newPage.close();
                return;
            }

            slot.page = newPage;
            slot.failed = false;

            this.debug('Page recycled successfully');

        } catch (e) {
            slot.page = null;
            slot.failed = true;

            this.debug(
                'Page recycling failed:',
                e.message
            );

            this.scheduleRecovery();

        } finally {
            slot.busy = false;
            slot.recycling = false;
            slot.releasePromise = null;

            this.dispatch();
        }
    }

    async withPage(callback, timeout = this.acquireTimeout) {
        const lease = await this.acquire(timeout);

        try {
            return await callback(lease.page);
        } finally {
            // Recycle in the background so the caller can respond immediately.
            // The slot stays busy/recycling until the new page is ready, so
            // pool capacity is unaffected; close() awaits slot.releasePromise.
            lease.release().catch(e => {
                this.debug('Background page release failed:', e.message);
            });
        }
    }

    async recoverFailedPages() {
        if (this.closed) {
            return;
        }

        const failedSlots = this.slots.filter(slot =>
            slot.failed &&
            !slot.busy &&
            !slot.recycling &&
            this.isBrowserConnected(slot.browser)
        );

        await Promise.all(
            failedSlots.map(async slot => {
                slot.recycling = true;

                try {
                    const newPage = await slot.browser.newPage();

                    if (this.closed) {
                        await newPage.close();
                        return;
                    }

                    slot.page = newPage;
                    slot.failed = false;

                    this.debug('Failed page recovered successfully');

                } catch (e) {
                    this.debug(
                        'Page recovery failed:',
                        e.message
                    );

                } finally {
                    slot.recycling = false;
                    this.dispatch();
                }
            })
        );
    }

    getStatus() {
        return {
            total: this.slots.length,

            available: this.slots.filter(slot =>
                !slot.busy &&
                !slot.recycling &&
                !slot.failed &&
                slot.page !== null
            ).length,

            busy: this.slots.filter(
                slot => slot.busy
            ).length,

            recycling: this.slots.filter(
                slot => slot.recycling
            ).length,

            failed: this.slots.filter(
                slot => slot.failed
            ).length,

            waiting: this.waiters.filter(
                waiter => waiter.active
            ).length,

            browserConnected: this.slots.every(slot =>
                this.isBrowserConnected(slot.browser)
            ),

            healthy: this.isHealthy(),

            closed: this.closed
        };
    }

    async close() {
        if (this.closed) {
            return;
        }

        this.closed = true;

        if (this.recoverTimer) {
            clearTimeout(this.recoverTimer);
            this.recoverTimer = null;
        }

        for (const waiter of this.waiters.splice(0)) {
            waiter.active = false;

            if (waiter.timer) {
                clearTimeout(waiter.timer);
            }

            waiter.reject(
                new Error('PagePool is closed')
            );
        }

        await Promise.all(
            this.slots.map(slot =>
                slot.releasePromise || Promise.resolve()
            )
        );

        await Promise.all(
            this.slots.map(async slot => {
                if (!slot.page) {
                    return;
                }

                try {
                    await slot.page.close();
                } catch (e) {
                    this.debug(
                        'Page close during shutdown failed:',
                        e.message
                    );
                }

                slot.page = null;
            })
        );

        this.debug('PagePool closed');
    }
}

module.exports = PagePool;
