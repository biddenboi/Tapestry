import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
register('./test-alias-loader.mjs',import.meta.url);
const { buildR1Backfill } = await import('../src/data/persistence/services/R1Backfill.js');
const { eventRecords } = await import('../src/data/persistence/services/R1EventService.js');
const { default:migrations }=await import('../src/data/persistence/sqlite/migrations/index.js');
const { calculateMigrationChecksum }=await import('../src/data/persistence/sqlite/migrationChecksum.js');
export async function backfillFile(path,{apply=false,now=new Date()}={}) {
 const db=new DatabaseSync(path,{readOnly:!apply});
 try {
 const hasEvents=db.prepare("SELECT name FROM sqlite_schema WHERE name='document_r1_events'").get();
 if(hasEvents && db.prepare('SELECT COUNT(*) AS n FROM document_r1_events').get().n) return {skipped:true,reason:'R1 event store already has events; nothing written.'};
 const read=(table)=>db.prepare(`SELECT record_json FROM ${table}`).all().map(r=>JSON.parse(r.record_json));
 const {events,summary}=buildR1Backfill(read('document_tasks'),read('document_todos'),now);
 if(!apply) return {...summary,events:events.length,dryRun:true};
 db.exec('BEGIN IMMEDIATE');
 try {
 // Apply the same checksummed migrations to the copy before writing small records.
 for(const migration of migrations) {
  if(await calculateMigrationChecksum(migration)!==migration.checksum) throw new Error(`Invalid migration manifest: ${migration.id}`);
  const prior=db.prepare('SELECT checksum,outcome FROM schema_migrations WHERE migration_id=?').get(migration.id);
  if(prior && prior.checksum!==migration.checksum && !migration.compatibleChecksums?.includes(prior.checksum)) throw new Error(`Migration checksum mismatch: ${migration.id}`);
  if(prior?.outcome==='applied') continue;
  for(const repair of migration.compatibilityRepairs||[]) {
   const row=db.prepare("SELECT checksum FROM schema_migrations WHERE migration_id=? AND outcome='applied'").get(repair.migrationId);
   if(repair.checksums.includes(row?.checksum)) db.exec(repair.sql);
  }
  db.exec(migration.sql);
  db.prepare("INSERT OR REPLACE INTO schema_migrations(migration_id,checksum,started_at,finished_at,source_application_version,outcome) VALUES(?,?,?,?,?,'applied')").run(migration.id,migration.checksum,now.toISOString(),now.toISOString(),'r1-backfill');
 }
 const insert=db.prepare('INSERT INTO document_r1_events(uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence) VALUES(?,?,NULL,?,NULL,NULL,?,?)');
 const records=eventRecords(events,{sourceKey:'history-backfill-v1',at:now.toISOString()});
 for(const record of records) insert.run(record.UUID,JSON.stringify(record),record.createdAt,record.UUID,record.seq);
 db.exec('COMMIT');
 return {...summary,events:events.length,dryRun:false};
 } catch(error) { db.exec('ROLLBACK'); throw error; }
 } finally {db.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const args=process.argv.slice(2); const path=args.find(a=>!a.startsWith('--'));
 if(!path) { console.error('Usage: node scripts/r1-backfill.mjs /absolute/path/to/COPY.sqlite [--apply]'); process.exitCode=1; }
 else { try {console.log(JSON.stringify(await backfillFile(resolve(path),{apply:args.includes('--apply')}),null,2));} catch(e) {console.error(e.message);process.exitCode=1;} }
}
