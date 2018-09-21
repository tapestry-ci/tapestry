# tapdev docs - cli docs browser for tapestry docs

tapdev docs has 3 modes:
*  index mode: `tapdev docs`
*  topic view mode `tapdev docs TOPIC-NAME`
*  subtopic search mode `tapdev docs PREFIX/` -- mode is triggered by final `/`

The `tapdev docs` command is a simple browser for the files in `<tapestry-repo>/docs`, except that it replaces links to other documentation files with the proper `tapdev docs foo` query required to view this.

## Index mode
Use `tapdev docs` for a documentation index. if `-a` or `--all` is passed, tapdev will display **ALL** available tapestry documentation topics. If  `-a` or `--all` is **NOT** passed, all top-level topics will be returned.

## Topic view mode
Use `tapdev docs foo` (WITHOUT FINAL SLASH) to view a single topic. if `-a` or `--all` is passed and there are subtopics for the corresponding topic, the results from the above WITH-FINAL-SLASH version of this command will also be appended if .

## Subtopic search mode
Use `tapdev docs foo/` (WITH FINAL SLASH) to query all documentation topics that start with foo/ (subtopics of foo). This will **NOT** include any documentation of `foo` itself, only things that start with `foo/`.

This is essentially Index mode, except with entries filtered based on whether they start with `foo/`. It is also essentially Topic view mode, except without the actual display of `foo`.
