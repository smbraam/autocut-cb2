# AutoCut UI

SvelteKit touchscreen UI for the AutoCut machine controller.

## Development

```sh
cd /home/biqu/autocut
npm run dev -- --host 0.0.0.0 --port 5173
```

The dev server runs on port 5173 and proxies /moonraker to http://127.0.0.1:7125, so dev and production use the same Moonraker path.

## Production

Production is a static build served by nginx from /var/www/autocut on port 8080.

Build only:

```sh
npm run build
```

Build and deploy:

```sh
npm run deploy
```

The deploy script does this:

```sh
npm run build
sudo install -d -m 755 /var/www/autocut
sudo rsync -a --delete build/ /var/www/autocut/
sudo systemctl reload nginx
```

## CB2 / Manta M4P Commands

Build:

```sh
cd ~/autocut
npm run build
```

Build and deploy to port 8080:

```sh
cd ~/autocut
npm run deploy
```

Dev mode on port 5173:

```sh
cd ~/autocut && npm run dev -- --host 0.0.0.0 --port 5173
```

Push to the CB2 repository:

```sh
cd ~/autocut
git push -u origin main
```

Commit and push:

```sh
cd ~/autocut
git add .
git commit -m "UI update"
git push -u origin main
```

Repository target for CB2 development: autocut-cb2.

## Architecture

- The frontend talks directly to Moonraker via /moonraker
- nginx proxies /moonraker/ to http://127.0.0.1:7125/
- There is no production SvelteKit backend route for machine control
