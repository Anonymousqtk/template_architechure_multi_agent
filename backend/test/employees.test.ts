import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
if(process.env.MIGRATION_TEST_BACKEND!=='true'||!process.env.DATABASE_URL)throw Error('Disposable PostgreSQL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const origin='http://localhost:3000',password='Employee integration test password 7!';
let server:Server,base:string,hash:string,org:string,otherOrg:string,adminId:string,hrId:string,managerId:string,userId:string,outsiderId:string,department:string,outsideDepartment:string,position:string,today:string;
class Client{
 cookies=new Map<string,string>();csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+path,{method,headers:{Cookie:[...this.cookies.values()].join('; '),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0];this.cookies.set(pair.split('=')[0],pair);}
  const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};
 }
 async login(email:string){this.csrf=(await this.call('/api/auth/csrf')).body.csrfToken;expect((await this.call('/api/auth/login','POST',{email,password})).status).toBe(200);return this;}
}
async function actor(role:string){return new Client().login(role+'@employee.test');}
async function user(email:string,role:string,tenant=org){const id=randomUUID();await pool.query('INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$2,$3,now())',[id,email,hash]);await pool.query('INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[randomUUID(),id,tenant,role]);return id;}
const path=()=>'/api/organizations/'+org+'/employees';
async function create(client:Client,extra:Record<string,unknown>={}){return client.call(path(),'POST',{employeeCode:'E-'+randomUUID().slice(0,8),fullName:'Test Employee',hireDate:'2020-01-01',birthDate:'1990-01-01',phone:'0987654321',personalEmail:'private@employee.test',address:'Private test address',...extra});}
async function detail(client:Client,id:string){return (await client.call(path()+'/'+id)).body.employee;}
beforeAll(async()=>{hash=await hashPassword(password);const app=createApp({pool,config:{origin,production:false,requireMfa:false,csrfSecret:'employee-tests-only-'.repeat(4)},rateLimit:1000});server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();if(!a||typeof a==='string')throw Error('No server');base='http://127.0.0.1:'+a.port;},30000);
beforeEach(async()=>{
 await pool.query('TRUNCATE organizations,users,memberships,departments,positions,user_sessions,invitations,auth_audit_events,auth_rate_limits CASCADE');
 org=randomUUID();otherOrg=randomUUID();department=randomUUID();outsideDepartment=randomUUID();position=randomUUID();
 await pool.query('INSERT INTO organizations(id,name) VALUES($1,\'Employees\'),($2,\'Other\')',[org,otherOrg]);
 adminId=await user('admin@employee.test','ADMIN');hrId=await user('hr@employee.test','HR');managerId=await user('manager@employee.test','MANAGER');userId=await user('employee@employee.test','EMPLOYEE');outsiderId=await user('outsider@employee.test','EMPLOYEE');
 await pool.query('INSERT INTO departments(id,organization_id,code,name,manager_user_id) VALUES($1,$2,\'TEAM\',\'Managed Team\',$3),($4,$2,\'OTHER\',\'Other Team\',NULL)',[department,org,managerId,outsideDepartment]);
 await pool.query('INSERT INTO positions(id,organization_id,department_id,code,title) VALUES($1,$2,$3,\'DEV\',\'Developer\')',[position,org,department]);
 await pool.query('UPDATE memberships SET department_id=$1,position_id=$2,manager_user_id=$3 WHERE organization_id=$4 AND user_id=$5',[department,position,managerId,org,userId]);
 today=(await pool.query('SELECT CURRENT_DATE::text AS today')).rows[0].today;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();});
describe('EMP-001 profiles and EMP-002 contracts/history',()=>{
 it('creates independent and account-linked profiles; validates dates, duplicate codes/accounts and mass assignment',async()=>{
  const admin=await actor('admin'),hr=await actor('hr');
  const r=await create(hr,{employeeCode:'EMP-001'});expect(r.status).toBe(201);
  expect((await detail(hr,r.body.id)).userId).toBeNull();
  expect((await create(admin,{employeeCode:'emp-001'})).status).toBe(409);
  const linked=await create(admin,{userId});expect(linked.status).toBe(201);
  const d=await detail(admin,linked.body.id);expect(d).toMatchObject({userId,departmentId:department,positionId:position,managerUserId:managerId});
  expect((await create(admin,{userId})).status).toBe(409);
  expect((await create(hr,{userId:adminId})).status).toBe(403);
  expect((await create(admin,{hireDate:'2025-02-30'})).status).toBe(400);
  expect((await create(admin,{birthDate:'2021-01-01'})).status).toBe(400);
  expect((await create(admin,{role:'ADMIN'})).status).toBe(400);
  expect((await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND organization_id=$2',[userId,org])).rows[0].role).toBe('EMPLOYEE');
 });
 it('enforces tenant, Manager basic-data scope, HR target limits and Employee self access',async()=>{
  const admin=await actor('admin'),hr=await actor('hr'),manager=await actor('manager'),self=await actor('employee');
  const own=(await create(admin,{userId})).body.id;
  const outside=(await create(admin,{userId:outsiderId})).body.id;
  const standalone=(await create(admin,{departmentId:department})).body.id;
  const adminProfile=(await create(admin,{userId:adminId})).body.id;
  const list=await manager.call(path());expect(list.body.items.map((e:{id:string})=>e.id).sort()).toEqual([own,standalone].sort());
  expect(JSON.stringify(list.body)).not.toContain('0987654321');
  const visible=await detail(manager,own);expect(visible).not.toHaveProperty('birthDate');expect(visible).not.toHaveProperty('personalEmail');expect(visible.canEdit).toBe(false);
  expect((await manager.call(path()+'/'+outside)).status).toBe(404);
  expect((await manager.call(path()+'/'+own+'/contracts')).status).toBe(403);
  expect((await manager.call(path()+'/'+own,'PATCH',{version:visible.version,fullName:'Escalated'})).status).toBe(403);
  expect((await self.call(path())).body.items.map((e:{id:string})=>e.id)).toEqual([own]);
  expect((await detail(self,own)).phone).toBe('0987654321');
  expect((await self.call(path()+'/'+outside)).status).toBe(404);
  expect((await hr.call(path()+'/'+adminProfile)).status).toBe(404);
  expect((await admin.call('/api/organizations/'+otherOrg+'/employees/'+own)).status).toBe(403);
  expect((await new Client().call(path())).status).toBe(401);
 });
 it('links only an unlinked profile to an active tenant account and never creates accounts',async()=>{
  const admin=await actor('admin'),hr=await actor('hr');const id=(await create(hr)).body.id;
  expect((await hr.call(path()+'/'+id+'/account','POST',{version:1,userId})).status).toBe(403);
  expect((await admin.call(path()+'/'+id+'/account','POST',{version:1,userId})).status).toBe(204);
  expect((await detail(admin,id)).departmentId).toBe(department);
  expect((await admin.call(path()+'/'+id+'/account','POST',{version:2,userId:outsiderId})).status).toBe(409);
  expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(5);
 });
 it('rejects stale concurrent profile updates and keeps personal values out of audit metadata',async()=>{
  const admin=await actor('admin'),id=(await create(admin)).body.id;
  const results=await Promise.all([admin.call(path()+'/'+id,'PATCH',{version:1,phone:'0111111111'}),admin.call(path()+'/'+id,'PATCH',{version:1,address:'Another private address'})]);
  expect(results.map(r=>r.status).sort()).toEqual([204,409]);
  const events=await pool.query("SELECT metadata FROM auth_audit_events WHERE event_type LIKE 'EMPLOYEE_%'");
  expect(JSON.stringify(events.rows)).not.toContain('0111111111');expect(JSON.stringify(events.rows)).not.toContain('Another private address');
 });
 it('records transfers atomically and captures legacy assignment changes with preserved snapshots',async()=>{
  const admin=await actor('admin'),id=(await create(admin,{userId})).body.id;
  expect((await admin.call(path()+'/'+id+'/work-history')).body.items).toHaveLength(1);
  expect((await admin.call(path()+'/'+id+'/work-history','POST',{version:1,effectiveOn:today,reason:'Transfer to other unit',departmentId:outsideDepartment,positionId:null,managerUserId:managerId})).status).toBe(204);
  expect((await pool.query('SELECT department_id FROM memberships WHERE organization_id=$1 AND user_id=$2',[org,userId])).rows[0].department_id).toBe(outsideDepartment);
  expect((await admin.call(`/api/organizations/${org}/users/${userId}/assignment`,'POST',{departmentId:department,positionId:position})).status).toBe(204);
  const d=await detail(admin,id);expect(d.departmentId).toBe(department);expect(d.version).toBe(3);
  const history=await admin.call(path()+'/'+id+'/work-history');expect(history.body.items).toHaveLength(3);expect(history.body.items.map((h:{departmentName:string})=>h.departmentName)).toContain('Other Team');
  await pool.query('UPDATE departments SET name=\'Renamed\' WHERE id=$1',[outsideDepartment]);
  expect((await admin.call(path()+'/'+id+'/work-history')).body.items.map((h:{departmentName:string})=>h.departmentName)).toContain('Other Team');
  await expect(pool.query('DELETE FROM employee_work_history WHERE employee_id=$1',[id])).rejects.toMatchObject({code:'23514'});
  expect((await admin.call(path()+'/'+id+'/work-history','POST',{version:3,effectiveOn:'2021-01-01',reason:'Backdate',departmentId:null,positionId:null,managerUserId:null})).status).toBe(400);
 });
 it('blocks invalid assignment parents, reporting cycles, HR manager changes and referenced-unit deletion',async()=>{
  const admin=await actor('admin'),hr=await actor('hr');const id=(await create(admin,{userId})).body.id;
  expect((await hr.call(path()+'/'+id+'/work-history','POST',{version:1,effectiveOn:today,reason:'Change',departmentId:outsideDepartment,positionId:null,managerUserId:null})).status).toBe(403);
  expect((await admin.call(path()+'/'+id+'/work-history','POST',{version:1,effectiveOn:today,reason:'Mismatch',departmentId:outsideDepartment,positionId:position,managerUserId:managerId})).status).toBe(400);
  expect((await create(admin,{departmentId:randomUUID()})).status).toBe(400);
  expect((await admin.call(path()+'/'+id+'/work-history','POST',{version:1,effectiveOn:today,reason:'Move',departmentId:outsideDepartment,positionId:null,managerUserId:managerId})).status).toBe(204);
  expect((await admin.call(`/api/organizations/${org}/positions/${position}`,'DELETE',{})).status).toBe(409);
 });
 it('validates contract dates and signatures; activates, locks material fields and terminates without changing RBAC',async()=>{
  const admin=await actor('admin'),self=await actor('employee');const id=(await create(admin,{userId})).body.id,contracts=path()+'/'+id+'/contracts';
  expect((await admin.call(contracts,'POST',{contractNumber:'BAD',contractType:'FIXED_TERM',startDate:today,endDate:null})).status).toBe(400);
  const c=await admin.call(contracts,'POST',{contractNumber:'HĐLĐ-001',contractType:'INDEFINITE',startDate:today,endDate:null});expect(c.status).toBe(201);
  expect((await admin.call(contracts+'/'+c.body.id,'PATCH',{version:1,status:'ACTIVE'})).status).toBe(400);
  expect((await admin.call(contracts+'/'+c.body.id,'PATCH',{version:1,signedOn:today,status:'ACTIVE'})).status).toBe(204);
  expect((await self.call(contracts)).status).toBe(200);
  expect((await self.call(contracts+'/'+c.body.id,'PATCH',{version:2,notes:'Tamper'})).status).toBe(403);
  expect((await admin.call(contracts+'/'+c.body.id,'PATCH',{version:2,notes:'Changed'})).status).toBe(409);
  expect((await admin.call(contracts+'/'+c.body.id,'PATCH',{version:2,status:'TERMINATED',terminationDate:today})).status).toBe(204);
  expect((await admin.call(contracts+'/'+c.body.id,'PATCH',{version:3,status:'DRAFT'})).status).toBe(409);
  expect((await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND organization_id=$2',[userId,org])).rows[0].role).toBe('EMPLOYEE');
  await expect(pool.query('UPDATE employee_contracts SET notes=\'tamper\' WHERE id=$1',[c.body.id])).rejects.toMatchObject({code:'23514'});
 });
 it('serializes simultaneous contract activations and supports historical expired contracts',async()=>{
  const admin=await actor('admin'),id=(await create(admin)).body.id,contracts=path()+'/'+id+'/contracts';
  const body={contractType:'INDEFINITE',startDate:today,endDate:null,signedOn:today};
  const a=(await admin.call(contracts,'POST',{...body,contractNumber:'C-A'})).body.id,b=(await admin.call(contracts,'POST',{...body,contractNumber:'C-B'})).body.id;
  const results=await Promise.all([admin.call(contracts+'/'+a,'PATCH',{version:1,status:'ACTIVE'}),admin.call(contracts+'/'+b,'PATCH',{version:1,status:'ACTIVE'})]);expect(results.map(r=>r.status).sort()).toEqual([204,409]);
  const old=(await admin.call(contracts,'POST',{contractNumber:'HISTORICAL',contractType:'FIXED_TERM',startDate:'2020-01-01',endDate:'2020-12-31',signedOn:'2020-01-01'})).body.id;
  expect((await admin.call(contracts+'/'+old,'PATCH',{version:1,status:'EXPIRED'})).status).toBe(204);
  expect((await admin.call(contracts,'POST',{...body,contractNumber:'c-a'})).status).toBe(409);
 });
 it('enforces composite employee and contract foreign keys across tenants',async()=>{
  const admin=await actor('admin'),id=(await create(admin)).body.id;
  await expect(pool.query('INSERT INTO employee_contracts(id,organization_id,employee_id,contract_number,contract_type,start_date) VALUES($1,$2,$3,\'X\',\'INDEFINITE\',CURRENT_DATE)',[randomUUID(),otherOrg,id])).rejects.toMatchObject({code:'23503'});
  await expect(pool.query('UPDATE employees SET organization_id=$1,department_id=$2 WHERE id=$3',[otherOrg,department,id])).rejects.toMatchObject({code:'23503'});
 });
});
