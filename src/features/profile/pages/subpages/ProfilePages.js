export const PROFILE_LOCAL_PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', icon: 'profile', deepLinkKey: 'profile-overview', requiredDomains: ['profileSummaries'] },
  { id: 'context', label: 'Context', icon: 'compass', deepLinkKey: 'profile-context', requiredDomains: ['profileContext', 'presence'] },
  { id: 'history', label: 'History', icon: 'history', deepLinkKey: 'profile-history', requiredDomains: ['timeline', 'chronicle'] },
  { id: 'competition', label: 'Competition', icon: 'match', deepLinkKey: 'profile-competition', requiredDomains: ['matches', 'leaderboards'] },
  { id: 'identity', label: 'Identity', icon: 'settings', deepLinkKey: 'profile-identity', requiredDomains: ['inventory', 'profiles'] },
]);

