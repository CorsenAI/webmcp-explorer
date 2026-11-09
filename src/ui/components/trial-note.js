// The page's WebMCP origin-trial token, said in Chrome's own terms: honoured here, expired, for
// another origin, third-party, or not signed with Chrome's key (core/origin-trial.js).

import { t } from '../dom.js';

export const TRIAL_SOON_DAYS = 14;

export function trialNote(env) {
  const token = env?.originTrial?.token;
  if (!token) return null;
  const date = token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : '';
  if (token.signature === 'invalid') return t('env_otBadSignature');
  if (token.status === 'expired') return t('env_otExpired', [date]);
  if (token.status === 'wrong-origin') return t('env_otWrongOrigin', [String(token.origin)]);
  if (token.status === 'third-party') return t('env_otThirdParty', [String(token.origin), date]);
  // An insecure page is already reported by the secure-context check.
  if (token.status !== 'valid') return null;
  return t('env_otValid', [date, String(token.daysLeft)]);
}

// What the status bar should flag, if anything: a token Chrome ignores, or one about to expire.
export function trialAlert(env) {
  const token = env?.originTrial?.token;
  if (!token) return null;
  if (token.signature === 'invalid' || token.status === 'wrong-origin') return { label: t('status_trialIgnored'), kind: 'warn' };
  if (token.status === 'expired') return { label: t('status_trialExpired'), kind: 'danger' };
  if ((token.status === 'valid' || token.status === 'third-party') && token.daysLeft <= TRIAL_SOON_DAYS) {
    return { label: t('status_trialDaysLeft', [String(Math.max(0, token.daysLeft))]), kind: 'warn' };
  }
  return null;
}
