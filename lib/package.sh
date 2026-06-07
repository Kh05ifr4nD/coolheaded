# shellcheck shell=bash

failCheck() {
  echo "$1" >&2
  exit 1
}

assertFileExists() {
  path="$1"
  test -e "$path" || failCheck "missing expected file: $path"
}

keepOnlyMatchingChildren() {
  root="$1"
  prefix="$2"
  shift 2
  [ -d "$root" ] || return 0

  for child in "$root"/"$prefix"*; do
    [ -e "$child" ] || continue
    childName="$(basename "$child")"
    keepChild=false
    for allowedName in "$@"; do
      if [ "$childName" = "$allowedName" ]; then
        keepChild=true
      fi
    done
    if [ "$keepChild" = false ]; then
      rm -rf "$child"
    fi
  done
}
