# dev-install / prod-install / any-install hooks: run before/after `npm install`

## hooks :
* `tapestry:before:dev-install`
* `tapestry:before:prod-install`
* `tapestry:before:any-install`
* `tapestry:after:dev-install`
* `tapestry:after:prod-install`
* `tapestry:after:any-install`

These hooks run before or after any npm install command. These run in a special order:

1. `tapestry:before:any-install`
2. `tapestry:before:dev-install` *OR* `tapestry:before:prod-install`, depending on whether `--production` is passed to `npm install`
3. the actual `npm install` command for this package, with or without `--production` flag
4. `tapestry:after:dev-install` *OR* `tapestry:after:prod-install`, depending on whether `--production` is passed to `npm install`
5. `tapestry:after:any-install`

## env vars :

No additional environment variables are passed to these hooks.
