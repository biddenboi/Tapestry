import getSupabaseClient, { getSupabaseConfiguration } from './SupabaseClient.js';

export const PRIMARY_OWNER_EMAIL = 'yujinpetercho@gmail.com';
export const BACKUP_OWNER_EMAIL = 'oatstakes@gmail.com';
const OWNER_EMAILS = new Set([PRIMARY_OWNER_EMAIL, BACKUP_OWNER_EMAIL]);

function approvedOwnerEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!OWNER_EMAILS.has(normalized)) {
    throw new Error('This email is not an approved Tapestry owner address.');
  }
  return normalized;
}

function privateSyncPassword(password, { newPassword = false } = {}) {
  const value = String(password || '');
  if (!value) throw new Error('Enter the private-sync password.');
  if (newPassword && value.length < 12) {
    throw new Error('Use at least 12 characters for the private-sync password.');
  }
  if (value.length > 128) throw new Error('The private-sync password is too long.');
  return value;
}

function redirectUrl() {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

function publicError(error) {
  if (!error) return null;
  const message = error.code === 'over_email_send_rate_limit'
    ? 'Email recovery is temporarily limited. Use your private-sync password, or wait before requesting another recovery email.'
    : error.message || 'Private sync authentication failed.';
  return Object.freeze({
    code: error.code || error.name || 'supabase-auth-error',
    message,
  });
}

function isLegacyWorkingSetSyncError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('mobile working-set publish session')
    || message.includes('working-set publish session is no longer active');
}

export class SupabaseAuthService {
  constructor({ client = getSupabaseClient(), configuration = getSupabaseConfiguration() } = {}) {
    this.client = client;
    this.configuration = configuration;
    this.listeners = new Set();
    this.authSubscription = null;
    this.initializePromise = null;
    this.snapshot = Object.freeze({
      configured: Boolean(configuration?.configured && client),
      status: configuration?.configured && client ? 'checking' : 'unavailable',
      session: null,
      user: null,
      syncStatus: 'local-only',
      syncError: null,
      busy: false,
      notice: null,
      error: null,
    });
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  _set(patch) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }

  initialize() {
    if (this.initializePromise) return this.initializePromise;
    if (!this.client) {
      this._set({ status: 'unavailable' });
      return Promise.resolve(this.snapshot);
    }
    this.initializePromise = (async () => {
      const { data, error } = await this.client.auth.getSession();
      if (error) {
        this._set({ status: 'signed-out', error: publicError(error) });
      } else {
        this._set({
          session: data.session || null,
          user: data.session?.user || null,
          status: data.session ? 'signed-in' : 'signed-out',
          error: null,
        });
      }
      const { data: authListener } = this.client.auth.onAuthStateChange((_event, session) => {
        this._set({
          session: session || null,
          user: session?.user || null,
          status: session ? 'signed-in' : 'signed-out',
          syncStatus: session ? this.snapshot.syncStatus : 'local-only',
          syncError: session ? this.snapshot.syncError : null,
          busy: false,
          error: null,
        });
      });
      this.authSubscription = authListener.subscription;
      return this.snapshot;
    })();
    return this.initializePromise;
  }

  async signIn(email = PRIMARY_OWNER_EMAIL) {
    const normalized = approvedOwnerEmail(email);
    if (!this.client) throw new Error('Private sync is not configured in this build.');
    this._set({ busy: true, notice: null, error: null });
    const { error } = await this.client.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectUrl(),
      },
    });
    if (error) {
      this._set({ busy: false, error: publicError(error) });
      throw error;
    }
    this._set({
      busy: false,
      notice: `A private sign-in link was sent to ${normalized}.`,
    });
    return this.snapshot;
  }

  async signInWithPassword(email = PRIMARY_OWNER_EMAIL, password) {
    const normalized = approvedOwnerEmail(email);
    const secret = privateSyncPassword(password);
    if (!this.client) throw new Error('Private sync is not configured in this build.');
    this._set({ busy: true, notice: null, error: null });
    const { data, error } = await this.client.auth.signInWithPassword({
      email: normalized,
      password: secret,
    });
    if (error) {
      this._set({ busy: false, error: publicError(error) });
      throw error;
    }
    this._set({
      busy: false,
      session: data.session || null,
      user: data.user || data.session?.user || null,
      status: data.session ? 'signed-in' : 'signed-out',
      notice: null,
      error: null,
    });
    return this.snapshot;
  }

  async signInWithGoogle() {
    if (!this.client) throw new Error('Private sync is not configured in this build.');
    this._set({ busy: true, notice: null, error: null });
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl() },
    });
    if (error) {
      this._set({ busy: false, error: publicError(error) });
      throw error;
    }
    return data;
  }

  async setPassword(password) {
    const secret = privateSyncPassword(password, { newPassword: true });
    if (!this.client || !this.snapshot.session?.user) {
      throw new Error('Sign in on this device before setting a private-sync password.');
    }
    this._set({ busy: true, notice: null, error: null });
    const { data, error } = await this.client.auth.updateUser({ password: secret });
    if (error) {
      this._set({ busy: false, error: publicError(error) });
      throw error;
    }
    this._set({
      busy: false,
      user: data.user || this.snapshot.user,
      notice: 'Private-sync password saved. You can now use it on your iPhone.',
      error: null,
    });
    return this.snapshot;
  }

  async signOut() {
    if (!this.client) return;
    this._set({ busy: true, notice: null, error: null });
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) {
      this._set({ busy: false, error: publicError(error) });
      throw error;
    }
    this._set({
      busy: false,
      session: null,
      user: null,
      status: 'signed-out',
      syncStatus: 'local-only',
      syncError: null,
    });
  }

  setSyncState(syncStatus, error = null) {
    const patch = {
      syncStatus,
      syncError: publicError(error),
    };
    // Older builds incorrectly stored transport failures in the authentication
    // error field. Clear that one known legacy value during any state update so
    // a connected runtime cannot keep displaying a dead publication-session error.
    if (isLegacyWorkingSetSyncError(this.snapshot.error)) patch.error = null;
    this._set(patch);
  }
}

let authService = null;

export function getSupabaseAuthService() {
  if (!authService) authService = new SupabaseAuthService();
  return authService;
}

export default getSupabaseAuthService;
