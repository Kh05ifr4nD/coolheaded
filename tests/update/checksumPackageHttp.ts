import {
  ASSET_BODIES,
  PACKAGES,
  assetUrls,
  manifest,
  request,
  response,
  runFailure,
  successPlan,
} from "./checksumPackageFixture.ts";
import { httpStatusError, httpTransportError } from "coolheaded/core/fetchHttpClient.ts";
import { Effect } from "effect";
import type { HttpClientError } from "coolheaded/core/httpClient.ts";

const SERVICE_UNAVAILABLE_STATUS = 503;
type ExpectedHttpRequest = Parameters<typeof runFailure>[1][number];

for (const fixture of PACKAGES) {
  for (const errorKind of ["status", "transport"] as const) {
    for (const index of [0, 1, 2] as const) {
      Deno.test(`${fixture.repo} checksum update preserves ${errorKind} failure at asset ${index}`, async (): Promise<void> => {
        const urls = assetUrls(fixture);
        const failingRequest = request(urls[index]);
        const error =
          errorKind === "status"
            ? httpStatusError(failingRequest, response(urls[index], [], SERVICE_UNAVAILABLE_STATUS))
            : httpTransportError(failingRequest, new Error("transport sentinel"));
        const failingPlan: ExpectedHttpRequest = {
          effect: (): Effect.Effect<never, HttpClientError> => Effect.fail(error),
          request: failingRequest,
        };
        const plans = [
          successPlan(fixture.manifestUrl, [...manifest(fixture)]),
          index === 0 ? failingPlan : successPlan(urls[0], ASSET_BODIES[0]),
          index === 1 ? failingPlan : successPlan(urls[1], ASSET_BODIES[1]),
          index === 2 ? failingPlan : successPlan(urls[2], ASSET_BODIES[2]),
        ];
        await runFailure(fixture, plans, error);
      });
    }
  }
}
