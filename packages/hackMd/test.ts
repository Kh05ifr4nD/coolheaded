const USER = { id: "fixture-user", name: "Nix Test", userPath: "nix-test" } as const;
const UNAUTHORIZED_STATUS = 401;
const NOT_FOUND_STATUS = 404;
const COMMAND_TIMEOUT_MS = 10_000;
const NOTE = {
  content: "# Offline fixture",
  id: "fixture-note",
  tags: [],
  title: "Nix fixture",
} as const;
const RESPONSES: Readonly<Record<string, unknown>> = {
  "/v1/me": USER,
  "/v1/notes": [NOTE],
  "/v1/notes/fixture-note": NOTE,
};

type IncomingRequest = Readonly<{
  readonly headers: Readonly<{ readonly get: (name: string) => string | null }>;
  readonly method: string;
  readonly url: string;
}>;

function normalizedJson(contents: string): string {
  const value: unknown = JSON.parse(contents);
  return JSON.stringify(value);
}

Deno.test("packaged CLI authenticates, lists and exports notes", async (): Promise<void> => {
  const [executable] = Deno.args;
  if (executable === undefined) {
    throw new Error("Missing packaged CLI path");
  }
  const executablePath = executable;
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    throw new Error("Missing isolated test home");
  }
  const isolatedHome = home;
  const requests = new Set<string>();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    (request: IncomingRequest): Response => {
      const { pathname } = new globalThis.URL(request.url);
      requests.add(pathname);
      if (request.headers.get("Authorization") !== "Bearer nix-test-token") {
        return globalThis.Response.json(
          { message: "Unauthorized" },
          { status: UNAUTHORIZED_STATUS },
        );
      }
      if (request.method !== "GET" || !Object.hasOwn(RESPONSES, pathname)) {
        return globalThis.Response.json({ message: "Not found" }, { status: NOT_FOUND_STATUS });
      }
      return globalThis.Response.json(RESPONSES[pathname]);
    },
  );

  async function cli(
    args: readonly string[],
    token = "nix-test-token",
  ): Promise<Deno.CommandOutput> {
    return await new Deno.Command(executablePath, {
      args: [...args],
      clearEnv: true,
      env: {
        HMD_API_ACCESS_TOKEN: token,
        HMD_API_ENDPOINT_URL: `http://127.0.0.1:${server.addr.port}/v1`,
        HOME: isolatedHome,
      },
      signal: globalThis.AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      stderr: "piped",
      stdout: "piped",
    }).output();
  }

  const decoder = new globalThis.TextDecoder();
  try {
    const whoami = await cli(["whoami", "--output=json", "--columns=id"]);
    if (
      !whoami.success ||
      normalizedJson(decoder.decode(whoami.stdout)) !== JSON.stringify([{ id: USER.id }])
    ) {
      throw new Error(`Unexpected user response: ${decoder.decode(whoami.stderr)}`);
    }
    const notes = await cli(["notes", "--output=json", "--columns=id,title"]);
    if (
      !notes.success ||
      normalizedJson(decoder.decode(notes.stdout)) !==
        JSON.stringify([{ id: NOTE.id, title: NOTE.title }])
    ) {
      throw new Error(`Unexpected notes response: ${decoder.decode(notes.stderr)}`);
    }
    const exported = await cli(["export", "--noteId=fixture-note"]);
    if (!exported.success || decoder.decode(exported.stdout).trim() !== NOTE.content) {
      throw new Error(`Unexpected exported content: ${decoder.decode(exported.stderr)}`);
    }
    if (!Object.keys(RESPONSES).every((path): boolean => requests.has(path))) {
      throw new Error("CLI did not call every expected API endpoint");
    }
    const denied = await cli(["whoami"], "invalid-test-token");
    if (denied.success || !decoder.decode(denied.stderr).includes("credentials are correct")) {
      throw new Error("CLI did not reject invalid credentials");
    }
  } finally {
    await server.shutdown();
  }
});

export { normalizedJson };
