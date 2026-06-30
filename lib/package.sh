# shellcheck shell=bash

failCheck() {
  echo "$1" >&2
  exit 1
}

assertFileExists() {
  path="$1"
  test -e "$path" || failCheck "missing expected file: $path"
}

assertExecutableExists() {
  path="$1"
  test -x "$path" || failCheck "missing expected executable: $path"
}

assertExecutableSet() {
  binDir="$1"
  shift

  test -d "$binDir" || failCheck "missing expected bin directory: $binDir"

  for expectedName in "$@"; do
    assertExecutableExists "$binDir/$expectedName"
  done

  for executable in "$binDir"/*; do
    [ -e "$executable" ] || continue
    [ -f "$executable" ] || [ -L "$executable" ] || continue
    [ -x "$executable" ] || failCheck "non-executable file in bin directory: $executable"

    executableName="$(basename "$executable")"
    expected=false
    for expectedName in "$@"; do
      if [ "$executableName" = "$expectedName" ]; then
        expected=true
      fi
    done

    if [ "$expected" = false ]; then
      failCheck "unexpected executable in $binDir: $executableName"
    fi
  done
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
