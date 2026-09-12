# Bash Fighter Contributor Licence Agreement

Thank you for contributing. This document explains the rights you give us
when you contribute, and the rights you keep. It is short on purpose.

1. **You keep your copyright.** This is a licence, not an assignment. You
   continue to own everything you write.

2. **What you grant us.** You grant Bash Entertainment a perpetual,
   worldwide, non-exclusive, royalty-free, irrevocable licence to use,
   reproduce, modify, prepare derivative works of, publicly display,
   publicly perform, sublicense, and distribute your contribution and
   derivative works of it, under any licence terms, including proprietary
   terms.

3. **Why we ask for that.** Bash Fighter is released under the AGPL-3.0,
   and it will stay that way. We ask for a broader grant so that we can
   also offer the game commercially — for example as a hosted service or
   under a separate licence to a partner — without needing to track down
   every contributor for permission. Without this grant, any commercial
   offering would be legally impossible, and this project needs to be
   able to fund itself.

4. **What we promise you.** The publicly released source of Bash Fighter
   will remain available under the AGPL-3.0 or a later version of it.
   Your contribution will be released under that licence alongside
   everyone else's. We will not use this agreement to take the public
   project closed.

5. **Patents.** You grant Bash Entertainment and recipients of software
   distributed by us a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable patent licence to make, use, sell, offer for sale, import,
   and otherwise transfer your contribution, limited to patent claims
   that your contribution alone or in combination with the project
   necessarily infringes.

6. **You confirm that** each contribution is your original work, or that
   you have the right to submit it under these terms; that if your
   employer has rights to work you create, you have permission to
   contribute or your employer has waived those rights; and that you are
   not knowingly including code owned by someone else, or code under a
   licence incompatible with the AGPL-3.0, without saying so clearly in
   your pull request.

7. **No obligation.** You provide your contribution "as is", with no
   warranties. We are not obliged to accept, merge, or keep any
   contribution.

## Status

This text has **not yet been reviewed by a lawyer**. It is a plain-language
draft modelled on common Apache-style CLA and Harmony licence-grant
patterns, intended to be checked by someone qualified before the project
starts accepting a large volume of outside pull requests.

## How you sign

Signing is a one-line entry in [`CLA-SIGNATURES.md`](./CLA-SIGNATURES.md),
added by you in your own pull request:

```
- @your-github-username: I have read and agree to the Bash Fighter CLA (CLA.md).
```

You only need to do this once — it covers every future contribution from
that GitHub account. The `CLA Check` GitHub Actions workflow reads
`CLA-SIGNATURES.md` on every pull request; if your username isn't listed
with that line, it comments on your PR with these exact instructions and
fails a required check, so a PR cannot be merged without this step. There
is no separate account to create and nothing to install — it's a plain
text file in this repository.

Note for maintainers: a PR from a first-time outside contributor makes
its `CLA Check` run land in GitHub's `action_required` queue until a
maintainer clicks "Approve and run workflows" once for that PR. Until
that click happens, the check simply hasn't run yet — it is not a pass,
and the PR template and this document both tell the contributor what to
do regardless, so the requirement is visible even before the workflow has
executed.
