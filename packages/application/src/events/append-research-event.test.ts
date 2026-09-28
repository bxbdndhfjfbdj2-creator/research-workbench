import { describe, expect, it } from "vitest";
import { assertSecretSafe, type JsonValue } from "@research-workbench/domain/src/events";

describe("assertSecretSafe", () => {
  it.each([
    { password: "secret" },
    { token: "secret" },
    { secret: "secret" },
    { privateKey: "secret" },
    { nested: { apiKey: "secret" } },
    { items: [{ authorization: "secret" }] },
  ] satisfies JsonValue[])("rejects reserved secret-bearing keys %#", (value) => {
    expect(() => assertSecretSafe(value)).toThrow(/secret|sensitive|credential/i);
  });

  it("accepts ordinary research metadata", () => {
    expect(() =>
      assertSecretSafe({
        projectId: "project-1",
        result: { coefficient: 0.42, note: "exploratory" },
      }),
    ).not.toThrow();
  });
});
