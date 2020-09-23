# This is built upon debian-stretch for apt-get packages
# So we have stretch and stretch/updates available
FROM node:10.20.1-slim as pdf_server_build

LABEL maintainer="diogo.sousa@qub-it.com"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Adding requirements for local build
RUN apt-get update && \
    apt-get install --yes --no-install-recommends \
    wget=1.18-5+deb9u3 \
    gnupg2=2.1.18-8~deb9u4 \
    ca-certificates=20200601~deb9u1 \
    # Cleaning operations after install
    && apt-get autoremove --yes --purge \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install stable chrome and dependencies.
# "-O -" writes file contents to stdout
RUN wget --quiet --output-document - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && bash -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install --yes --no-install-recommends google-chrome-stable=85.0.4183.121-1 \
  # Cleaning operations after install
  && apt-get autoremove --yes --purge \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
  # Chrome specific cleaning operations
  && rm -rf /src/*.deb \
  && rm -rf /etc/apt/sources.list.d/*

# It's a good idea to use dumb-init to help prevent zombie chrome processes.
ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.2/dumb-init_1.2.2_x86_64 /usr/local/bin/dumb-init

RUN chmod +x /usr/local/bin/dumb-init

# If you wish to use default chromium installed with puppeteer
ENV HCEP_USE_CHROMIUM true

# If you want to extend pdf options, rename app/my-pdf-option-presets.js.sample to app/my-pdf-option-presets.js and activate this
ENV HCEP_MY_PDF_OPTION_PRESETS_FILE_PATH="./my-pdf-option-presets"

ENV NODE_ENV production

RUN mkdir /hcep/

COPY package.json /hcep/

WORKDIR /hcep/

RUN npm install --no-optional --no-package-lock npm@6.14.5 && \
    npm install --global --no-optional --no-package-lock mocha@7.2.0 eslint@7.1.0 && \
    # This installs the hcep-server through the package.json file
    npm install --no-optional --no-package-lock && \
    # NPM clean up - yes, I know what I'm doing.
    npm prune --force && \
    npm cache clean --force

# Install fonts
COPY fonts /usr/share/fonts

COPY app /hcep/app

WORKDIR /hcep/app

RUN mkdir tls

WORKDIR /hcep/

RUN chmod -R 777 /hcep/app

# Final cleaning operation - remove any lingering files that are not needed
RUN apt-get autoremove --yes --purge \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /etc/apt/sources.list.d/*

# Start a fresh image - this is the one that will be tagged
FROM scratch

# Copy everything over - no issues as this image runs from / and uses root:root
COPY --from=pdf_server_build / /

WORKDIR /hcep/

ENTRYPOINT [ "dumb-init", "--" ]

CMD [ "node", "--inspect=0.0.0.0:9229", "app/pdf-server.js" ]
