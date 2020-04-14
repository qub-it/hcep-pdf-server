FROM node:10-slim

LABEL maintainer="diogo.sousa@qub-it.com"

# Image updates
RUN apt-get update --fix-missing && apt-get -y upgrade

# Adding requirements for local build
RUN apt-get update && \
    apt-get install -y \
    wget \
    gnupg2

# Install stable chrome and dependencies.
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install -y google-chrome-stable --no-install-recommends \
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

RUN npm install -u npm && \
    npm install -g mocha eslint && \
    npm install

# Install fonts
COPY fonts /usr/share/fonts

COPY app /hcep/app

RUN cd app && mkdir tls

RUN chmod -R 777 /hcep/app

ENTRYPOINT ["dumb-init", "--"]

CMD ["node",  "--inspect=0.0.0.0:9229", "app/pdf-server.js"]
