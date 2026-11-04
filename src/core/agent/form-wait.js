// A declarative form tool without `toolautosubmit` is filled in by the browser, which then waits for a person to
// press its submit button: the call stays pending until then, by design ("The user must manually click Submit",
// developer.chrome.com/docs/ai/webmcp/declarative-api; the caller's side is open as webmachinelearning/webmcp#307).
// Measured on Chrome 155 and 157 (2026-10-21): aborting such a call settles it at once with an AbortError, fires
// `toolcancel` and releases the form, whose fields stay filled.
//
// Agent Lab has a person in front of it: the run says what it waits for, and Cancel ends the wait. An eval runs
// unattended, so a call to a form tool still pending after FORM_WAIT_MS is cancelled and the model is told why.
// Explorer does not know whether a form carries `toolautosubmit`, so every declarative call is treated alike; an
// auto-submitting form answers long before the limit. Pure: no I/O.

import { STATUS } from './loop.js';

export const FORM_WAIT_MS = 30000;
export const FORM_NOT_SUBMITTED = 'form-not-submitted';

// The real names of the declarative tools without toolautosubmit the run is executing right now, in the model's order.
export function awaitingForms(run) {
  if (run?.status !== STATUS.runningTools) return [];
  return (run.pending ?? [])
    .filter((call) => call.target?.declarative && call.target?.autoSubmit !== true)
    .map((call) => call.target.name);
}

// What the model reads when nobody submitted the form in time. The page's form stays filled in.
export function formNotSubmitted(outcome, ms = FORM_WAIT_MS) {
  return {
    ...outcome,
    ok: false,
    code: FORM_NOT_SUBMITTED,
    error: `The page filled in this form and waited for a person to press its submit button (a declarative tool `
      + `without toolautosubmit). No result arrived within ${Math.round(ms / 1000)} s during this unattended run. `
      + 'Explorer cancelled the call. Its effects are unknown; review the page before a new request. It will not be retried.',
  };
}
