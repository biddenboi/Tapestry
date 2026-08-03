import getSupabaseAuthService from './SupabaseAuthService.js';
import getSupabaseClient from './SupabaseClient.js';
import SupabaseSyncTransport from './SupabaseSyncTransport.js';
import {
  MOBILE_WORKING_SET_MANIFEST_TYPE,
  MOBILE_WORKING_SET_SCHEMA_VERSION,
  collectMobileReferenceRecords,
  publishMobileBootstrapData,
  synchronizeMobileReferenceData,
} from '../MobileReferenceSync.js';
import { setRemoteResourceResolver } from '@shared/resources/Resources.js';

function platformIdentity() {
  if (typeof navigator === 'undefined') return { platform: 'web', displayName: 'Tapestry web' };
  const mobile = navigator.userAgentData?.mobile
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const electron = /Electron/i.test(navigator.userAgent || '');
  if (electron) return { platform: 'desktop', displayName: 'Tapestry desktop' };
  if (mobile) return { platform: 'mobile-web', displayName: 'Tapestry mobile' };
  return { platform: 'web', displayName: 'Tapestry browser' };
}

function deviceUUID() {
  if (globalThis.crypto?.randomUUID) return `tapestry:${globalThis.crypto.randomUUID()}`;
  return `tapestry:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export class SupabaseSyncBootstrap {
  constructor(databaseConnection, {
    auth = getSupabaseAuthService(),
    client = getSupabaseClient(),
  } = {}) {
    if (!databaseConnection?.syncRuntime) throw new Error('Supabase sync requires the database connection.');
    this.databaseConnection = databaseConnection;
    this.runtime = databaseConnection.syncRuntime;
    this.auth = auth;
    this.client = client;
    this.unsubscribeAuth = null;
    this.applyPromise = Promise.resolve();
    this.sessionKey = null;
    this.platform = null;
  }

  async initialize() {
    await this.auth.initialize();
    if (!this.unsubscribeAuth) {
      this.unsubscribeAuth = this.auth.subscribe(() => this.queueSession(this.auth.getSnapshot()));
    }
    await this.queueSession(this.auth.getSnapshot());
    return this;
  }

  queueSession(snapshot) {
    const key = snapshot.session?.access_token || null;
    // Sync-state notifications are published through the same auth store as
    // session changes. Do not turn a failed configuration into a tight retry
    // loop; only a genuinely new session should reconfigure the transport.
    if (key === this.sessionKey) return this.applyPromise;
    this.sessionKey = key;
    this.applyPromise = this.applyPromise
      .catch(() => undefined)
      .then(() => this.applySession(snapshot));
    return this.applyPromise;
  }

  async applySession(snapshot) {
    const user = snapshot.session?.user;
    if (!this.client || !user?.id) {
      setRemoteResourceResolver(null);
      await this.runtime.configure({ transport: null });
      this.auth.setSyncState('local-only');
      return;
    }
    this.auth.setSyncState('connecting');
    try {
      const identity = platformIdentity();
      this.platform = identity.platform;
      const mobile = identity.platform === 'mobile-web';
      const existing = await this.runtime.devices.getActive(user.id);
      const device = existing || {
        id: deviceUUID(),
        ownerId: user.id,
        displayName: identity.displayName,
        platform: identity.platform,
      };
      const transport = new SupabaseSyncTransport({ client: this.client, ownerId: user.id });
      const hadLocalWorkspace = (await this.databaseConnection.getAll('players')).length > 0;
      this.runtime.setCheckpointPublishingEnabled(hadLocalWorkspace && !mobile);
      await this.runtime.configure({ transport, device });
      this.runtime.cancelScheduledSync?.();
      setRemoteResourceResolver(
        identity.platform === 'mobile-web'
          ? (resourceUUID) => transport.downloadMobileResource(resourceUUID)
          : null,
        { cacheLimitBytes: 25 * 1024 * 1024 },
      );
      this.runtime.afterSynchronize = async ({ reason = 'scheduled' } = {}) => {
        // Pull first so a reconnecting device cannot publish an older local
        // snapshot over a newer server record. Only records that were actually
        // mutated locally are uploaded from the durable reference outbox.
        const references = await synchronizeMobileReferenceData(
          this.databaseConnection,
          transport,
          {
            publishActiveProfile: false,
            forceActiveProfile: mobile,
            uploadReferences: false,
          },
        );
        if (!this.runtime.checkpointPublishingEnabled) {
          const durable = await this.runtime.flushReferenceOutbox();
          return {
            references,
            durable,
            seeded: false,
            checkpoint: {
              uploaded: false,
              reason: mobile ? 'mobile-checkpoint-disabled' : 'clean-device-restore-pending',
            },
          };
        }
        let seeded = false;
        if (!await this.runtime.isReferenceMirrorSeeded()) {
          const current = await collectMobileReferenceRecords(this.databaseConnection, {
            bootstrap: true,
            includeActiveProfile: false,
          });
          await this.runtime.queueReferenceSeed(current);
          await this.runtime.markReferenceMirrorSeeded({
            schemaVersion: MOBILE_WORKING_SET_SCHEMA_VERSION,
            recordCount: current.length,
            seededAt: new Date().toISOString(),
          });
          seeded = true;
        }
        const durable = await this.runtime.flushReferenceOutbox();
        const durabilityFlush = new Set([
          'background-durability-flush',
          'pagehide-durability-flush',
          'pre-export-durability-barrier',
        ]).has(reason);
        const checkpoint = await this.runtime.publishCloudCheckpoint({
          force: seeded || (durabilityFlush && this.runtime.checkpointDirty),
          reason: seeded ? 'reference-seed' : reason,
        }).catch((error) => ({
          uploaded: false,
          reason: 'checkpoint-failed',
          error: String(error?.message || error).slice(0, 500),
        }));
        return { references, durable, seeded, checkpoint };
      };

      // A full working-set replacement is only needed to seed a new private
      // sync account. Routine synchronization uses the operation log plus the
      // bounded reference set, so stale snapshots cannot resurrect deletions.
      await this.runtime.synchronize({ reason: 'supabase-session-configured' });
      if (!mobile) {
        const existing = await transport.getMobileReferenceRecords([
          'profile',
          MOBILE_WORKING_SET_MANIFEST_TYPE,
        ]);
        const profiles = existing.filter((record) => record?.recordType === 'profile');
        const manifest = existing
          .filter((record) => record?.recordType === MOBILE_WORKING_SET_MANIFEST_TYPE)
          .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
        const schemaVersion = Math.max(0, Number(manifest?.data?.schemaVersion) || 0);
        if (!profiles.length || schemaVersion < MOBILE_WORKING_SET_SCHEMA_VERSION) {
          try {
            await publishMobileBootstrapData(this.databaseConnection, transport);
          } catch (error) {
            console.warn(
              '[Tapestry] Initial mobile working-set publication was deferred; routine sync remains connected.',
              error,
            );
          }
        }
      }
      this.auth.setSyncState('ready');
    } catch (error) {
      setRemoteResourceResolver(null);
      this.platform = null;
      this.runtime.afterSynchronize = null;
      await this.runtime.configure({ transport: null });
      this.auth.setSyncState('error', error);
    }
  }
}

const bootstraps = new WeakMap();

export async function initializeSupabaseSync(databaseConnection) {
  let bootstrap = bootstraps.get(databaseConnection);
  if (!bootstrap) {
    bootstrap = new SupabaseSyncBootstrap(databaseConnection);
    bootstraps.set(databaseConnection, bootstrap);
  }
  return bootstrap.initialize();
}

export default initializeSupabaseSync;
