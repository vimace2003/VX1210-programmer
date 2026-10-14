# Contributing to CE42 Next

Thanks for helping! Issues and pull requests are welcome in English, Português, Español or Русский.

## Most useful right now

- **Real radio tests.** The protocol is validated only against a simulator. Use the
  *Real radio test report* issue template — successful reads and writes are worth reporting too.
- **Translations.** UI texts live in `apps/web/src/i18n/strings.ts` and `help.ts`; the desktop
  dialogs in `apps/desktop/main.cjs` (`TEXT`).
- Bug reports with clear steps.

## Development setup

Requires Node.js 22 or newer.

```sh
npm install
npm run dev          # web app on http://localhost:5173 (Chrome/Edge for Web Serial)
npm run desktop      # Electron app with the native port chooser
npm run typecheck
npm test
```

The *Simulated radio* option in the toolbar exercises the whole read/write path without
hardware.

Building installers for your own platform: `npm run dist:desktop` (output in `apps/desktop/release/`),
then `npm run smoke -w @ce42/desktop` (on headless Linux: `xvfb-run -a npm run smoke -w @ce42/desktop`).

## Layout

| Path | What |
| --- | --- |
| `packages/core` | memory map, `.C42` codec, CSV, clone protocol, radio simulator — no dependencies, transport agnostic |
| `apps/web` | React UI + Web Serial transport |
| `apps/desktop` | Electron shell, native port chooser, packaging |
| `docs/` | protocol, memory map and reverse-engineering notes |

## Rules of the road

- **Never write alignment, calibration or serial-number data to the radio.** The write sequence
  deliberately preserves those areas; keep it that way. Service functions are out of scope.
- **Keep `.C42` files byte-compatible** with the original CE42. Changes to the codec need a test in
  `packages/core/test`, and changes to the memory map or protocol must update `docs/`.
- **Clean-room only.** Do not paste decompiled or disassembled code of the original software into
  this repository. Describe formats and behaviour in your own words and code.
- Every UI string in all four languages. If you don't speak one, say so in the PR and leave the
  English text there — someone will translate it.
- Keep `@ce42/core` free of runtime dependencies.
- Add a line to `CHANGELOG.md` under *Unreleased*.

## Releasing (maintainers)

1. Set the version in `apps/desktop/package.json` (the product version shown in the app).
2. Move the *Unreleased* notes in `CHANGELOG.md` under the new version.
3. Open a pull request with these changes; `main` only accepts pull requests that pass CI.
4. After merging, tag the merge commit: `git switch main && git pull && git tag -a vX.Y.Z -m "CE42 Next X.Y.Z" && git push origin vX.Y.Z`.
5. The *Release* workflow builds and smoke-tests Windows, macOS and Linux packages and creates a
   **draft** release with checksums. Review it and press *Publish*; that also deploys the web app
   to GitHub Pages.

Tags with a suffix (`v0.4.0-beta.1`) become pre-releases.

## License

By contributing you agree that your contributions are licensed under the
[GNU GPL v3.0 or later](LICENSE).
