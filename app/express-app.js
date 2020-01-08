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
  const { getPdfOption } = require('./pdf-option/pdf-option-lib')
  const appTimeoutMsec = process.env.HCEP_APP_TIMEOUT_MSEC || 10000
  const pageTimeoutMsec = process.env.HCEP_PAGE_TIMEOUT_MSEC || 10000
  const listenPort = process.env.HCEP_PORT || 8001
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
      const url = req.query.url
      if (!url) {
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
      
      if (!html) {
        res.status(400)
        res.contentType('text/plain')
        res.end('post parameter "html" is not set')
      } else {
        const page = getSinglePage()

        try {
          
          
          var fonts = ""
          if(req.body.fonts){
            fonts = req.body.fonts
          }
          
          await page.setContent(fonts + html)
          debug(`html received:${html}`)
          
          // Wait for web font loading completion
          // await page.evaluateHandle('document.fonts.ready')
          const pdfOption = getPdfOption(req.body.pdf_option)
          debug(`using PDFOption:${pdfOption}`)
          

          const header = req.body.header
          if(header){
            debug(`header received:${header}`)
            // webkit-print-color-adjust must be set to exact
            // to set background colors, due to issue in we-kit
            //
            // For more information see - https://github.com/puppeteer/puppeteer/issues/2182
            //
            //  
            // Header and Footer doesn't support certain custom css
            //
            // Fore more information see - https://github.com/puppeteer/puppeteer/issues/1853
            //                             https://github.com/puppeteer/puppeteer/issues/2388
            //                             https://github.com/puppeteer/puppeteer/issues/2916
            //
            // Daniel Pires - 08 January 2020
            //
            pdfOption.headerTemplate = "<style> * {-webkit-print-color-adjust: exact}</style> " + header
          }

          const footer = req.body.footer
          if(footer){
            debug(`footer received:${footer}`)
            // webkit-print-color-adjust must be set to exact
            // to set background colors, due to issue in we-kit
            //
            // For more information see - https://github.com/puppeteer/puppeteer/issues/2182
            //
            //  
            // Header and Footer doesn't support certain custom css
            //
            // Fore more information see - https://github.com/puppeteer/puppeteer/issues/1853
            //                             https://github.com/puppeteer/puppeteer/issues/2388
            //                             https://github.com/puppeteer/puppeteer/issues/2916
            //
            // Daniel Pires - 08 January 2020
            //
            pdfOption.footerTemplate = "<style> * {-webkit-print-color-adjust: exact}</style> " + footer
          }

          if(header || footer) {
            pdfOption.displayHeaderFooter = true;
          } else {
            pdfOption.displayHeaderFooter = false;
          }

          
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
          
          const headerHeight = req.body.headerHeight;
          if(headerHeight) {
            debug(`setting Margin-Top:${headerHeight}`)
            if(headerHeight != "0px"){
              // This has to be fixed, it has several issues
              // due to the way puppeteer generates header and footer
              // separately from the body
              // 
              // - Different DPIs, makes sizes different
              // - Different resolutions from the editor view
              // 
              // We added the left and right margins to the footer
              // height so it has more space
              //
              // Daniel Pires - 08 January 2020
              var oldHeight = parseInt(headerHeight.replace("px",""))
              var newHeight = oldHeight + (72 * parseInt(pdfOption.margin.left.replace("mm",""))/25.4) + (72 * parseInt(pdfOption.margin.right.replace("mm",""))/25.4)
              pdfOption.margin.top = String(parseInt(newHeight)) + "px";
            }
          }

          const footerHeight = req.body.footerHeight;
          if(footerHeight) {
            debug(`setting Margin-Bottom:${footerHeight}`)
            if(footerHeight != "0px"){

              // This has to be fixed, it has several issues
              // due to the way puppeteer generates header and footer
              // separately from the body
              // 
              // - Different DPIs, makes sizes different
              // - Different resolutions from the editor view
              // 
              // We added the left and right margins to the footer
              // height so it has more space
              //
              // Daniel Pires - 08 January 2020
              var oldHeight = parseInt(footerHeight.replace("px",""))
              var newHeight = oldHeight + (72 * parseInt(pdfOption.margin.left.replace("mm",""))/25.4) + (72 * parseInt(pdfOption.margin.right.replace("mm",""))/25.4)

              pdfOption.margin.bottom = String(parseInt(newHeight)) + "px";
            }
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
      if (!url) {
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
      if (!html) {
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
    debug('health check ok')
    res.status(200)
    res.end('ok')
  })

  const appServer = app.listen(listenPort, () => {
    console.log('Listening on:', listenPort)
  })
  return appServer
}
