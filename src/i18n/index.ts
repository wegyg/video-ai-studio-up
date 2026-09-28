/**
 * Single source of Korean UI strings. Everything user-facing lives in ko.json;
 * `t` returns a leaf by dotted path, with {n}-style interpolation.
 */
import ko from "./ko.json";

export const strings = ko;

type Dict = Record<string, unknown>;

export function t(pathStr: string, vars?: Record<string, string | number>): string {
  const parts = pathStr.split(".");
  let cur: unknown = ko as Dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Dict)) cur = (cur as Dict)[p];
    else return pathStr; // fallback to the key so missing strings are obvious
  }
  let out = typeof cur === "string" ? cur : pathStr;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}
