# CI-Lifecycle hooks: CodeBuild Phases

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks:
* `tapestry:before:ci:phase:install`
* `tapestry:after:ci:phase:install`
* `tapestry:before:ci:phase:prebuild`
* `tapestry:after:ci:phase:prebuild`
* `tapestry:before:ci:phase:build`
* `tapestry:after:ci:phase:build`
* `tapestry:before:ci:phase:postbuild`
* `tapestry:after:ci:phase:postbuild`

These run for each build phase within tapestry-ci, which correspond to the phases available to CodeBuild. Hooks of this type run in this fashion:
1. ALL before hooks for this event run for all packages.
2. ALL of the regular work involved in this event happens.
3. ALL after hooks for this event run for all packages.

This is in contrast to the "basic" hooks, which instead run `before -> work -> after` for each individual package as the work is done, regardless of the state of any other package.

## env-vars:

There are none defined specifically for hooks, but since these all run under the CI you have access to all the variables that are defined in any given tapestry build. The best reference for these is to view the output of `tapdev ci show [id]` for any recent build! It is not recommended that you use these env vars outside of ci:phase or ci:step hooks, and use them within these hooks only with caution.
