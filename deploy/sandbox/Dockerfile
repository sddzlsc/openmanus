# Wiwana sandbox image: dsh + capability packs + runtime agent.
#
# Build from the repository root:
#   docker build -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 .

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/runtime-agent/package.json apps/runtime-agent/
RUN pnpm install --filter @wiwana/runtime-agent... --frozen-lockfile=false
COPY packages/protocol packages/protocol
COPY apps/runtime-agent apps/runtime-agent
RUN pnpm --filter @wiwana/runtime-agent build

FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    DSH_HOME=/home/agent/.dsh \
    WIWANA_CAPABILITIES_ROOT=/opt/wiwana/capabilities \
    WIWANA_WORKSPACE=/workspace \
    # Shared browser cache: the image installs Chromium as root, but tasks run as
    # the unprivileged `agent` user, which cannot see /root/.cache.
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-noto-cjk fonts-noto-color-emoji \
      pandoc poppler-utils \
      git curl ca-certificates jq ripgrep \
      chromium \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
      python-docx openpyxl python-pptx reportlab matplotlib pandas playwright

RUN npm install -g @deepseek-ai/dsh@0.1.7-rc.2 \
    && npm install -g pnpm@11.1.1 \
    && npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest \
    && python3 -m playwright install --with-deps chromium \
    && chmod -R a+rX /opt/ms-playwright

RUN useradd --create-home --shell /bin/bash agent \
    && mkdir -p /workspace /opt/wiwana \
    && chown -R agent:agent /workspace /home/agent

COPY packages/capabilities /opt/wiwana/capabilities
COPY packages/dsh-bundle-wiwana /opt/wiwana/dsh-bundle
COPY deploy/sandbox/profile.package.json /tmp/wiwana-profile.package.json
COPY deploy/sandbox/profile-task.package.json /tmp/wiwana-task-profile.package.json
COPY deploy/sandbox/codex-config.toml /tmp/codex-config.toml
COPY --from=build /src/apps/runtime-agent/dist /opt/wiwana/runtime-agent/dist
COPY deploy/sandbox/entrypoint.sh /usr/local/bin/wiwana-entrypoint
COPY deploy/sandbox/screen_capture.py /opt/wiwana/screen_capture.py
RUN chmod +x /usr/local/bin/wiwana-entrypoint

# The runtime agent's only runtime dependencies. They are installed here rather
# than copied from the pnpm workspace, whose symlink layout does not survive a
# multi-stage COPY.
RUN cd /opt/wiwana/runtime-agent \
    && npm init -y >/dev/null \
    && npm pkg set type=module >/dev/null \
    && npm install --omit=dev --no-audit --no-fund fastify@^5.2.1 ws@^8.18.0 \
    && chown -R agent:agent /opt/wiwana/runtime-agent

# Pre-create the Wiwana dsh profile. In-box bundles (base, web-app) resolve from
# the dsh installation itself; only the product bundle is linked into the
# profile's node_modules, so no registry access and no version mixing.
RUN mkdir -p /home/agent/.dsh/profiles/wiwana/node_modules/@wiwana \
    && cp /tmp/wiwana-profile.package.json /home/agent/.dsh/profiles/wiwana/package.json \
    && ln -sfn /opt/wiwana/dsh-bundle /home/agent/.dsh/profiles/wiwana/node_modules/@wiwana/dsh-bundle \
    && mkdir -p /home/agent/.dsh/profiles/wiwana-task/node_modules/@wiwana \
    && cp /tmp/wiwana-task-profile.package.json /home/agent/.dsh/profiles/wiwana-task/package.json \
    && ln -sfn /opt/wiwana/dsh-bundle /home/agent/.dsh/profiles/wiwana-task/node_modules/@wiwana/dsh-bundle \
    && chown -R agent:agent /home/agent/.dsh \
    && su agent -c "DSH_HOME=/home/agent/.dsh dsh --profile wiwana --dump-config | head -6" \
    && su agent -c "DSH_HOME=/home/agent/.dsh dsh --profile wiwana-task --dump-config | head -6"

# Codex needs to WRITE into its home (sessions, history, logs), so the directory
# must belong to the unprivileged runtime user — a root-owned COPY would make
# every `codex` call fail with os error 13.
RUN install -d -o agent -g agent -m 755 /home/agent/.codex \
    && install -o agent -g agent -m 644 /tmp/codex-config.toml /home/agent/.codex/config.toml

USER agent
WORKDIR /workspace
EXPOSE 8790 5173
ENTRYPOINT ["/usr/local/bin/wiwana-entrypoint"]
