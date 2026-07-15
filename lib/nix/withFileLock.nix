{ pkgs }:

let
  source = pkgs.writeText "with-file-lock.c" ''
    #define _DEFAULT_SOURCE

    #include <errno.h>
    #include <fcntl.h>
    #include <limits.h>
    #include <stdio.h>
    #include <stdlib.h>
    #include <string.h>
    #include <sys/file.h>
    #include <sys/stat.h>
    #include <unistd.h>

    static int parse_fd(const char *value) {
      char *end = NULL;
      errno = 0;
      long result = strtol(value, &end, 10);
      if (errno != 0 || end == value || *end != '\0' || result < 0 || result > INT_MAX) {
        return -1;
      }
      return (int)result;
    }

    static int validate_lock(int fd, const char *path) {
      struct stat descriptor_status;
      struct stat path_status;
      if (fstat(fd, &descriptor_status) != 0 || lstat(path, &path_status) != 0) {
        return -1;
      }
      if (!S_ISREG(descriptor_status.st_mode) ||
          descriptor_status.st_dev != path_status.st_dev ||
          descriptor_status.st_ino != path_status.st_ino) {
        errno = EINVAL;
        return -1;
      }
      return flock(fd, LOCK_EX | LOCK_NB);
    }

    int main(int argc, char **argv) {
      if (argc == 4 && strcmp(argv[1], "--validate") == 0) {
        int fd = parse_fd(argv[2]);
        if (fd < 0) {
          errno = EINVAL;
        }
        if (fd < 0 || validate_lock(fd, argv[3]) != 0) {
          fprintf(stderr, "with-file-lock: invalid locked descriptor for %s: %s\n", argv[3], strerror(errno));
          return 1;
        }
        return 0;
      }
      if (argc < 3) {
        fprintf(stderr, "usage: with-file-lock LOCK COMMAND [ARG ...]\n");
        return 2;
      }

      int fd = open(argv[1], O_RDWR | O_CREAT | O_NOFOLLOW, S_IRUSR | S_IWUSR);
      if (fd < 0) {
        fprintf(stderr, "with-file-lock: open %s: %s\n", argv[1], strerror(errno));
        return 1;
      }
      if (fd < 10) {
        int inherited_fd = fcntl(fd, F_DUPFD, 10);
        if (inherited_fd < 0 || close(fd) != 0) {
          fprintf(stderr, "with-file-lock: preserve descriptor: %s\n", strerror(errno));
          return 1;
        }
        fd = inherited_fd;
      }
      if (flock(fd, LOCK_EX) != 0) {
        fprintf(stderr, "with-file-lock: lock %s: %s\n", argv[1], strerror(errno));
        return 1;
      }
      int descriptor_flags = fcntl(fd, F_GETFD);
      if (descriptor_flags < 0 || fcntl(fd, F_SETFD, descriptor_flags & ~FD_CLOEXEC) != 0) {
        fprintf(stderr, "with-file-lock: inherit descriptor: %s\n", strerror(errno));
        return 1;
      }

      char fd_string[32];
      snprintf(fd_string, sizeof(fd_string), "%d", fd);
      if (setenv("CODEX_HOME_MIGRATION_LOCK_FD", fd_string, 1) != 0) {
        fprintf(stderr, "with-file-lock: set descriptor environment: %s\n", strerror(errno));
        return 1;
      }
      execvp(argv[2], &argv[2]);
      fprintf(stderr, "with-file-lock: exec %s: %s\n", argv[2], strerror(errno));
      return 1;
    }
  '';
in
pkgs.runCommandCC "with-file-lock" { meta.mainProgram = "with-file-lock"; } ''
  mkdir -p "$out/bin"
  $CC -std=c11 -O2 -Wall -Wextra -Werror \
    ${source} \
    -o "$out/bin/with-file-lock"
''
