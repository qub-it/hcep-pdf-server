/* eslint-disable no-unused-vars */
const request = require('supertest');
const { expressApp } = require('../app/express-app');

const createMockPage = () => {
  return {
    goto: async () => {},
    setContent: async () => {},
    pdf: async () => Buffer.from('%PDF-1.4 mock pdf content'),
    screenshot: async () => Buffer.from('mock png'),
    close: async () => {}
  };
};

describe('Express App Tests', () => {
  let mockPages;
  let server;
  let basePort;

  beforeEach(() => {
    basePort = 8001 + Math.floor(Math.random() * 1000);
    process.env.HCEP_PORT = String(basePort);
    delete process.env.SECRET;
    mockPages = [createMockPage(), createMockPage()];
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    delete process.env.SECRET;
    delete process.env.HCEP_PORT;
  });

  const getApp = () => {
    server = expressApp(mockPages);
    return server;
  };

  describe('without secret', () => {
    it('GET / should return 400 when url is missing', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/')
        .expect(400);
    });

    it('GET / should return PDF when url is provided', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/?url=http://example.com')
        .expect(200)
        .expect('content-type', /application\/pdf/);
    });

    it('POST / should return 400 when html is missing', async () => {
      const app = getApp();
      const _res = await request(app)
        .post('/')
        .type('form')
        .send({})
        .expect(400);
    });

    it('POST / should return PDF when html is provided', async () => {
      const app = getApp();
      const _res = await request(app)
        .post('/')
        .type('form')
        .send({ html: '<html><body>test</body></html>' })
        .expect(200)
        .expect('content-type', /application\/pdf/);
    });

    it('GET /screenshot should return 400 when url is missing', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/screenshot')
        .expect(400);
    });

    it('GET /screenshot should return PNG when url is provided', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/screenshot?url=http://example.com')
        .expect(200)
        .expect('content-type', /image\/png/);
    });

    it('POST /screenshot should return 400 when html is missing', async () => {
      const app = getApp();
      const _res = await request(app)
        .post('/screenshot')
        .type('form')
        .send({})
        .expect(400);
    });

    it('POST /screenshot should return PNG when html is provided', async () => {
      const app = getApp();
      const _res = await request(app)
        .post('/screenshot')
        .type('form')
        .send({ html: '<html><body>test</body></html>' })
        .expect(200)
        .expect('content-type', /image\/png/);
    });

    it('GET /hc should return 200 for health check', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/hc')
        .expect(200)
        .expect('ok');
    });
  });

  describe('with secret', () => {
    beforeEach(() => {
      process.env.SECRET = 'testsecret';
    });

    it('GET / should return 401 when secret is wrong', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/?url=http://example.com')
        .expect(401);
    });

    it('GET / should return 200 when secret is correct', async () => {
      const app = getApp();
      const _res = await request(app)
        .get('/?url=http://example.com&secret=testsecret')
        .expect(200);
    });
  });
});
