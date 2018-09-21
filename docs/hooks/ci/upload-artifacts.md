# upload-artifacts hook: when tapestry uploads a copy of its artifacts bundle

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:upload-artifacts`
* `tapestry:after:upload-artifacts`

These hooks happen before/after tapestry uploads its artifacts zip. Artifacts are uploaded **FOUR TIMES** for every successful build, at the end of every build phase.

## env vars :

* **TAPESTRY_HOOK_UPLOAD_ARTIFACTS_REASON** : will be one of: `after-install`, `after-prebuild`, `after-build`, `after-postbuild`
* **TAPESTRY_HOOK_UPLOAD_ARTIFACTS_ZIP_S3_LOC** : the full artifacts zip url in s3:// form
* **TAPESTRY_HOOK_UPLOAD_ARTIFACTS_INCREMENTAL_ZIP_S3_LOC** : the incremental artifacts url in s3:// form. this is the same as the above url but with `-REASON` inserted before the .zip
* **TAPESTRY_HOOK_UPLOAD_ARTIFACTS_ZIP_LOCAL_FILE** : the local temporary path to the artifacts.zip file that was/will be uploaded to the s3 bucket
