# CI-only hooks

The following hooks run under CI only. None of them will ever run under `tapdev`.

* `upload-artifacts`
* `publish`
* `deploy`
* `publish-docs`
* `ci:phase:*`, phases are `install`, `prebuild`, `build`, `postbuild`. Docs under `hooks/ci/phase`
* `ci:step:*`, steps are `prepare-build-root`, `install-globals`, `install-dev-dependencies`, `run-builds`, `run-tests`, `clean-dependencies`, `do-deploys`. docs under `hooks/ci/step`

See individual documentation for each of these commands.
