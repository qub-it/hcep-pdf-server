FROM node:10.20.1-slim

LABEL maintainer="diogo.sousa@qub-it.com"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Adding requirements for local build
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget=1.18-5+deb9u3 \
    gnupg2=2.1.18-8~deb9u4 \
    ca-certificates=20161130+nmu1+deb9u1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install stable chrome and dependencies.
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install -y google-chrome-stable=83.0.4103.61-1 --no-install-recommends \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /src/*.deb

# It's a good idea to use dumb-init to help prevent zombie chrome processes.
ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.2/dumb-init_1.2.2_x86_64 /usr/local/bin/dumb-init

RUN chmod +x /usr/local/bin/dumb-init

# if use default chromium installed with puppeteer
ENV HCEP_USE_CHROMIUM true

# If you want to extend pdf options, rename app/my-pdf-option-presets.js.sample to app/my-pdf-option-presets.js and activate this
ENV HCEP_MY_PDF_OPTION_PRESETS_FILE_PATH="./my-pdf-option-presets"

ENV NODE_ENV production

RUN mkdir /hcep/

COPY package.json /hcep/

WORKDIR /hcep/

RUN npm install -u npm@6.14.5 && \
    npm install -g mocha@7.2.0 eslint@7.1.0 && \
    # This installs the hcep server through the package.json file
    npm install && \
    npm cache clean --force

# Install fonts
COPY fonts /usr/share/fonts

COPY app /hcep/app

WORKDIR /hcep/app

RUN mkdir tls

WORKDIR /hcep/

RUN chmod -R 777 /hcep/app

RUN apt-get autoremove -y --purge && apt-get clean && rm -rf /var/lib/apt/lists/* && rm -rf /etc/apt/apt/sources.list.d/*

ENTRYPOINT [ "dumb-init", "--" ]

CMD [ "node", "--inspect=0.0.0.0:9229", "app/pdf-server.js" ]
