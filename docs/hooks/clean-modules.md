# clean-modules hook: when `node_modules` folders are removed

## hooks :
* `tapestry:before:clean-modules`
* `tapestry:after:clean-modules`

These hooks run before or after tapestry removes `node_modules` folders. This happens under the following circumstances:

* at the beginning of `tapdev install` when the `--delete-modules` flag is passed
* at the beginning of `tapdev local` when the `--keep-modules` flag is *NOT* passed

## env vars :

No additional environment variables are passed to these hooks.
