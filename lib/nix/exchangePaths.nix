{ pkgs }:

let
  source = pkgs.writeText "exchange-paths.c" ''
    #define _GNU_SOURCE

    #include <errno.h>
    #include <stdio.h>
    #include <string.h>

    #if defined(__APPLE__)
    #include <sys/stdio.h>
    #elif defined(__linux__)
    #include <fcntl.h>
    #include <linux/fs.h>
    #include <sys/syscall.h>
    #include <unistd.h>
    #else
    #error "exchange-paths only supports Darwin and Linux"
    #endif

    int main(int argc, char **argv) {
      if (argc != 3) {
        fprintf(stderr, "usage: exchange-paths FIRST SECOND\n");
        return 2;
      }

    #if defined(__APPLE__)
      int result = renamex_np(argv[1], argv[2], RENAME_SWAP);
    #else
      int result = syscall(
        SYS_renameat2,
        AT_FDCWD,
        argv[1],
        AT_FDCWD,
        argv[2],
        RENAME_EXCHANGE
      );
    #endif

      if (result != 0) {
        fprintf(
          stderr,
          "exchange-paths: %s <-> %s: %s\n",
          argv[1],
          argv[2],
          strerror(errno)
        );
        return 1;
      }
      return 0;
    }
  '';
in
pkgs.runCommandCC "exchange-paths" { meta.mainProgram = "exchange-paths"; } ''
  mkdir -p "$out/bin"
  $CC -std=c11 -O2 -Wall -Wextra -Werror \
    ${source} \
    -o "$out/bin/exchange-paths"
''
