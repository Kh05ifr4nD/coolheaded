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

    static int exchange_paths(const char *first, const char *second) {
    #if defined(__APPLE__)
      return renamex_np(first, second, RENAME_SWAP);
    #else
      return syscall(
        SYS_renameat2,
        AT_FDCWD,
        first,
        AT_FDCWD,
        second,
        RENAME_EXCHANGE
      );
    #endif
    }

    static void report_exchange_error(const char *first, const char *second, int error) {
      fprintf(
        stderr,
        "exchange-paths: %s <-> %s: %s\n",
        first,
        second,
        strerror(error)
      );
    }

    int main(int argc, char **argv) {
      if (argc != 3 && argc != 4) {
        fprintf(stderr, "usage: exchange-paths FIRST SECOND [FINAL]\n");
        return 2;
      }

      if (exchange_paths(argv[1], argv[2]) != 0) {
        report_exchange_error(argv[1], argv[2], errno);
        return 1;
      }

      if (argc == 4 && exchange_paths(argv[3], argv[2]) != 0) {
        int exchange_error = errno;
        if (exchange_paths(argv[1], argv[2]) != 0) {
          report_exchange_error(argv[1], argv[2], errno);
          fprintf(stderr, "exchange-paths: unable to restore the first exchange\n");
          return 1;
        }
        report_exchange_error(argv[3], argv[2], exchange_error);
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
