import getSupabaseAuthService from './SupabaseAuthService.js';
import getSupabaseClient from './SupabaseClient.js';
import SupabaseSyncTransport from './SupabaseSyncTransport.js';
import {
  MOBILE_WORKING_SET_SCHEMA_VERSION,
  collectMobileReferenceRecords,
  publishCurrentMobileResources,
  synchronizeMobileReferenceData,
} from '../MobileReferenceSync.js';
import { setRemoteResourceResolver } from '@shared/resources/Resources.js';
import { detectMobileCompanion } from '@app/mobile/useMobileCompanion.js';

const RESOURCE_BEARING_REFERENCE_TYPES = Object.freeze([
  'profile',
  'shop-catalog',
  'journal',
  'chronicle-entry-metadata',
]);


function platformIdentity() {
  if (typeof navigator === 'undefined') return { platform: 'web', displayName: 'Tapestry web' };
  const electron = /Electron/i.test(navigator.userAgent || '');
  if (electron) return { platform: 'desktop', displayName: 'Tapestry desktop' };
  // Use the same decision as the presentation shell. User-agent sniffing alone
  // misses installed/iPad-class browsers and explicit ?mobile=1 clients,
  // leaving their private-cloud resource resolver disabled.
  const mobile = typeof window !== 'undefined'
    ? detectMobileCompanion(window)
    : navigator.userAgentData?.mobile
      || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
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
    // session changes. Only a genuinely new session should reconfigure the
    // transport; runtime retries remain inside SyncRuntime.
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
      const localPlayers = await this.databaseConnection.getAll('players');
      const hadLocalWorkspace = !this.databaseConnection.demoMode
        && localPlayers.some((player) => (
          player?.UUID && player.UUID !== 'demo-player' && !String(player.UUID).startsWith('demo-')
        ));
      const shouldStartRoutineSync = mobile || hadLocalWorkspace;

      this.runtime.setCheckpointPublishingEnabled(hadLocalWorkspace && !mobile);
      // A clean desktop/web device must download and restore the cloud SQLite
      // checkpoint before any routine sync can publish local state. Configure
      // the transport without auto-starting SyncRuntime; DataSourceGate owns
      // the restore and then starts the first synchronization explicitly.
      await this.runtime.configure({ transport, device, schedule: false });
      this.runtime.cancelScheduledSync?.();

      // Any authenticated client may encounter a valid cloud reference whose
      // bytes are absent from its local checkpoint. Resolve on demand on both
      // surfaces; desktop simply retains a larger rebuildable cache.
      setRemoteResourceResolver(
        (resourceUUID) => transport.downloadMobileResource(resourceUUID),
        { cacheLimitBytes: (mobile ? 25 : 100) * 1024 * 1024 },
      );

      this.runtime.afterSynchronize = async ({ reason = 'scheduled' } = {}) => {
        let seeded = false;
        if (
          this.runtime.checkpointPublishingEnabled
          && !await this.runtime.isReferenceMirrorSeeded(MOBILE_WORKING_SET_SCHEMA_VERSION)
        ) {
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

        // Publish immutable resource bytes only when a changed reference row
        // can point at them. This avoids rescanning profiles, journals, and the
        // catalog during unrelated sync passes while preserving byte-before-row
        // ordering. Mobile clients do not publish desktop resources.
        const pendingResourceReferences = this.runtime.checkpointPublishingEnabled
          ? await this.runtime.referenceOutbox.listPending({
              limit: 1,
              recordTypes: RESOURCE_BEARING_REFERENCE_TYPES,
            })
          : [];
        const resources = pendingResourceReferences.length
          ? await publishCurrentMobileResources(this.databaseConnection, transport)
          : { uploaded: 0, registered: 0 };

        // The durable outbox contains only changed records. Flush it before the
        // delta pull so the current device also observes the server-assigned
        // sequence/version for its own accepted writes.
        const durable = await this.runtime.flushReferenceOutbox();
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
          return {
            references,
            durable,
            resources,
            seeded: false,
            checkpoint: {
              uploaded: false,
              reason: mobile ? 'mobile-checkpoint-disabled' : 'clean-device-restore-pending',
            },
          };
        }

        // Full SQLite checkpoints are recovery artifacts, not part of normal
        // synchronization. They remain throttled and asynchronous.
        const checkpoint = {
          uploaded: false,
          reason: this.runtime.checkpointDirty || seeded
            ? 'checkpoint-scheduled'
            : 'checkpoint-clean',
        };
        if (this.runtime.checkpointDirty || seeded) {
          void this.runtime.publishCloudCheckpoint({
            force: seeded,
            reason: seeded ? 'reference-seed' : reason,
          }).catch((error) => {
            console.warn('[Tapestry] Cloud SQLite checkpoint upload was deferred.', error);
          });
        }
        return { references, durable, resources, seeded, checkpoint };
      };

      // Authentication/transport readiness is independent of synchronization.
      // A clean desktop/web device returns immediately so DataSourceGate can
      // download the cloud checkpoint. Existing workspaces and mobile clients
      // start routine sync after the transport and supplemental hooks exist.
      this.auth.setSyncState('ready');
      if (shouldStartRoutineSync) {
        this.runtime.scheduleSync('supabase-session-configured');
      }
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
