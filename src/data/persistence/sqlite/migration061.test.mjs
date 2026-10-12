import test from 'node:test';
import assert from 'node:assert/strict';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import MigrationRunner from './MigrationRunner.js';
import migrations from './migrations/index.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
test('R1 upgrades old rows, reopens cleanly, and rolls back an overwrite with its source change',async(t)=>{
 const client=new InProcessSqliteClient(); await client.initialize({mode:'memory'}); t.after(()=>client.close());
 await new MigrationRunner({client,migrations:migrations.filter(m=>m.id<'060')}).run();
 const docs=new SqliteDocumentRepository(client);
 await docs.put('todos',{UUID:'old',parent:'p',name:'Old todo'});
 await new MigrationRunner({client,migrations}).run(); await new MigrationRunner({client,migrations}).run();
 assert.equal((await docs.get('todos','old')).startDate,undefined);
 const row={UUID:'r1:seed:0',seq:1,payload:{ev:'add',id:'old',now:1,q:1,d:24},type:'add',at:1};
 await docs.put('r1Events',row);
 await assert.rejects(docs.commitBatch({operations:[{type:'put',store:'todos',record:{UUID:'old',name:'Should roll back'}},{type:'put',store:'r1Events',record:{...row,at:2}}]}),/append-only/);
 assert.equal((await docs.get('todos','old')).name,'Old todo');
 assert.deepEqual(await docs.getAll('r1Events'),[row]); assert.equal((await client.integrityCheck()).ok,true);
});
