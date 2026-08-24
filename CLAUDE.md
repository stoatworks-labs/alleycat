# Alleycat — command reference

See [AGENTS.md](AGENTS.md) for the mental model and the traps.

```bash
npm run dev            # electron-vite dev
npm start              # preview a production build
npm test               # unit tests
ALLEYCAT_HW=1 npm test # plus the tests that drive Alley for real (slow)
npm run typecheck
npm run lint
npm run build
npm run build:mac      # electron-builder
```

Regenerate the tray icon after editing the generator:

```bash
node scripts/make-tray-icon.mjs
```

Paths that matter:

- Config: `~/Library/Application Support/Alleycat/config.json`
- Alley presets: `<Alley>/default/Presets` and `~/Documents/Resolume Alley/Presets`
- Arena API: `http://<host>:<port>/api/v1`, spec at `/Applications/Resolume Arena/rest/docs/swagger.yaml`
