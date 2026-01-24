# KCM Toolbar Extension

A lightweight Keeper Connection Manager (KCM) / Guacamole extension that adds a fixed top toolbar with:
- Home button (dashboard)
- Menu button (opens the KCM/Guacamole menu shortcut)
- Search field with connection results

The toolbar is hidden on mobile devices and does not overlap the client viewport; it reduces the available height by a fixed 48px.

## Features
- Fast local search over the connection tree
- Navigates to the correct client URL using the Guacamole `ClientIdentifier`
- Blocks keystrokes from being sent to the remote session while the search field is focused
- No sensitive data stored in the extension

## Docker deployment

1. Build the jar locally as above (`msp-toolbar-extension/target/msp-toolbar-1.0.0.jar`).
2. Extend the official Guacamole image so the toolbar jar is added before the container starts:
   ```Dockerfile
   FROM guacamole/guacamole:1.5.5
   COPY msp-toolbar-1.0.0.jar /extensions/
   ```
3. Rebuild your image (`docker build -t my-guacamole .`) and restart the container so the extension loads automatically with the rest of the service.

## CI / builder container

If you prefer to build the extension from within a lightweight container, add a builder service to your `docker-compose.yml`, for example:

```yaml
kcm_toolbar_builder:
  image: alpine:latest
  container_name: kcm-toolbar-builder
  restart: "no"
  volumes:
    - "/etc/kcm-setup:/out"
  command: >
    sh -c "
      set -e &&
      apk add --no-cache git zip &&
      rm -rf /tmp/src &&
      git clone https://github.com/AAD-Automatisering/kcm-toolbar.git /tmp/src &&
      cd /tmp/src/msp-toolbar-extension &&
      zip -r /out/msp-toolbar-extension.jar guac-manifest.json css/ js/ html/ &&
      echo 'Toolbar JAR ready'
    "
  networks:
    custom_net:
      ipv4_address: 172.18.0.10
```

Mount the output directory as a shared volume (here `/etc/kcm-setup`) so the builder drops `msp-toolbar-extension.jar` where your Guacamole container or host can pick it up. This is handy for CI pipelines or automated deployments where Maven is not available.

## Development

- Run `mvn -q package` whenever you change `js/toolbar.js`, `css/toolbar.css`, or `guac-manifest.json` so the extension jar bundles the latest frontend assets.
- The resulting `target/msp-toolbar-1.0.0.jar` already contains `js/toolbar.js`, `css/toolbar.css`, and `guac-manifest.json`.
