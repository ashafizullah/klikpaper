import { describe, expect, test } from "bun:test";
import type { SignatureReport } from "./ipc";
import { summarize } from "./signatures";

const sig = (over: Partial<SignatureReport>): SignatureReport => ({
  field: null, page: null, timestamp: false, subFilter: null, name: null, reason: null, location: null, contact: null, signedAt: null,
  signer: { name: "A", organization: null, issuer: "CA", issuerOrganization: null, validFrom: "", validTo: "", selfSigned: false },
  chain: [], status: "valid", intact: true, verified: true, coversAll: true, certValidWhenSigned: true, problem: null, ...over,
});

describe("signature summary", () => {
  test("green only when every signature covers the file with an issued certificate", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([sig({})])).toBe("valid");
    expect(summarize([sig({ signer: { ...sig({}).signer!, selfSigned: true } })])).toBe("selfSigned");
  });

  test("an edit after a signature isn't hidden by a later signature over everything", () => {
    expect(summarize([sig({ coversAll: false }), sig({ signer: { ...sig({}).signer!, selfSigned: true } })])).toBe("changed");
  });

  test("a bad or unchecked signature outweighs the rest", () => {
    expect(summarize([sig({}), sig({ status: "invalid" })])).toBe("invalid");
    expect(summarize([sig({}), sig({ status: "unknown" })])).toBe("unknown");
  });
});
