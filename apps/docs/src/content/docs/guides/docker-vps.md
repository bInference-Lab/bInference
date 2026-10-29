---
title: Run binference on a server with Docker
description: Set up the binference image on a Linux server, keep it private, back it up, update it and unlock it after a restart.
---

This guide runs binference in Docker on a Linux server you rent, such as a VPS. The engine keeps
the same rules as on your own computer: it asks before every transaction, it listens only on the
server's loopback address, and your keys stay in its state folder.

## What you need

- A Linux server with at least 1 vCPU and 1 GB of memory, and Docker Engine installed.
- SSH access to it with a key.
- What `binference init` asks for: a Privy app ID and secret, your rescue address, a Telegram bot
  token from BotFather, and a model provider with its key.

## 1. A user of your own on the server

Never run the agent's work as `root`. Make a user for it and give it Docker:

```sh
sudo adduser --disabled-password binference-admin
sudo usermod -aG docker binference-admin
```

Membership in the `docker` group is as strong as `root` on that server, so give it to this user
only. Log in as this user for every step below. Inside the container binference runs as its own
user `binference`, ID 10001, never as `root`.

## 2. The firewall

Allow SSH and nothing else from outside:

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

Never publish the engine's port 7456 with `-p` or `ports:`. Docker opens a published port past
`ufw`, and the engine is not meant to face the internet. The image publishes no port: the
container shares the server's network, and the engine listens on `127.0.0.1` only.

## 3. Build the image

Released images are not published yet; they will come from GitHub's registry
(`ghcr.io`) for amd64 and arm64, built by the release workflow with an SBOM. Until then, get the
binference source at the release you want, then build:

```sh
docker build -t binference .
```

The build downloads Node packages and nothing else, and checks that each one is at least 7 days
old.

## 4. Set it up

Make the volume that holds the state folder, then run onboarding in your SSH terminal:

```sh
docker volume create binference-state
docker run --rm -it --network host --read-only --tmpfs /tmp \
  -e TZ=Asia/Shanghai \
  -v binference-state:/var/lib/binference/.binference \
  binference init
```

`-it` gives init your terminal: it asks each question, shows your owner key once, and keeps the
secrets you type in the volume, readable only by the `binference` user. Write the owner key down
away from the server.

Set `TZ` to your time zone; without it the container uses UTC for the daily summary and
schedules. Set `-e LANG=zh_CN.UTF-8` to start in Chinese.

### Without prompts

For a script, `binference init --yes` takes every answer from a flag, a `BINFERENCE_INIT_*`
variable or an answers file (`--answers`). It never makes an owner key: make one with
`binference owner-key create` on a computer with a terminal, and pass its public half with
`--owner-key-public`. Secrets are always secret sources. Keep them in files owned by user 10001
and mount them read-only:

```sh
sudo install -d -m 0500 -o 10001 -g 10001 /srv/binference/secrets
# Write each secret into its file, then:
sudo chown 10001:10001 /srv/binference/secrets/*
sudo chmod 0400 /srv/binference/secrets/*

docker run --rm --network host --read-only --tmpfs /tmp \
  -v binference-state:/var/lib/binference/.binference \
  -v /srv/binference/secrets:/run/secrets:ro \
  binference init --yes --accept-disclaimer \
    --privy-app-id <app ID> \
    --privy-app-secret '{ fromFile: "/run/secrets/privy-app-secret" }' \
    --owner-key-public <public half> \
    --rescue <rescue address> \
    --bot-token '{ fromFile: "/run/secrets/bot-token" }' \
    --model-provider <provider> --model <model ID> \
    --model-key '{ fromFile: "/run/secrets/model-key" }'
```

`--accept-disclaimer` prints the disclaimer and the privacy statement and accepts them for you.
Mount the same secrets folder every time the engine starts.

## 5. Start the engine

```sh
docker run -d --name binference --restart unless-stopped \
  --network host --read-only --tmpfs /tmp --stop-timeout 45 \
  -e TZ=Asia/Shanghai \
  -v binference-state:/var/lib/binference/.binference \
  binference
```

- `--stop-timeout 45` gives the engine time to finish what it is sending and close its databases.
  Docker's default of 10 seconds can cut that short.
- `--restart unless-stopped` starts it again after a crash or a reboot.
- The health check runs `binference health` every 30 seconds. It reports healthy while the engine
  is ready or locked: a locked engine waits for you, and a restart would not open it.

Check it:

```sh
docker exec binference binference status
docker inspect --format '{{.State.Health.Status}}' binference
```

Then pair your Telegram: open the pairing link init printed, in Telegram.

## 6. Open the console

The console listens on the server's `127.0.0.1:7456`. Reach it through SSH from your computer:

```sh
ssh -N -L 7456:127.0.0.1:7456 binference-admin@<server>
```

In another terminal, make a single-use sign-in link, then open it in your browser:

```sh
ssh binference-admin@<server> docker exec binference binference console
```

### The Telegram Mini App

The Mini App needs an HTTPS address that reaches the engine's port. Publish the port with
Tailscale `serve` on the server, so only your own devices on your tailnet reach it, then tell
binference the address and restart:

```sh
docker exec binference binference config set remote.publicUrl https://<machine>.<tailnet>.ts.net
docker restart binference
```

Never put the engine's port behind a public proxy or Tailscale `funnel`.

## Logs

```sh
docker logs binference                    # what the engine printed at start and stop
docker exec binference binference logs    # the engine's log
docker exec binference binference report  # a support bundle with no secret in it
```

## Backups

binference makes an encrypted backup every night at 03:30 your time, sealed to your owner key, in
the volume under `backups/`. Never copy the volume's database files while the engine runs: copy
the backups. To keep a second copy on the server, mount a folder and point `backups.copyTo` at
it:

```sh
sudo install -d -m 0700 -o 10001 -g 10001 /srv/binference/backups
```

Add `-v /srv/binference/backups:/backups` to the start command, then:

```sh
docker exec binference binference config set backups.copyTo /backups
```

Copy `/srv/binference/backups` off the server on a schedule of your own. Make one by hand with
`docker exec binference binference backup create`.

To restore, stop the container first: a restore stops the engine, and in a container that ends
the container with it. Then restore from a container of its own, which asks for your owner key,
and start again:

```sh
docker stop binference
docker run --rm -it --network host --read-only --tmpfs /tmp \
  -v binference-state:/var/lib/binference/.binference \
  -v /srv/binference/backups:/backups \
  binference backup restore /backups/<file>
docker start binference
```

## Updates

`binference update` does not apply inside a container. To update:

1. Make a backup: `docker exec binference binference backup create`.
2. Build the image again at the new release.
3. Replace the container with the same volume:

   ```sh
   docker stop binference
   docker rm binference
   ```

   Then run the start command of step 5 again. The engine backs up and migrates its databases as
   it starts.

## Unlock after a restart

- **`file` mode** (the default in Docker): the agent key opens from the volume at each start, so
  the engine unlocks by itself.
- **`manual` mode**: the agent key stays encrypted under your passphrase. After each start the
  engine runs locked: it answers, keeps paper trading and opens cards, but signs nothing. Unlock
  it from your SSH terminal:

  ```sh
  docker exec -it binference binference unlock
  ```

  The passphrase goes only through the terminal; it is never a flag or a variable.

`docker exec binference binference status` shows `locked` and why.

## When something is wrong

- **"binference cannot write to /var/lib/binference/.binference"**: the volume belongs to another
  user or is mounted read-only. Use a named volume as above, or `chown -R 10001:10001` the folder
  you bind.
- **The console does not open**: check that the SSH tunnel runs and that the container uses
  `--network host`.
