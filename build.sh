#!/usr/bin/env bash
# Wrapper used by CI / shared release workflows. Mirrors url-porter/build.sh.
set -euo pipefail
npm run package-syle
