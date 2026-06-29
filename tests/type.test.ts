import type { IsAny, IsExact, IsUnknown } from "./testingTypes.ts";
import type { npmHashConfigForSystems, npmHashesForSystems } from "coolheaded/npmUpdater.ts";
import type { Effect } from "effect";
import type { InvalidNpmMetadataError } from "coolheaded/npmRegistry.ts";
import type { PackageHashConfig } from "coolheaded/packageConfig.ts";
import type { SupportedSystem } from "coolheaded/system.ts";
import { assertType } from "@jsr/std__testing/types";

type ReadonlyHashes = Readonly<Record<SupportedSystem, string>>;
type NpmHashesEffect = ReturnType<typeof npmHashesForSystems>;
type NpmHashConfigEffect = ReturnType<typeof npmHashConfigForSystems>;

assertType<
  IsExact<
    PackageHashConfig,
    {
      readonly binaryVersion?: string;
      readonly platformPackageHashes: ReadonlyHashes;
      readonly version: string;
    }
  >
>(true);
assertType<IsAny<PackageHashConfig>>(false);
assertType<IsUnknown<PackageHashConfig>>(false);
assertType<
  IsExact<NpmHashesEffect, Effect.Effect<Record<string, string>, InvalidNpmMetadataError>>
>(true);
assertType<IsAny<NpmHashesEffect>>(false);
assertType<IsUnknown<NpmHashesEffect>>(false);
assertType<IsExact<NpmHashConfigEffect, Effect.Effect<PackageHashConfig, InvalidNpmMetadataError>>>(
  true,
);
