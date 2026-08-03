const operationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

export class DeviceIdentityService {
  constructor(client, { now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) throw new Error('DeviceIdentityService requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async register({ id, ownerId, displayName, platform = 'web' } = {}) {
    const deviceId = String(id || '').trim();
    const owner = String(ownerId || '').trim();
    const name = String(displayName || '').trim();
    if (!deviceId || !owner || !name) throw new TypeError('Device ID, owner ID, and display name are required.');
    const timestamp = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: operationId(`sync-device:${deviceId}`),
      label: 'sync-device-register',
      statements: [{
        sql: `INSERT INTO sync_devices(id,owner_id,display_name,platform,created_at,last_seen_at,retired_at)
              VALUES(?,?,?,?,?,?,NULL)
              ON CONFLICT(id) DO UPDATE SET
                owner_id=excluded.owner_id,display_name=excluded.display_name,
                platform=excluded.platform,last_seen_at=excluded.last_seen_at,retired_at=NULL`,
        bind: [deviceId, owner, name, String(platform || 'web'), timestamp, timestamp],
        result: 'changes',
      }],
    });
    return this.get(deviceId);
  }

  async get(id) {
    return this.client.query({
      sql: `SELECT id,owner_id AS ownerId,display_name AS displayName,platform,
                   created_at AS createdAt,last_seen_at AS lastSeenAt,retired_at AS retiredAt
            FROM sync_devices WHERE id=?`,
      bind: [String(id)],
      result: 'one',
    });
  }

  async getActive(ownerId = null) {
    const ownerClause = ownerId ? ' AND owner_id=?' : '';
    return this.client.query({
      sql: `SELECT id,owner_id AS ownerId,display_name AS displayName,platform,
                   created_at AS createdAt,last_seen_at AS lastSeenAt,retired_at AS retiredAt
            FROM sync_devices WHERE retired_at IS NULL${ownerClause}
            ORDER BY last_seen_at DESC,id LIMIT 1`,
      bind: ownerId ? [String(ownerId)] : [],
      result: 'one',
    });
  }

  async retire(id) {
    const timestamp = this.now().toISOString();
    await this.client.query({
      sql: 'UPDATE sync_devices SET retired_at=?,last_seen_at=? WHERE id=? AND retired_at IS NULL',
      bind: [timestamp, timestamp, String(id)],
      result: 'changes',
    });
    return this.get(id);
  }
}

export default DeviceIdentityService;
