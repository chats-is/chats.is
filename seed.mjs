import { Pool } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const cols = await p.query("select column_name from information_schema.columns where table_name='quota' order by 1");
console.log('quota 列:', cols.rows.map(r => r.column_name).join(' '));
const uid = randomUUID();
await p.query('insert into "user"(id,name,email,email_verified,role) values($1,$2,$3,false,$4)',
  [uid, 'VTest User', 'vtest-' + Date.now() + '@example.com', 'user']);
console.log('user:', uid);
await p.end();
