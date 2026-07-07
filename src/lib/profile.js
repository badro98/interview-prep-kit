// Shared candidate profile — global, NOT job-scoped. Goes through storage.js only.
// Jobs attach to profile entries via job.profileRefs (array of entry ids);
// see context.js for how attached entries surface as context blocks.

import { get, set } from "./storage.js";
import { APP } from "../../interview.config.js";

const NAME_KEY = "profile:name";
const ENTRIES_KEY = "profile:contextEntries";

export const getProfileName = () => get(NAME_KEY, null) ?? APP.candidateName;

export const setProfileName = (name) => set(NAME_KEY, name);

export const getProfileEntries = () => get(ENTRIES_KEY, []);

function newProfileEntryId() {
  return `prof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addProfileEntry({ name, content }) {
  const entry = {
    id: newProfileEntryId(),
    name: name.trim(),
    content: content.trim(),
    updatedAt: Date.now(),
  };
  set(ENTRIES_KEY, [...getProfileEntries(), entry]);
  return entry;
}

export function updateProfileEntry(id, patch) {
  const list = getProfileEntries();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], ...patch, id, updatedAt: Date.now() };
  const next = [...list];
  next[idx] = updated;
  set(ENTRIES_KEY, next);
  return updated;
}

export function removeProfileEntry(id) {
  set(ENTRIES_KEY, getProfileEntries().filter((e) => e.id !== id));
}
