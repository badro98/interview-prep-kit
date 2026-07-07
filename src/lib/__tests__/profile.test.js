import { beforeEach, describe, expect, it } from "vitest";
import {
  getProfileName,
  setProfileName,
  getProfileEntries,
  addProfileEntry,
  updateProfileEntry,
  removeProfileEntry,
} from "../profile.js";
import { APP } from "../../../interview.config.js";

beforeEach(() => {
  localStorage.clear();
});

describe("profile name", () => {
  it("falls back to APP.candidateName when unset", () => {
    expect(getProfileName()).toBe(APP.candidateName);
  });

  it("round-trips a set name", () => {
    setProfileName("Osama Badr");
    expect(getProfileName()).toBe("Osama Badr");
  });
});

describe("profile context entries CRUD", () => {
  it("starts empty", () => {
    expect(getProfileEntries()).toEqual([]);
  });

  it("addProfileEntry creates an entry with id/name/content/updatedAt", () => {
    const entry = addProfileEntry({ name: "Resume", content: "My resume text" });
    expect(entry.id).toMatch(/^prof-/);
    expect(entry.name).toBe("Resume");
    expect(entry.content).toBe("My resume text");
    expect(typeof entry.updatedAt).toBe("number");
    expect(getProfileEntries()).toEqual([entry]);
  });

  it("updateProfileEntry patches an existing entry", () => {
    const entry = addProfileEntry({ name: "Resume", content: "v1" });
    const updated = updateProfileEntry(entry.id, { content: "v2" });
    expect(updated.content).toBe("v2");
    expect(getProfileEntries()[0].content).toBe("v2");
  });

  it("removeProfileEntry deletes an entry", () => {
    const a = addProfileEntry({ name: "A", content: "a" });
    const b = addProfileEntry({ name: "B", content: "b" });
    removeProfileEntry(a.id);
    expect(getProfileEntries().map((e) => e.id)).toEqual([b.id]);
  });
});
