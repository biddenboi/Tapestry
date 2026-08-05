import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import webpush from 'npm:web-push@3.6.7';

type SubscriptionRow = {
  owner_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

type EntityRow = {
  owner_id: string;
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
  updated_at: string;
};

type Candidate = {
  ownerId: string;
  dueKey: string;
  title: string;
  body: string;
  url: string;
  entityType: string;
  entityId: string;
};

function dateValue(value: unknown): number | null {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function reminderCandidate(entity: EntityRow, now: number): Candidate | null {
  const reminder = (entity.data?.reminder || entity.data) as Record<string, unknown>;
  if (reminder.completedAt || reminder.dismissedAt || reminder.archivedAt) return null;
  const dueAt = dateValue(reminder.snoozedUntil)
    ?? dateValue(reminder.remindAt)
    ?? dateValue(reminder.dueAt);
  if (dueAt == null || dueAt > now) return null;
  const name = String(reminder.name || reminder.title || 'Reminder');
  return {
    ownerId: entity.owner_id,
    dueKey: `reminder:${entity.entity_id}:${new Date(dueAt).toISOString()}`,
    title: 'Reminder due',
    body: name,
    url: `/?mobile=1&open=reminder:${encodeURIComponent(entity.entity_id)}`,
    entityType: 'reminder',
    entityId: entity.entity_id,
  };
}

function matchCandidate(entity: EntityRow, now: number): Candidate | null {
  const match = (entity.data?.match || entity.data) as Record<string, unknown>;
  const status = String(match.status || '');
  if (!['pending', 'active'].includes(status)) return null;
  const changedAt = dateValue(entity.updated_at) ?? dateValue(match.updatedAt);
  if (changedAt == null || now - changedAt > 20 * 60_000) return null;
  const phase = String(match.phase || (status === 'active' ? 'work' : 'ready'));
  const score = match.scores && typeof match.scores === 'object'
    ? Object.values(match.scores as Record<string, unknown>).map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
    : null;
  return {
    ownerId: entity.owner_id,
    dueKey: `match:${entity.entity_id}:${entity.updated_at}`,
    title: status === 'active' ? 'Match updated' : 'Match ready check',
    body: score == null ? `Shared Match phase: ${phase}.` : `${score.toLocaleString()} total points · ${phase}.`,
    url: `/?mobile=1&open=match:${encodeURIComponent(entity.entity_id)}`,
    entityType: 'match',
    entityId: entity.entity_id,
  };
}

function taskRecommendationCandidates(entities: EntityRow[], now: number): Candidate[] {
  const hourKey = new Date(now).toISOString().slice(0, 13);
  const byOwner = new Map<string, Array<{ entity: EntityRow; task: Record<string, unknown>; dueAt: number }>>();
  for (const entity of entities.filter(({ entity_type }) => entity_type === 'task')) {
    const task = (entity.data?.task || entity.data) as Record<string, unknown>;
    if (task.completedAt || task.archivedAt || task.deletedAt) continue;
    const dueAt = dateValue(task.dueDate) ?? dateValue(task.dueAt);
    if (dueAt == null || dueAt > now + 60 * 60_000) continue;
    const rows = byOwner.get(entity.owner_id) || [];
    rows.push({ entity, task, dueAt });
    byOwner.set(entity.owner_id, rows);
  }
  return [...byOwner.entries()].map(([ownerId, rows]) => {
    rows.sort((left, right) => left.dueAt - right.dueAt);
    const { entity, task, dueAt } = rows[0];
    return {
      ownerId,
      dueKey: `task-recommendation:${ownerId}:${hourKey}`,
      title: dueAt < now ? 'A task needs attention' : 'Task recommendation',
      body: String(task.name || task.title || 'Open Tapestry for the next task.'),
      url: `/?mobile=1&open=task:${encodeURIComponent(entity.entity_id)}`,
      entityType: 'task',
      entityId: entity.entity_id,
    };
  });
}

async function endpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request) {
    const cronSecret = Deno.env.get('TAPESTRY_PUSH_CRON_SECRET') || '';
    if (!cronSecret || request.headers.get('x-tapestry-cron-secret') !== cronSecret) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = Deno.env.get('TAPESTRY_VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('TAPESTRY_VAPID_PRIVATE_KEY');
    if (!url || !serviceKey || !publicKey || !privateKey) {
      return Response.json({ error: 'push-not-configured' }, { status: 503 });
    }
    webpush.setVapidDetails('mailto:yujinpetercho@gmail.com', publicKey, privateKey);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const [{ data: subscriptions, error: subscriptionsError }, { data: entities, error: entitiesError }] = await Promise.all([
      supabase.from('web_push_subscriptions').select('owner_id,endpoint,p256dh,auth_secret'),
      supabase.from('sync_entities')
        .select('owner_id,entity_type,entity_id,data,updated_at')
        .in('entity_type', ['reminder', 'match', 'task'])
        .is('deleted_at', null),
    ]);
    if (subscriptionsError || entitiesError) {
      return Response.json({ error: subscriptionsError?.message || entitiesError?.message }, { status: 500 });
    }
    const now = Date.now();
    const entityRows = entities as EntityRow[];
    const candidates = [
      ...entityRows.map((entity) => {
        if (entity.entity_type === 'reminder') return reminderCandidate(entity, now);
        if (entity.entity_type === 'match') return matchCandidate(entity, now);
        return null;
      }).filter((candidate): candidate is Candidate => Boolean(candidate)),
      ...taskRecommendationCandidates(entityRows, now),
    ];
    let delivered = 0;
    let skipped = 0;
    let failed = 0;
    for (const subscription of subscriptions as SubscriptionRow[]) {
      const hash = await endpointHash(subscription.endpoint);
      for (const candidate of candidates.filter(({ ownerId }) => ownerId === subscription.owner_id)) {
        const { data: receipt } = await supabase.from('web_push_delivery_receipts')
          .select('delivered_at')
          .eq('owner_id', subscription.owner_id)
          .eq('endpoint_hash', hash)
          .eq('due_key', candidate.dueKey)
          .maybeSingle();
        if (receipt) {
          skipped += 1;
          continue;
        }
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
          }, JSON.stringify({
            title: candidate.title,
            body: candidate.body,
            url: candidate.url,
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            badgeCount: candidates.filter(({ ownerId }) => ownerId === candidate.ownerId).length,
            tag: candidate.dueKey,
          }), { TTL: candidate.entityType === 'match' ? 300 : 3600, urgency: candidate.entityType === 'match' ? 'high' : 'normal' });
          await supabase.from('web_push_delivery_receipts').insert({
            owner_id: subscription.owner_id,
            endpoint_hash: hash,
            due_key: candidate.dueKey,
          });
          await supabase.from('web_push_subscriptions').update({
            last_success_at: new Date().toISOString(), failure_count: 0,
          }).eq('owner_id', subscription.owner_id).eq('endpoint', subscription.endpoint);
          delivered += 1;
        } catch (error) {
          const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
          if ([404, 410].includes(statusCode)) {
            await supabase.from('web_push_subscriptions').delete()
              .eq('owner_id', subscription.owner_id).eq('endpoint', subscription.endpoint);
          } else {
            await supabase.rpc('increment_web_push_failure', {
              p_owner_id: subscription.owner_id,
              p_endpoint: subscription.endpoint,
            });
          }
          failed += 1;
        }
      }
    }
    await supabase.rpc('prune_web_push_delivery_receipts');
    return Response.json({ delivered, skipped, failed, candidates: candidates.length });
  },
};
