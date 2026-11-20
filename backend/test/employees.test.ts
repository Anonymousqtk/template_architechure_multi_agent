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

describe('ATT-001 attendance, scheduling and leave', () => {
 const att = () => '/api/organizations/' + org + '/attendance';
 const period = '?from=2020-01-01&to=2020-02-01';
 const shift = {
   name: 'Night', timeZone: 'Asia/Bangkok', startTime: '22:00', endTime: '06:00',
   earlyCheckIn: 15, lateGrace: null, earlyGrace: null, overtimeAfter: null, active: true,
 };
 const reason = 'Test policy decision';
 let employee: string;
 beforeEach(async () => {
   const admin = await actor('admin');
   const created = await create(admin, { userId });
   expect(created.status).toBe(201);
   employee = created.body.id;
 });

 it('supports office in/out without assigning a shift and preserves punches after policy changes', async () => {
   const admin=await actor('admin'), worker=await actor('employee'), outsider=await actor('outsider');
   const policy={mode:'OFFICE',timeZone:'UTC',startTime:'00:00',endTime:'23:59',weekdays:[0,1,2,3,4,5,6]};
   const url=att()+'/departments/'+department+'/policy';
   expect((await worker.call(url,'PUT',policy)).status).toBe(403);
   expect((await admin.call(url,'PUT',{...policy,weekdays:[]})).status).toBe(400);
   expect((await admin.call(url,'PUT',{...policy,timeZone:'Invalid/Zone'})).status).toBe(400);
   expect((await admin.call(att()+'/departments/'+randomUUID()+'/policy','PUT',policy)).status).toBe(404);
   expect((await admin.call(url,'PUT',policy)).status).toBe(204);
   const currentDay=(await pool.query("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
   const ledgerUrl=att()+'/employees/'+employee+'/ledger?from='+currentDay+'&to='+currentDay;
   const ledger=await worker.call(ledgerUrl);
   expect(ledger.status,JSON.stringify(ledger.body)).toBe(200);
   expect(ledger.body.schedule).toHaveLength(1);
   expect(ledger.body.schedule[0]).toMatchObject({attendanceKind:'OFFICE',shiftId:null,virtual:true,status:'SCHEDULED'});
   expect((await pool.query('SELECT count(*)::int AS n FROM work_schedule')).rows[0].n).toBe(0);
   const punch=att()+'/employees/'+employee+'/office-punch';
   expect((await outsider.call(punch,'POST',{action:'IN',workDate:currentDay})).status).toBe(404);
   expect((await worker.call(punch,'POST',{action:'IN',workDate:currentDay,at:new Date().toISOString()})).status).toBe(400);
   const concurrent=await Promise.all([worker.call(punch,'POST',{action:'IN',workDate:currentDay}),worker.call(punch,'POST',{action:'IN',workDate:currentDay})]);
   expect(concurrent.map(r=>r.status).sort()).toEqual([200,409]);
   const recorded=(await worker.call(ledgerUrl)).body.schedule[0];
   expect(recorded).toMatchObject({attendanceKind:'OFFICE',virtual:false,status:'IN_PROGRESS',canCheckOut:true});
   expect((await admin.call(url,'PUT',{...policy,mode:'SHIFT'})).status).toBe(204);
   expect((await worker.call(att()+'/punches/'+recorded.id,'POST',{action:'OUT'})).status).toBe(200);
   expect((await worker.call(ledgerUrl)).body.schedule[0]).toMatchObject({status:'COMPLETE',attendanceKind:'OFFICE'});
 });

 it('respects office weekdays, explicit days off, leave and office correction review', async () => {
   const admin=await actor('admin'),worker=await actor('employee'),manager=await actor('manager');
   const policy={mode:'OFFICE',timeZone:'UTC',startTime:'00:00',endTime:'23:59',weekdays:[0,1,2,3,4,5,6]};
   const url=att()+'/departments/'+department+'/policy';
   expect((await admin.call(url,'PUT',policy)).status).toBe(204);
   const currentDay=(await pool.query("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
   await pool.query("UPDATE departments SET office_since='2020-01-01' WHERE id=$1",[department]);
   const past=(await worker.call(att()+'/employees/'+employee+'/ledger?from=2020-01-13&to=2020-01-13')).body.schedule[0];
   const correction=await worker.call(att()+'/corrections/'+past.id,'POST',{employeeId:employee,workDate:'2020-01-13',checkedInAt:'2020-01-13T08:00:00Z',checkedOutAt:'2020-01-13T17:00:00Z',reason});
   expect(correction.status,JSON.stringify(correction.body)).toBe(201);
   expect((await manager.call(att()+'/corrections/'+correction.body.id+'/review','POST',{action:'APPROVE',reason})).status).toBe(204);
   const future='2099-01-12';
   const shiftId=(await admin.call(att()+'/shifts/new','PUT',shift)).body.id;
   expect((await admin.call(att()+'/employees/'+employee+'/schedule/new','PUT',{kind:'SHIFT',shiftId,workDate:future})).body.code).toBe('ATT_OFFICE_NO_SHIFT');
   expect((await admin.call(att()+'/employees/'+employee+'/schedule/new','PUT',{kind:'OFF',workDate:future,timeZone:'UTC'})).status).toBe(201);
   const off=(await worker.call(att()+'/employees/'+employee+'/ledger?from='+future+'&to='+future)).body.schedule;
   expect(off).toHaveLength(1);expect(off[0].status).toBe('OFF');
   const lt=(await admin.call(att()+'/leave-types/new','PUT',{name:'Office leave',tracksBalance:false,active:true})).body.id;
   const leave=await worker.call(att()+'/employees/'+employee+'/leave','POST',{leaveTypeId:lt,startsAt:currentDay+'T00:00:00Z',endsAt:currentDay+'T23:59:00Z',reason});
   expect(leave.status).toBe(201);
   expect((await manager.call(att()+'/leave/'+leave.body.id+'/review','POST',{action:'APPROVE',reason})).status).toBe(204);
   expect((await worker.call(att()+'/employees/'+employee+'/office-punch','POST',{action:'IN',workDate:currentDay})).body.code).toBe('ATT_LEAVE_CONFLICT');
   // Change weekdays in SQL to isolate projection from policy-save historical snapshots.
   await pool.query('UPDATE departments SET office_days=ARRAY[0] WHERE id=$1',[department]);
   expect((await worker.call(att()+'/employees/'+employee+'/ledger?from=2099-01-13&to=2099-01-13')).body.schedule).toHaveLength(0);
 });

 it('resolves overnight shifts, protects calendar intervals and handles daylight saving gaps and folds', async () => {
   const admin = await actor('admin');
   const shiftResponse = await admin.call(att() + '/shifts/new', 'PUT', shift);
   expect(shiftResponse.status).toBe(201);
   const assign = att() + '/employees/' + employee + '/schedule/new';
   const overnight = await admin.call(assign, 'PUT', { kind: 'SHIFT', shiftId: shiftResponse.body.id, workDate: '2099-01-10' });
   expect(overnight.status, JSON.stringify(overnight.body)).toBe(201);
   const ledger = await admin.call(att() + '/employees/' + employee + '/ledger?from=2099-01-10&to=2099-01-11');
   expect(ledger.status, JSON.stringify(ledger.body)).toBe(200);
   expect(ledger.body.schedule[0]).toMatchObject({
     startsAt: '2099-01-10T15:00:00.000Z', endsAt: '2099-01-10T23:00:00.000Z',
     late: null, leftEarly: null, overtimeMinutes: null, status: 'SCHEDULED',
   });
   expect((await admin.call(assign, 'PUT', { kind: 'OFF', workDate: '2099-01-11', timeZone: shift.timeZone })).body.code).toBe('ATT_SCHEDULE_CONFLICT');
   expect((await admin.call(att() + '/employees/' + employee + '/schedule/' + overnight.body.id, 'DELETE', {})).status).toBe(204);
   expect((await admin.call(assign, 'PUT', { kind: 'OFF', workDate: '2099-01-11', timeZone: shift.timeZone })).status).toBe(201);

   const zone = 'America/New_York';
   const foldShift = (await admin.call(att() + '/shifts/new', 'PUT', { ...shift, name: 'Fold', timeZone: zone, startTime: '01:30', endTime: '03:00' })).body.id;
   const gapShift = (await admin.call(att() + '/shifts/new', 'PUT', { ...shift, name: 'Gap', timeZone: zone, startTime: '02:30', endTime: '04:00' })).body.id;
   expect((await admin.call(assign, 'PUT', { kind: 'SHIFT', shiftId: gapShift, workDate: '2099-03-08' })).body.code).toBe('ATT_AMBIGUOUS_SCHEDULE');
   expect((await admin.call(assign, 'PUT', { kind: 'SHIFT', shiftId: foldShift, workDate: '2099-11-01' })).body.code).toBe('ATT_AMBIGUOUS_SCHEDULE');
   expect((await admin.call(assign, 'PUT', { kind: 'SHIFT', shiftId: foldShift, workDate: '2099-11-01',
     startsAt: '2099-11-01T01:30:00-04:00' })).status).toBe(201);
 });

 it('serializes check-in, rejects forged timestamps and preserves raw punches after adjustment', async () => {
   const admin = await actor('admin'), worker = await actor('employee'), manager = await actor('manager'), outsider = await actor('outsider');
   const shiftId = (await admin.call(att() + '/shifts/new', 'PUT', shift)).body.id;
   const schedule = randomUUID();
   await pool.query(`INSERT INTO work_schedule(id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace)
     VALUES($1,$2,$3,$4,'Fixture','2020-01-12','UTC',now()-interval '1 hour',now()+interval '1 hour',0,0)`,
   [schedule, org, employee, shiftId]);
   const punch = att() + '/punches/' + schedule;
   expect((await worker.call(punch, 'POST', { action: 'IN', at: '2020-01-12T00:00:00Z' })).status).toBe(400);
   expect((await outsider.call(punch, 'POST', { action: 'IN' })).status).toBe(404);
   expect((await admin.call(punch, 'POST', { action: 'IN' })).status).toBe(403);
   const concurrent = await Promise.all([worker.call(punch, 'POST', { action: 'IN' }), worker.call(punch, 'POST', { action: 'IN' })]);
   expect(concurrent.map(result => result.status).sort()).toEqual([200,409]);
   expect((await worker.call(punch, 'POST', { action: 'OUT' })).status).toBe(200);
   expect((await worker.call(punch, 'POST', { action: 'OUT' })).status).toBe(409);
   const original = (await pool.query('SELECT checked_in_at,checked_out_at FROM attendance_punches WHERE schedule_id=$1', [schedule])).rows[0];
   await pool.query("UPDATE work_schedule SET ends_at=now()-interval '1 second' WHERE id=$1", [schedule]);
   const proposedIn = new Date(Date.now() - 1800000).toISOString();
   const proposedOut = new Date(Date.now() - 1200000).toISOString();
   const correction = await worker.call(att() + '/corrections/' + schedule, 'POST', { checkedInAt: proposedIn, checkedOutAt: proposedOut, reason });
   expect(correction.status, JSON.stringify(correction.body)).toBe(201);
   const review = att() + '/corrections/' + correction.body.id + '/review';
   expect((await outsider.call(review, 'POST', { action: 'APPROVE', reason })).status).toBe(403);
   expect((await manager.call(review, 'POST', { action: 'APPROVE', reason })).status).toBe(204);
   expect((await manager.call(review, 'POST', { action: 'APPROVE', reason })).status).toBe(409);
   const ledger = await worker.call(att() + '/employees/' + employee + '/ledger' + period);
   expect(ledger.body.schedule[0]).toMatchObject({ adjusted: true, late: true, checkedInAt: proposedIn, rawIn: original.checked_in_at.toISOString() });
   expect((await pool.query('SELECT checked_in_at,checked_out_at FROM attendance_punches WHERE schedule_id=$1', [schedule])).rows[0]).toEqual(original);
   expect((await pool.query("SELECT count(*)::int AS total FROM auth_audit_events WHERE organization_id=$1 AND event_type='ATT_CORRECTION_REVIEWED'", [org])).rows[0].total).toBe(1);
 });

 it('enforces scope and debits a limited balance atomically, then releases it on cancellation', async () => {
   const admin = await actor('admin'), worker = await actor('employee'), manager = await actor('manager');
   const outsider = await actor('outsider');
   const otherId = await user('foreign@employee.test', 'ADMIN', otherOrg);
   expect(otherId).toBeTruthy();
   const other = await new Client().login('foreign@employee.test');
   const type = (await admin.call(att() + '/leave-types/new', 'PUT', { name: 'Paid', tracksBalance: true, active: true })).body.id;
   const employeePath = att() + '/employees/' + employee;
   expect((await worker.call(att() + '/employees?q=Test')).body.items).toEqual([
     expect.objectContaining({ id: employee, self: true }),
   ]);
   expect((await outsider.call(att() + '/employees?q=Test')).body.items).toEqual([]);
   expect((await admin.call(employeePath + '/balances/' + type, 'PUT', { allowanceMinutes: 60, reason })).status).toBe(204);
   const firstInput = { leaveTypeId: type, startsAt: '2099-01-01T09:00:00Z', endsAt: '2099-01-01T11:00:00Z', reason };
   const first = await worker.call(employeePath + '/leave', 'POST', firstInput);
   expect(first.status, JSON.stringify(first.body)).toBe(201);
   expect((await worker.call(employeePath + '/leave', 'POST', firstInput)).body.code).toBe('ATT_LEAVE_CONFLICT');
   const second = await admin.call(employeePath + '/leave', 'POST', { ...firstInput, startsAt: '2099-01-03T09:00:00Z', endsAt: '2099-01-03T11:00:00Z' });
   expect(second.status).toBe(201);
   const review = (id: string) => att() + '/leave/' + id + '/review';
   expect((await admin.call(review(second.body.id), 'POST', { action: 'APPROVE', chargeMinutes: 60, reason })).body.code).toBe('ATT_SELF_REVIEW');
   expect((await admin.call(review(first.body.id), 'POST', { action: 'APPROVE', reason })).body.code).toBe('ATT_CHARGE_REQUIRED');
   expect((await outsider.call(employeePath + '/ledger' + period)).status).toBe(404);
   expect((await other.call(att().replace(org, otherOrg) + '/leave/' + first.body.id + '/review', 'POST', { action: 'APPROVE', chargeMinutes: 60, reason })).status).toBe(404);
   const decision = { action: 'APPROVE', chargeMinutes: 60, reason };
   const outcomes = await Promise.all([first, second].map(item => manager.call(review(item.body.id), 'POST', decision)));
   expect(outcomes.map(result => result.status).sort()).toEqual([204,409]);
   expect(outcomes.find(result => result.status === 409)?.body.code).toBe('ATT_INSUFFICIENT_BALANCE');
   const approved = [first, second][outcomes.findIndex(result => result.status === 204)].body.id;
   expect((await manager.call(review(approved), 'POST', decision)).body.code).toBe('ATT_ALREADY_REVIEWED');
   const report = async () => (await worker.call(employeePath + '/ledger?from=2099-01-01&to=2099-01-04')).body;
   expect((await report()).balances[0].availableMinutes).toBe(0);
   const cancel = att() + '/leave/' + approved + '/cancel';
   expect((await worker.call(cancel, 'POST', { reason })).status).toBe(403);
   expect((await manager.call(cancel, 'POST', { reason })).status).toBe(204);
   expect((await manager.call(cancel, 'POST', { reason })).status).toBe(409);
   const ledger = await report();
   expect(ledger.balances[0].availableMinutes).toBe(60);
   expect(ledger.leave.find((row: { id: string }) => row.id === approved)).toMatchObject({ status: 'CANCELLED', chargeMinutes: 60, reviewReason: reason, cancelReason: reason });
   const remaining = [first, second].find(item => item.body.id !== approved)!;
   expect((await manager.call(review(remaining.body.id), 'POST', { action: 'REJECT', reason })).status).toBe(204);
   expect((await report()).leave.find((row: { id: string }) => row.id === remaining.body.id)).toMatchObject({ status: 'REJECTED', reviewReason: reason });
 });

 it('computes review indicators only from configured thresholds and keeps adjacent intervals valid', async () => {
   const admin = await actor('admin'), worker = await actor('employee');
   const shiftId = (await admin.call(att() + '/shifts/new', 'PUT', shift)).body.id;
   const rows = [
     ['2020-01-10', '2020-01-10T08:10:00Z', '2020-01-10T16:40:00Z'],
     ['2020-01-11', '2020-01-11T08:01:00Z', '2020-01-11T17:45:00Z'],
     ['2020-01-12', null, null],
   ];
   for (const [date, rawIn, rawOut] of rows) {
     const id = randomUUID();
     await pool.query(`INSERT INTO work_schedule(id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,
       early_check_in,late_grace,early_grace,overtime_after) VALUES($1,$2,$3,$4,'Fixture',$5,'UTC',$6,$7,0,5,10,15)`,
     [id, org, employee, shiftId, date, date + 'T08:00:00Z', date + 'T17:00:00Z']);
     if (rawIn) await pool.query('INSERT INTO attendance_punches(schedule_id,organization_id,checked_in_at,checked_out_at) VALUES($1,$2,$3,$4)',
       [id, org, rawIn, rawOut]);
   }
   const ledger = await worker.call(att() + '/employees/' + employee + '/ledger' + period);
   expect(ledger.body.schedule).toMatchObject([
     { status: 'COMPLETE', late: true, leftEarly: true, overtimeMinutes: 0, recordedMinutes: 510 },
     { status: 'COMPLETE', late: false, leftEarly: false, overtimeMinutes: 30, recordedMinutes: 584 },
     { status: 'MISSING', late: null, leftEarly: null, overtimeMinutes: null, recordedMinutes: null },
   ]);
   const type = (await admin.call(att() + '/leave-types/new', 'PUT', { name: 'Untracked', tracksBalance: false, active: true })).body.id;
   const input = { leaveTypeId: type, startsAt: '2020-01-11T17:45:00Z', endsAt: '2020-01-11T18:00:00Z', reason };
   const created = await worker.call(att() + '/employees/' + employee + '/leave', 'POST', input);
   expect(created.status).toBe(201);
   const cancel = await worker.call(att() + '/leave/' + created.body.id + '/cancel', 'POST', { reason });
   expect(cancel.status).toBe(204);
 });
});
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
