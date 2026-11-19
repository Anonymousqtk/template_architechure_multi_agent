import { it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';

const browser=process.env.ORG_BROWSER_PATH;
it.skipIf(!browser)('ORG-002 authenticated browser integration on disposable PostgreSQL',async()=>{
  if(process.env.MIGRATION_TEST_BACKEND!=='true'||!process.env.DATABASE_URL)throw Error('Disposable test database required');
  if(!existsSync(browser!))throw Error('Browser executable not found');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const config={origin:'http://127.0.0.1',production:false,requireMfa:false,csrfSecret:'browser-test-secret-'.repeat(4)};
  const app=createApp({pool,config,rateLimit:500});
  const frontend=fileURLToPath(new URL('../../frontend/dist/',import.meta.url));
  app.use(express.static(frontend));app.use((_req,res)=>res.sendFile('index.html',{root:frontend}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();if(!address||typeof address==='string')throw Error('No listener');
  config.origin='http://127.0.0.1:'+address.port;
  try{
    const org=randomUUID(),admin=randomUUID(),manager=randomUUID(),root=randomUUID(),child=randomUUID(),hidden=randomUUID();
    const password='Disposable browser test password 7!';
    const hash=await hashPassword(password);
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,\'Browser Test Organization\')',[org]);
    const identities=[{id:admin,email:'browser-admin-'+org+'@example.test',role:'ADMIN'},{id:manager,email:'browser-manager-'+org+'@example.test',role:'MANAGER'}];
    for(const identity of identities){
      await pool.query('INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())',[identity.id,identity.email,'Browser '+identity.role,hash]);
      await pool.query('INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[randomUUID(),identity.id,org,identity.role]);
    }
    await pool.query('INSERT INTO departments(id,organization_id,code,name,manager_user_id) VALUES($1,$2,\'VISIBLE\',\'Visible Department\',$3),($4,$2,\'PRIVATE\',\'Private Department\',NULL)',[root,org,manager,hidden]);
    await pool.query('INSERT INTO departments(id,organization_id,parent_id,code,name) VALUES($1,$2,$3,\'NESTED\',\'Nested Team\')',[child,org,root]);
    await pool.query('INSERT INTO positions(id,organization_id,department_id,code,title) VALUES($1,$2,$3,\'SCOPED\',\'Scoped Position\'),($4,$2,$5,\'PRIVATE\',\'Private Position\')',[randomUUID(),org,child,randomUUID(),hidden]);
    const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
      const process=spawn(globalThis.process.execPath,['--experimental-websocket',fileURLToPath(new URL('./org-browser-driver.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let output='';process.stdout.on('data',d=>{output+=d;});process.stderr.on('data',d=>{output+=d;});process.on('error',reject);process.on('exit',code=>resolve({code,output}));
      process.stdin.end(JSON.stringify({browser,url:config.origin,password,identities,evidence:globalThis.process.env.ORG_BROWSER_EVIDENCE}));
    });
    expect(result.code,result.output).toBe(0);
    console.log(result.output.trim());
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
},90000);
