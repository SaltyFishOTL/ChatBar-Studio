---
name: studio-web-release
description: Publish the independent ChatBar Studio web repository and deployable ZIP.
---

# Studio web release

- Repository: SaltyFishOTL/ChatBar-Studio. Related Android project: SaltyFishOTL/ChatChatBar. Do not use Android APK release automation.
- Author-owned code is GPL-3.0-only; preserve third-party notices and original resource license statements.
- Build with npm run build; package with python tools/package_release.py. Ignored release/ holds the ZIP and SHA256SUMS.txt.
- Keep package.json, package-lock.json, tag and docs/RELEASE-v<version>.md aligned. Initial v0.1.0 is a prerelease pending runtime acceptance.
- Publish source first, tag its exact commit, upload ZIP and checksums. Verify public visibility, GPL detection, remote commit, tag target, release body and assets.
- GitHub release is separate from Cloud Run/site deployment.
