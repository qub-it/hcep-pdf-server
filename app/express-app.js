module.exports.expressApp = pages => {
  const pagesNum = pages.length
  console.log(`pages.length: ${pages.length}`)
  let currentPageNo = 0
  const getSinglePage = () => {
    currentPageNo++;
    if (currentPageNo >= pagesNum) {
      currentPageNo = 0
    }
    debug(`pagesNum:${pagesNum} currentPageNo:${currentPageNo}`)
    return pages[currentPageNo]
  }
  const bodyParser = require('body-parser')
  const debug = require('debug')('hcepPdfServer:expressApp')
  const express = require('express')
  const morgan = require('morgan')
  const timeout = require('connect-timeout')
  const crypto = require('crypto');
  const fs = require('fs');
  const http = require('http');
  const https = require('https');
  const { getPdfOption } = require('./pdf-option/pdf-option-lib')
  const secretHash = process.env.SECRET
  const appTimeoutMsec = process.env.HCEP_APP_TIMEOUT_MSEC || 10000
  const pageTimeoutMsec = process.env.HCEP_PAGE_TIMEOUT_MSEC || 10000
  const sslKeyPassword = process.env.PDF_SERVER_TLS_KEYSTORE_PASSWORD || ''
  //const privateKeyPath = process.env.SSL_KEY_PATH || ''
  //const privateCertPath = process.env.SSL_CERT_PATH || ''
  //const tlsConfig = process.env.PDF_SERVER_TLS_CONFIG || ''
  const listenHttpPort = process.env.HCEP_PORT || 8001
  const listenHttpsPort = process.env.HCEP_SSL_PORT || 8002
  /* bytes or string for https://www.npmjs.com/package/bytes */
  const maxRquestSize = process.env.HCEP_MAX_REQUEST_SIZE || '10MB'

  const app = express()
  const env = app.get('env')
  console.log('env:', env)
  if (env == 'production') {
    app.use(morgan('combined'))
  } else {
    app.use(morgan('dev'))
  }

  app.use(bodyParser.urlencoded({
    extended: false,
    limit: maxRquestSize
  }))
  app.use(timeout(appTimeoutMsec))

  function handlePageError(e, option) {
    console.error('Page error occurred! process.exit()')
    console.error('error:', e)
    console.error('option:', option)
    process.exit()
  }

  app.route('/')
    /**
     * get()
     * Receive get request with target page's url
     * @req.query.url {String} page's url
     * @req.query.pdf_option {String} a key of pdfOptions
     * @return binary of PDF or error response (400 or 500)
     */
    .get(async (req, res) => {
      const secret = req.query.secret
      const url = req.query.url
      const shasum = crypto.createHash('sha256');
      if(!secret || shasum.update(secret).digest('hex') != secretHash ) {
        res.status(401)
        res.end('parameter "secret" is not set or you aren\'t authorized')
      }else if (!url) {
        res.status(400)
        res.end('get parameter "url" is not set')
        return
      } else {
        const page = getSinglePage()
        try {
          await page.goto(
            url, {
              timeout: pageTimeoutMsec,
              waitUntil: ['load', 'domcontentloaded']
            }
          )
          // Wait for web font loading completion
          // await page.evaluateHandle('document.fonts.ready')
          const pdfOption = getPdfOption(req.query.pdf_option)
          // debug('pdfOption', pdfOption)
          const buff = await page.pdf(pdfOption)
          res.status(200)
          res.contentType('application/pdf')
          res.send(buff)
          res.end()
          return
        } catch (e) {
          res.status(500)
          res.contentType('text/plain')
          res.end()
          handlePageError(e, url)
          return
        }
      }
    })
    /**
     * post()
     * Receive post request with target html
     * @req.body.html {String} page's html content
     * @req.body.pdf_option {String} a key of pdfOptions
     * @return binary of PDF or error response (400 or 500)
     */
    .post(async (req, res) => {

      const html = req.body.html
      const secret = req.body.secret
      const shasum = crypto.createHash('sha256');
      if(!secret || shasum.update(secret).digest('hex') != secretHash ) {
        res.status(401)
        res.end('parameter "secret" is not set or you aren\'t authorized')
      }else if (!html) {
        res.status(400)
        res.contentType('text/plain')
        res.end('post parameter "html" is not set')
      } else {
        const page = getSinglePage()

        try {

          const pdfOption = getPdfOption(req.body.pdf_option)
          debug(`using PDFOption:${pdfOption}`)

          await page.setContent(html)
          debug(`html received:${html}`)

          pdfOption.displayHeaderFooter = false;

          const leftMargin = req.body.leftMargin;
          if(leftMargin) {
            debug(`setting Margin-Left:${leftMargin}`)
            pdfOption.margin.left = leftMargin
          }

          const rightMargin = req.body.rightMargin;
          if(leftMargin) {
            debug(`setting Margin-Right:${rightMargin}`)
            pdfOption.margin.right = rightMargin
          }

          const topMargin = req.body.topMargin;
          if(topMargin) {
            debug(`setting Margin-Right:${topMargin}`)
            pdfOption.margin.top = topMargin
          }

          const bottomMargin = req.body.bottomMargin;
          if(bottomMargin) {
            debug(`setting Margin-Right:${bottomMargin}`)
            pdfOption.margin.bottom = bottomMargin
          }

          // debug('pdfOption', pdfOption)
          const buff = await page.pdf(pdfOption)
          res.status(200)
          res.contentType('application/pdf')
          res.send(buff)
          res.end()
          return
        } catch (e) {
          res.status(500)
          res.contentType('text/plain')
          res.end()
          handlePageError(e, 'html.length:' + html.length)
          return
        }
      }

    })

  app.route('/screenshot')
    /**
     * get()
     * Receive get request with target page's url
     * @req.query.url {String} page's url
     * @return binary of PNG or error response (400 or 500)
     */
    .get(async (req, res) => {
      const url = req.query.url
      const secret = req.query.secret
      const shasum = crypto.createHash('sha256');
      if(!secret || shasum.update(secret).digest('hex') != secretHash ) {
        res.status(401)
        res.end('parameter "secret" is not set or you aren\'t authorized')
      }else if (!url) {
        res.status(400)
        res.contentType('text/plain')
        res.end('get parameter "url" is not set')
      } else {
        const page = getSinglePage()
        try {
          await page.goto(
            url, {
              timeout: pageTimeoutMsec,
              waitUntil: ['load', 'domcontentloaded']
            }
          )
          const buff = await page.screenshot({
            fullPage: true
          })
          res.status(200)
          res.contentType('image/png')
          res.send(buff)
          res.end()
        } catch (e) {
          console.error(e)
          res.status(500)
          res.contentType('text/plain')
          res.end()
        }
      }
    })
    /**
     * post()
     * Receive post request with target html
     * @req.body.html {String} page's html content
     * @return binary of PNG or error response (400 or 500)
     */
    .post(async (req, res) => {
      const html = req.body.html
      const secret = req.body.secret
      const shasum = crypto.createHash('sha256');
      if(!secret || shasum.update(secret).digest('hex') != secretHash ) {
        res.status(401)
        res.end('parameter "secret" is not set or you aren\'t authorized')
      }else if (!html) {
        await res.status(400)
        res.end('post parameter "html" is not set')
        return
      } else {
        const page = getSinglePage()
        try {
          await page.setContent(html)
          const buff = await page.screenshot({
            fullPage: true
          })
          res.status(200)
          res.contentType('image/png')
          res.send(buff)
          res.end()
        } catch (e) {
          console.error(e)
          res.status(500)
          res.end()
        }
      }
    })

  /**
   * Health Check
   */
  app.get('/hc', async (req, res) => {
    const secret = req.query.secret
    const shasum = crypto.createHash('sha256');
    if(!secret || shasum.update(secret).digest('hex') != secretHash ) {
      res.status(401)
      res.end('parameter "secret" is not set or you aren\'t authorized')
    }else{
      debug('health check ok')
      res.status(200)
      res.end('ok')
    }
  })

  try {
    let tlsConfig = __dirname+"/tls"

    // Check for empty directory
    if(fs.readdirSync(tlsConfig).length === 0) {
      debug('https not configured');
      var httpServer = http.createServer(app);
      httpServer.listen(listenHttpPort);
      console.log('Listening on:', listenHttpPort)
      return httpServer;
    } else {
      try{
      var privateKey  = fs.readFileSync(tlsConfig+"/pdf_server.key", 'utf8');
      var certificate = fs.readFileSync(tlsConfig+"/pdf_server.crt", 'utf8');
    } catch(err){
      debug("Folder exists, but filenames aren't correct. Falling back to http");
      console.log(err);
      var httpServer = http.createServer(app);
      httpServer.listen(listenHttpPort);
      console.log('Listening on:', listenHttpPort)
      return httpServer;
    }
      var credentials = { key : privateKey, cert : certificate, passphrase : sslKeyPassword };

      var httpsServer = https.createServer(credentials, app);
      httpsServer.listen(listenHttpsPort);

      console.log('Listening on:', listenHttpsPort)
      return httpsServer;
    }
  } catch (err) {
    debug('Error initiating http server');
    console.log(err);
  }

  return null;
}
