import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, set, remove, listKeys, onQuotaError } from "../storage.js";

beforeEach(() => {
  localStorage.clear();
  onQuotaError(null);
});

describe("storage adapter", () => {
  it("round-trips JSON values under the iprep namespace", () => {
    expect(set("foo", { a: 1 })).toBe(true);
    expect(get("foo")).toEqual({ a: 1 });
    expect(localStorage.getItem("iprep:foo")).toBe('{"a":1}');
  });

  it("returns the fallback for missing keys", () => {
    expect(get("missing", "fb")).toBe("fb");
    expect(get("missing")).toBeNull();
  });

  it("returns the fallback for corrupted JSON", () => {
    localStorage.setItem("iprep:bad", "{not json");
    expect(get("bad", 42)).toBe(42);
  });

  it("remove deletes the key", () => {
    set("gone", 1);
    remove("gone");
    expect(get("gone")).toBeNull();
  });

  it("listKeys returns namespace-stripped keys filtered by prefix", () => {
    set("flashcards:progress", {});
    set("flashcards:custom", []);
    set("advisor:threads", []);
    localStorage.setItem("other-app:x", "1"); // outside namespace — ignored
    expect(listKeys("flashcards:").sort()).toEqual([
      "flashcards:custom",
      "flashcards:progress",
    ]);
    expect(listKeys().sort()).toEqual([
      "advisor:threads",
      "flashcards:custom",
      "flashcards:progress",
    ]);
  });

  it("fires the quota handler and returns false when setItem throws quota", () => {
    const handler = vi.fn();
    onQuotaError(handler);
    const err = new DOMException("full", "QuotaExceededError");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw err;
    });
    expect(set("big", "x")).toBe(false);
    expect(handler).toHaveBeenCalledWith("big", err);
    spy.mockRestore();
  });
});
