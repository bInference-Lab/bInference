# The binference image: the engine, the agent runtime and the signer on Node, run by a user of
# their own, with the state folder as a volume (decision 0292), and community plugins run by a
# second user through the plugin launcher, with their files on a second volume (decision 0344).
#
#   docker build -t binference .
#
# Both bases are pinned by the digest of their multi-arch index, so amd64 and arm64 build from the
# same reviewed release. To move to a newer Node, pick a release at least 7 days old and read its
# digest with `docker buildx imagetools inspect docker.io/library/node:<version>-bookworm-slim`.
ARG BUILD_BASE=docker.io/library/node:26.10.0-bookworm@sha256:e6cfc3514df35d1cb534e83f9279a242ad6e578692ab7b56d73dadcc7c4354a0
ARG RUN_BASE=docker.io/library/node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3

FROM ${BUILD_BASE} AS build
ENV CI=true \
    DO_NOT_TRACK=1 \
    TURBO_TELEMETRY_DISABLED=1
# Only the package install reaches the network: pnpm at the version package.json names, every
# package of the lockfile into the store, and the release dates the deploy step checks against
# the 7-day rule. The install and the build run with no network. pnpm's own install script puts
# its native binary for the build machine in place.
RUN ["npm", "install", "--global", "pnpm@12.8.1"]
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN ["pnpm", "fetch"]
COPY . .
# Install scripts stay off: the only one allowed builds the terminal test's pseudo-terminal,
# which the image never runs.
RUN --network=none ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"]
RUN --network=none ["pnpm", "turbo", "run", "build", "--filter", "binference...", "--output-logs=errors-only"]
RUN --network=none ["pnpm", "--filter", "binference", "run", "prepack"]
RUN ["pnpm", "--filter", "binference", "deploy", "--prod", "/out"]
RUN ["cp", "LICENSE", "NOTICES.md", "/out/"]
RUN ["chmod", "0755", "/out/dist/main.mjs"]
RUN ["sh", "-c", "chmod 0755 \"$(realpath /out/node_modules/@binference/plugin-host/dist/image-entry.mjs)\""]

FROM ${RUN_BASE}
LABEL org.opencontainers.image.title="binference" \
      org.opencontainers.image.description="An AI agent that trades on BNB Smart Chain for its owner and asks before every transaction" \
      org.opencontainers.image.licenses="MIT"
# A system user of its own, apart from the base image's `node`, with its home under /var/lib. Its
# state folder exists before the volume is mounted, so a new named volume takes its owner and its
# owner-only mode.
RUN ["groupadd", "--system", "--gid", "10001", "binference"]
RUN ["useradd", "--system", "--uid", "10001", "--gid", "binference", "--home-dir", "/var/lib/binference", "--create-home", "--shell", "/usr/sbin/nologin", "binference"]
RUN ["install", "-d", "-m", "0700", "-o", "binference", "-g", "binference", "/var/lib/binference/.binference"]
# The plugin user, which runs every community plugin and the launcher that starts them. Plugins'
# files belong to the engine's user, which installs them, and each plugin writes only its own
# data folder, which belongs to the plugin user. The launcher's socket sits in `run/`, the plugin
# user's with the engine's group, inside the volume's root, which only the engine's user may
# change, so the plugin user can never put anything else in its place.
RUN ["groupadd", "--system", "--gid", "10002", "binference-plugin"]
RUN ["useradd", "--system", "--uid", "10002", "--gid", "binference-plugin", "--no-create-home", "--home-dir", "/var/lib/binference-plugins/data", "--shell", "/usr/sbin/nologin", "binference-plugin"]
RUN ["install", "-d", "-m", "0755", "-o", "binference", "-g", "binference", "/var/lib/binference-plugins", "/var/lib/binference-plugins/packages"]
RUN ["install", "-d", "-m", "0700", "-o", "binference-plugin", "-g", "binference-plugin", "/var/lib/binference-plugins/data"]
RUN ["install", "-d", "-m", "0750", "-o", "binference-plugin", "-g", "binference", "/var/lib/binference-plugins/run"]
COPY --from=build /out /opt/binference
RUN ["ln", "-s", "/opt/binference/dist/main.mjs", "/usr/local/bin/binference"]
RUN ["ln", "-s", "/opt/binference/node_modules/@binference/plugin-host/dist/image-entry.mjs", "/usr/local/bin/binference-image"]
# Every engine process asks the launcher for its plugins on this socket, which the image entry's
# launcher serves; a container started without the image entry has no launcher and runs none.
ENV BINFERENCE_PLUGIN_LAUNCHER=/var/lib/binference-plugins/run/launcher.sock
# A `binference` command started as root, as `docker exec` and the health check are in the
# engine's container, drops to this user before it does anything, in this state folder.
ENV BINFERENCE_IMAGE_USER=10001
ENV BINFERENCE_HOME=/var/lib/binference/.binference
USER binference
WORKDIR /var/lib/binference
VOLUME ["/var/lib/binference/.binference", "/var/lib/binference-plugins"]
# `binference health` exits 0 while the engine is ready or locked: a locked engine waits for the
# owner, and a restart would leave it locked again. The start period covers the engine's start.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD ["binference", "health"]
STOPSIGNAL SIGTERM
# Commands run as `binference`. The engine runs as `docker run --init --user root --entrypoint
# binference-image`: the image entry, which takes no argument and touches no path, starts the
# engine as `binference` and the plugin launcher as `binference-plugin`, and Docker's init reaps
# what they leave.
ENTRYPOINT ["binference"]
CMD ["start", "--foreground"]
