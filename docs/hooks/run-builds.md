# run-builds hook: when tapestry runs custom package build/compile scripts

## hooks :
* `tapestry:before:run-builds`
* `tapestry:after:run-builds`

These hooks happen during the tapestry run-builds phases,

* during the `tapdev build` command, or during `tapdev local`. Individual packages are also built immediately after their `npm install`, so that other packages that have them as a local dependency can rely on their built resources.
* during the CI run-builds step

## env vars :

No additional environment variables are passed to these hooks.
