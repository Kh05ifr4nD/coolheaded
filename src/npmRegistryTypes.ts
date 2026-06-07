interface NpmPackageVersion {
  readonly dist?: {
    readonly integrity?: unknown;
  };
}

interface NpmPackageMetadata {
  readonly "dist-tags"?: Readonly<Record<string, unknown>>;
  readonly versions?: Readonly<Record<string, NpmPackageVersion>>;
}

export type { NpmPackageMetadata, NpmPackageVersion };
