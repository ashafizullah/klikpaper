import { expect, test } from "bun:test";
import en from "./en";
import id from "./id";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("Indonesian has every key, with the same placeholders", () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect({ key, has: typeof id[key] }).toEqual({ key, has: "string" });
    expect({ key, vars: vars(id[key]) }).toEqual({ key, vars: vars(en[key]) });
  }
  expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
});
