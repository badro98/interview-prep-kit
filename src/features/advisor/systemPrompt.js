// System prompt for the prep advisor chat agent — built from interview.config.js.

import { buildAdvisorSystem } from "../../../interview.config.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getProfileName } from "../../lib/profile.js";

/** Built fresh per call from the active job — never cache at module load. */
export function getAdvisorSystem() {
  return buildAdvisorSystem({ ...getActiveJob(), candidateName: getProfileName() });
}
