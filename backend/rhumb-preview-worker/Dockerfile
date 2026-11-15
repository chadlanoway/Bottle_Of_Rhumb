FROM mcr.microsoft.com/playwright:v1.56.1-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production \
    SETUPTOOLS_USE_DISTUTILS=local

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    cmake \
    g++ \
    libcurl4-openssl-dev \
    libtool \
    make \
    pkg-config \
    python3-setuptools \
    unzip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /var/task
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./

ENTRYPOINT ["/usr/bin/npx", "aws-lambda-ric"]
CMD ["index.handler"]