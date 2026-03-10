FROM node:20-slim as pdf_server_build

LABEL maintainer="diogo.sousa@qub-it.com"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    NODE_ENV=production

RUN apt-get update && \
    apt-get install --yes --no-install-recommends \
    dumb-init \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    curl \
    gnupg \
    && apt-get autoremove --yes --purge \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install --yes google-chrome-stable && \
    apt-get autoremove --yes --purge && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN mkdir /hcep/

COPY package.json package-lock.json* /hcep/

WORKDIR /hcep/

RUN npm ci --omit=dev && \
    npm cache clean --force

COPY fonts /usr/share/fonts

COPY app /hcep/app

WORKDIR /hcep/app

RUN mkdir tls

WORKDIR /hcep/

RUN chmod -R 777 /hcep/app

FROM scratch

COPY --from=pdf_server_build / /

WORKDIR /hcep/

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "app/pdf-server.js"]
