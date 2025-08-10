# syntax=docker/dockerfile:1
ARG VARIANT=20
FROM mcr.microsoft.com/devcontainers/typescript-node:${VARIANT}

# Install OS packages required by node-canvas (chartjs-node-canvas dependency) and fish shell
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
        fish \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set fish as default shell for node user
RUN echo /usr/bin/fish | tee -a /etc/shells && chsh node -s /usr/bin/fish
