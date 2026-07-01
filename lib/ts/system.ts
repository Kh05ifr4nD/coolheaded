const SUPPORTED_SYSTEMS = ["aarch64-darwin", "aarch64-linux", "x86_64-linux"] as const;

type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];

export { SUPPORTED_SYSTEMS };
export type { SupportedSystem };
