
'use strict';

module.exports.expressApp = pages => {

  const bodyParser = require('body-parser');
  const debug = require('debug')('hcepPdfServer:expressApp');
  const express = require('express');
  const morgan = require('morgan');
  const timeout = require('connect-timeout');
  const crypto = require('crypto');
  const fs = require('fs');
  const http = require('http');
  const https = require('https');

  const PagePool = require('./page-pool');

  const { getPdfOption } = require('./pdf-option/pdf-option-lib');

  // --------------------------------------------------
  // Configuration
  // --------------------------------------------------

  const secretHash = process.env.SECRET
      ? crypto.createHash('sha256')
          .update(process.env.SECRET)
          .digest('hex')
      : null;

  const appTimeoutMsec =
      Number(process.env.HCEP_APP_TIMEOUT_MSEC) || 10000;

  const pageTimeoutMsec =
      Number(process.env.HCEP_PAGE_TIMEOUT_MSEC) || 10000;

  const sslKeyPassword =
      process.env.PDF_SERVER_TLS_KEYSTORE_PASSWORD || '';

  const listenHttpPort =
      process.env.HCEP_PORT || 8001;

  const listenHttpsPort =
      process.env.HCEP_SSL_PORT || 8002;

  const maxRequestSize =
      process.env.HCEP_MAX_REQUEST_SIZE || '10MB';

  // --------------------------------------------------
  // Page Pool
  // --------------------------------------------------

  const pageRecoverIntervalMsec =
      Number(process.env.HCEP_PAGE_RECOVER_INTERVAL_MSEC) || 5000;

  const pagePool = new PagePool(pages, {
    acquireTimeout: 30000,
    recoverInterval: pageRecoverIntervalMsec,
    debug,

    // The browser is gone (crash, OOM kill, ...). No page can be recreated,
    // so fail fast and let Docker / the orchestrator restart the container,
    // as the previous implementation did on any page error.
    onBrowserDisconnected: () => {
      console.error('Browser disconnected! process.exit(1)');
      process.exit(1);
    }
  });

  // --------------------------------------------------
  // Express
  // --------------------------------------------------

  const app = express();

  const env = app.get('env');

  console.log('env:', env);
  console.log('pages.length:', pages.length);

  if (env === 'production') {
    app.use(morgan('combined'));
  } else {
    app.use(morgan('dev'));
  }

  app.use(bodyParser.urlencoded({
    extended: false,
    limit: maxRequestSize
  }));

  app.use(bodyParser.json({
    limit: maxRequestSize
  }));

  app.use(timeout(appTimeoutMsec));

  // --------------------------------------------------
  // Authentication
  // --------------------------------------------------

  function isAuthorized(secret) {
    if (secretHash === null) {
      return true;
    }

    if (!secret || typeof secret !== 'string') {
      return false;
    }

    const hash = crypto.createHash('sha256')
        .update(secret)
        .digest();

    const expected = Buffer.from(secretHash, 'hex');

    return crypto.timingSafeEqual(hash, expected);
  }

  // --------------------------------------------------
  // Error handling
  // --------------------------------------------------

  function handlePageError(e, option) {
    console.error('Page error occurred!');
    console.error('error:', e);
    console.error('option:', option);
  }

  function sendPoolError(res, e) {
    handlePageError(e, 'PagePool');

    if (res.headersSent || res.destroyed) {
      return;
    }

    const unavailable =
        e.message === 'Timeout waiting for available page' ||
        e.message === 'PagePool is closed';

    res.status(unavailable ? 503 : 500);
    res.type('text/plain');
    res.end(unavailable
        ? 'PDF service temporarily unavailable'
        : 'Internal server error'
    );
  }

  // --------------------------------------------------
  // PDF Options
  // --------------------------------------------------

  function buildPdfOption(body) {

    let pdfOption;

    const optionsstr = body.pdfOption;

    if (optionsstr) {

      const options = JSON.parse(optionsstr);

      pdfOption = getPdfOption('A4');

      pdfOption.format = options.format;
      pdfOption.landscape = options.landscape;
      pdfOption.scale = options.scale;
      pdfOption.displayHeaderFooter = options.displayHeaderFooter;
      pdfOption.headerTemplate = options.headerTemplate;
      pdfOption.footerTemplate = options.footerTemplate;
      pdfOption.printBackground = options.printBackground;
      pdfOption.preferCSSPageSize = options.preferCSSPageSize;
      pdfOption.omitBackground = options.omitBackground;

      if (options.marginTop !== undefined) {
        pdfOption.margin.top = options.marginTop;
      }

      if (options.marginRight !== undefined) {
        pdfOption.margin.right = options.marginRight;
      }

      if (options.marginBottom !== undefined) {
        pdfOption.margin.bottom = options.marginBottom;
      }

      if (options.marginLeft !== undefined) {
        pdfOption.margin.left = options.marginLeft;
      }

      pdfOption.pageRanges = options.pageRanges;

    } else {

      pdfOption = getPdfOption(body.pdf_option);

      debug('using PDFOption:', pdfOption);

      pdfOption.displayHeaderFooter = false;

      if (body.leftMargin) {
        pdfOption.margin.left = body.leftMargin;
      }

      if (body.rightMargin) {
        pdfOption.margin.right = body.rightMargin;
      }

      if (body.topMargin) {
        pdfOption.margin.top = body.topMargin;
      }

      if (body.bottomMargin) {
        pdfOption.margin.bottom = body.bottomMargin;
      }
    }

    return pdfOption;
  }

  // --------------------------------------------------
  // Send PDF
  // --------------------------------------------------

  function sendPdf(res, buff) {
    if (res.headersSent || res.destroyed) {
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buff.length);
    res.end(buff);
  }

  // --------------------------------------------------
  // Send Screenshot
  // --------------------------------------------------

  function sendScreenshot(res, buff) {
    if (res.headersSent || res.destroyed) {
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buff.length);
    res.end(buff);
  }

  // ==================================================
  // ROOT ROUTE
  // ==================================================

  app.route('/')

      // ------------------------------------------------
      // GET: PDF from URL
      // ------------------------------------------------

      .get(async (req, res) => {

        const secret = req.query.secret;
        const url = req.query.url;

        if (!isAuthorized(secret)) {
          return res.status(401).end(
              'parameter "secret" is not set or you aren\'t authorized'
          );
        }

        if (!url) {
          return res.status(400).end(
              'get parameter "url" is not set'
          );
        }

        try {

          const buff = await pagePool.withPage(async page => {

            await page.goto(url, {
              timeout: pageTimeoutMsec,
              waitUntil: [
                'load',
                'domcontentloaded'
              ]
            });

            const pdfOption = getPdfOption('A4');

            return await page.pdf(pdfOption);
          });

          sendPdf(res, buff);

        } catch (e) {
          sendPoolError(res, e);
        }
      })

      // ------------------------------------------------
      // POST: PDF from HTML
      // ------------------------------------------------

      .post(async (req, res) => {

        const html = req.body.html;
        const secret = req.body.secret;

        if (!isAuthorized(secret)) {
          return res.status(401).end(
              'parameter "secret" is not set or you aren\'t authorized'
          );
        }

        if (!html) {
          return res.status(400).end(
              'post parameter "html" is not set'
          );
        }

        try {

          const buff = await pagePool.withPage(async page => {

            await page.setContent(html);

            const pdfOption = buildPdfOption(req.body);

            return await page.pdf(pdfOption);
          });

          sendPdf(res, buff);

        } catch (e) {
          sendPoolError(res, e);
        }
      });

  // ==================================================
  // SCREENSHOT ROUTE
  // ==================================================

  app.route('/screenshot')

      // ------------------------------------------------
      // GET: Screenshot from URL
      // ------------------------------------------------

      .get(async (req, res) => {

        const url = req.query.url;
        const secret = req.query.secret;

        if (!isAuthorized(secret)) {
          return res.status(401).end(
              'parameter "secret" is not set or you aren\'t authorized'
          );
        }

        if (!url) {
          return res.status(400).end(
              'get parameter "url" is not set'
          );
        }

        try {

          const buff = await pagePool.withPage(async page => {

            await page.goto(url, {
              timeout: pageTimeoutMsec,
              waitUntil: [
                'load',
                'domcontentloaded'
              ]
            });

            return await page.screenshot({
              fullPage: true
            });
          });

          sendScreenshot(res, buff);

        } catch (e) {
          sendPoolError(res, e);
        }
      })

      // ------------------------------------------------
      // POST: Screenshot from HTML
      // ------------------------------------------------

      .post(async (req, res) => {

        const html = req.body.html;
        const secret = req.body.secret;

        if (!isAuthorized(secret)) {
          return res.status(401).end(
              'parameter "secret" is not set or you aren\'t authorized'
          );
        }

        if (!html) {
          return res.status(400).end(
              'post parameter "html" is not set'
          );
        }

        try {

          const buff = await pagePool.withPage(async page => {

            await page.setContent(html);

            return await page.screenshot({
              fullPage: true
            });
          });

          sendScreenshot(res, buff);

        } catch (e) {
          sendPoolError(res, e);
        }
      });

  // ==================================================
  // HEALTH CHECK
  // ==================================================

  app.get('/hc', (req, res) => {

    if (!isAuthorized(req.query.secret)) {
      return res.status(401).end(
          'parameter "secret" is not set or you aren\'t authorized'
      );
    }

    if (!pagePool.isHealthy()) {
      console.error('health check failed:', pagePool.getStatus());

      return res.status(503).end('unhealthy');
    }

    debug('health check ok');

    res.status(200).end('ok');
  });

  // ==================================================
  // PAGE POOL STATUS
  // ==================================================

  app.get('/debug/page-pool', (req, res) => {

    if (!isAuthorized(req.query.secret)) {
      return res.status(401).end();
    }

    res.json(pagePool.getStatus());
  });

  // ==================================================
  // RECOVER FAILED PAGES
  // ==================================================

  app.post('/debug/page-pool/recover', async (req, res) => {

    if (!isAuthorized(req.body.secret || req.query.secret)) {
      return res.status(401).end();
    }

    try {

      await pagePool.recoverFailedPages();

      res.json(pagePool.getStatus());

    } catch (e) {
      sendPoolError(res, e);
    }
  });

  // ==================================================
  // CHROME VERSION
  // ==================================================

  app.get('/debug/chrome-version', async (req, res) => {

    if (!isAuthorized(req.query.secret)) {
      return res.status(401).end();
    }

    try {

      const version = await pagePool.withPage(async page => {

        const client = await page.target().createCDPSession();

        try {
          return await client.send('Browser.getVersion');
        } finally {
          await client.detach();
        }
      });

      res.json(version);

    } catch (e) {
      sendPoolError(res, e);
    }
  });

  // ==================================================
  // START HTTP / HTTPS SERVER
  // ==================================================

  let server;

  try {

    const tlsConfig = __dirname + '/tls';

    let tlsFiles = [];

    try {
      if (fs.existsSync(tlsConfig)) {
        tlsFiles = fs.readdirSync(tlsConfig);
      }
    } catch (e) {
      debug('TLS directory check failed:', e.message);
    }

    if (tlsFiles.length === 0) {

      debug('HTTPS not configured');

      server = http.createServer(app);

      server.listen(listenHttpPort);

      console.log('Listening on:', listenHttpPort);

    } else {

      let privateKey;
      let certificate;

      try {

        privateKey = fs.readFileSync(
            tlsConfig + '/pdf_server.key',
            'utf8'
        );

        certificate = fs.readFileSync(
            tlsConfig + '/pdf_server.crt',
            'utf8'
        );

      } catch (e) {

        debug(
            'TLS files are missing. Falling back to HTTP:',
            e.message
        );

        server = http.createServer(app);

        server.listen(listenHttpPort);

        console.log('Listening on:', listenHttpPort);

      }

      if (!server) {

        const credentials = {
          key: privateKey,
          cert: certificate,
          passphrase: sslKeyPassword
        };

        server = https.createServer(credentials, app);

        server.listen(listenHttpsPort);

        console.log('Listening on:', listenHttpsPort);
      }
    }

    // ------------------------------------------------
    // Graceful Page Pool shutdown
    // ------------------------------------------------

    server.on('close', () => {

      debug('HTTP server closed. Closing PagePool.');

      pagePool.close().catch(e => {
        console.error('PagePool shutdown failed:', e);
      });
    });

    return server;

  } catch (err) {

    debug('Error initiating HTTP server');
    console.error(err);

    return null;
  }
};