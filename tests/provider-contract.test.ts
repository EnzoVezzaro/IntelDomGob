// tests/provider-contract.test.ts
// Contract test: any object satisfying the ProviderDescriptor shape must be
// storable and retrievable from the ProviderRegistry. This guarantees the
// "add a provider, nothing else changes" rule holds for future providers.

import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "@intel.dom.gob/providers";
import type { SearchProvider, AiProvider } from "@intel.dom.gob/providers";

function fakeSearch(): SearchProvider {
  return {
    id: "fake-search",
    kind: "search",
    label: "Fake",
    enabled: true,
    async search() {
      return [];
    },
  };
}

function fakeAi(): AiProvider {
  return {
    id: "fake-ai",
    kind: "ai",
    label: "Fake",
    enabled: true,
    async generate() {
      return { text: "ok", model: "fake" };
    },
  };
}

describe("ProviderRegistry contract", () => {
  it("stores and retrieves search providers by id", () => {
    const reg = new ProviderRegistry();
    reg.registerSearch(fakeSearch());
    expect(reg.getSearch("fake-search")?.id).toBe("fake-search");
    expect(reg.listSearch()).toHaveLength(1);
  });

  it("stores and retrieves ai providers by id", () => {
    const reg = new ProviderRegistry();
    reg.registerAi(fakeAi());
    expect(reg.getAi("fake-ai")?.id).toBe("fake-ai");
  });

  it("isolates search and ai registries", () => {
    const reg = new ProviderRegistry();
    reg.registerSearch(fakeSearch());
    reg.registerAi(fakeAi());
    expect(reg.listSearch()).toHaveLength(1);
    expect(reg.listAi()).toHaveLength(1);
  });

  it("reports unknown providers as undefined (safe lookup)", () => {
    const reg = new ProviderRegistry();
    expect(reg.getSearch("nope")).toBeUndefined();
    expect(reg.getAi("nope")).toBeUndefined();
  });
});
