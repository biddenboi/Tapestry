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

function routineCandidate(entity: EntityRow): Candidate | null {
  const run = (entity.data?.run || entity.data) as Record<string, unknown>;
  if (!['active', 'paused'].includes(String(run.status || ''))) return null;
  const routineType = String(run.routineType || 'day');
  return {
    ownerId: entity.owner_id,
    dueKey: `routine:${entity.entity_id}:${String(run.startedAt || entity.updated_at)}`,
    title: routineType === 'night' ? 'Night routine ready' : 'Morning routine ready',
    body: 'Continue your routine in Tapestry.',
    url: `/?mobile=1&open=routine:${encodeURIComponent(entity.entity_id)}`,
    entityType: 'routine-run',
    entityId: entity.entity_id,
  };
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
        .in('entity_type', ['reminder', 'routine-run'])
        .is('deleted_at', null),
    ]);
    if (subscriptionsError || entitiesError) {
      return Response.json({ error: subscriptionsError?.message || entitiesError?.message }, { status: 500 });
    }
    const now = Date.now();
    const candidates = (entities as EntityRow[]).map((entity) => (
      entity.entity_type === 'reminder' ? reminderCandidate(entity, now) : routineCandidate(entity)
    )).filter((candidate): candidate is Candidate => Boolean(candidate));
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
          }), { TTL: 3600, urgency: 'normal' });
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
