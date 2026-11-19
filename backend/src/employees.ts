import type { Express } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Identity, type Authed } from './types.js';
import { authorizeMutation } from './authorization.js';
import { managementScope } from './management-scope.js';
import { detectReportingCycle, type OrgStructureDeps } from './organization-structure.js';

const uuid=z.string().uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
});
const code=z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_.-]+$/).transform(v=>v.toUpperCase());
const privateFields={birthDate:date.nullable().optional(),phone:z.string().trim().min(1).max(32).nullable().optional(),personalEmail:z.string().trim().email().max(254).nullable().optional(),address:z.string().trim().min(1).max(500).nullable().optional()};
const assignment={departmentId:uuid.nullable(),positionId:uuid.nullable(),managerUserId:uuid.nullable()};
const contractFields={contractNumber:z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N}_./-]+$/u),contractType:z.enum(['PROBATION','FIXED_TERM','INDEFINITE']),startDate:date,endDate:date.nullable(),signedOn:date.nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()};
const contractSchema=z.object(contractFields);
const paging=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)});
type Employee={id:string;organization_id:string;user_id:string|null;employee_code:string;full_name:string;hire_date:string;employment_status:string;birth_date:string|null;phone:string|null;personal_email:string|null;address:string|null;department_id:string|null;position_id:string|null;manager_user_id:string|null;department_name:string|null;position_title:string|null;manager_name:string|null;version:number;role:string|null};
const employeeSelect=`SELECT e.*,e.hire_date::text AS hire_date,e.birth_date::text AS birth_date,
  d.name AS department_name,p.title AS position_title,u.full_name AS manager_name,m.role
  FROM employees e LEFT JOIN departments d ON d.id=e.department_id AND d.organization_id=e.organization_id
  LEFT JOIN positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
  LEFT JOIN users u ON u.id=e.manager_user_id
  LEFT JOIN memberships m ON m.user_id=e.user_id AND m.organization_id=e.organization_id`;

export function registerEmployeeRoutes(app:Express,deps:OrgStructureDeps){
  const {pool,transaction,requireIdentity,audit}=deps;
  const prefix='/api/organizations/:organizationId/employees';
  function identityFor(req:Authed){const identity=requireIdentity(req);uuid.parse(req.params.organizationId);if(identity.orgId!==req.params.organizationId)fail(403,'FORBIDDEN');return identity;}
  async function visibleWhere(identity:Identity){
    const values:unknown[]=[identity.orgId];const clauses=['e.organization_id=$1'];
    if(identity.role==='EMPLOYEE'){values.push(identity.userId);clauses.push('e.user_id=$2');}
    else if(identity.role==='HR'){values.push(identity.userId);clauses.push("(e.user_id IS NULL OR m.role='EMPLOYEE' OR e.user_id=$2)");}
    else if(identity.role==='MANAGER'){
      const scope=(await managementScope(pool,identity))!;values.push(scope.departments,scope.users,identity.userId);
      clauses.push('(e.department_id=ANY($2::uuid[]) OR e.user_id=ANY($3::uuid[]) OR e.manager_user_id=$4)');
    }else if(identity.role!=='ADMIN')fail(403,'FORBIDDEN');
    return {values,clauses};
  }
  async function employee(identity:Identity,id:string,db?:PoolClient,write=false):Promise<Employee>{
    if(write){
      if(!['ADMIN','HR'].includes(identity.role))fail(403,'FORBIDDEN');
      const r=await db!.query<Employee>(employeeSelect+' WHERE e.organization_id=$1 AND e.id=$2 FOR UPDATE OF e',[identity.orgId,id]);
      const row=r.rows[0];if(!row)fail(404,'EMPLOYEE_NOT_FOUND');
      if(identity.role==='HR'&&row.user_id&&row.role!=='EMPLOYEE')fail(403,'FORBIDDEN');return row;
    }
    const where=await visibleWhere(identity);where.values.push(id);where.clauses.push(`e.id=$${where.values.length}`);
    const row=(await pool.query<Employee>(employeeSelect+' WHERE '+where.clauses.join(' AND '),where.values)).rows[0];
    if(!row)fail(404,'EMPLOYEE_NOT_FOUND');return row;
  }
  function dto(row:Employee,identity:Identity,detail=false){
    const basic={id:row.id,userId:row.user_id,employeeCode:row.employee_code,fullName:row.full_name,hireDate:row.hire_date,employmentStatus:row.employment_status,departmentId:row.department_id,departmentName:row.department_name,positionId:row.position_id,positionTitle:row.position_title,managerUserId:row.manager_user_id,managerName:row.manager_name,version:row.version,canEdit:identity.role==='ADMIN'||(identity.role==='HR'&&(!row.user_id||row.role==='EMPLOYEE'))};
    return detail&&(identity.role==='ADMIN'||identity.role==='HR'||row.user_id===identity.userId)?{...basic,birthDate:row.birth_date,phone:row.phone,personalEmail:row.personal_email,address:row.address}:basic;
  }
  async function context(db:PoolClient,identity:Identity,effective:string,reason:string){await db.query("SELECT set_config('app.employee_actor',$1,true),set_config('app.employee_effective_on',$2,true),set_config('app.employee_reason',$3,true)",[identity.userId,effective,reason]);}
  async function validAssignment(db:PoolClient,identity:Identity,userId:string|null,data:{departmentId:string|null;positionId:string|null;managerUserId:string|null}){
    if(data.departmentId&&!(await db.query('SELECT 1 FROM departments WHERE organization_id=$1 AND id=$2 AND is_active',[identity.orgId,data.departmentId])).rowCount)fail(400,'INVALID_DEPARTMENT');
    if(data.positionId){const p=(await db.query('SELECT department_id FROM positions WHERE organization_id=$1 AND id=$2 AND is_active',[identity.orgId,data.positionId])).rows[0];if(!p)fail(400,'INVALID_POSITION');if(p.department_id&&p.department_id!==data.departmentId)fail(400,'POSITION_DEPARTMENT_MISMATCH');}
    if(data.managerUserId){
      if(data.managerUserId===userId)fail(400,'INVALID_MANAGER');
      const manager=await db.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role='MANAGER' AND m.is_active AND u.is_active AND u.email_verified_at IS NOT NULL",[identity.orgId,data.managerUserId]);
      if(!manager.rowCount)fail(400,'INVALID_MANAGER');
      if(userId&&await detectReportingCycle(db,identity.orgId,userId,data.managerUserId))fail(400,'CIRCULAR_REPORTING');
    }
  }
  app.get(prefix,async(req:Authed,res)=>{
    const identity=identityFor(req);const data=paging.extend({q:z.string().trim().max(100).optional(),status:z.enum(['ACTIVE','ON_LEAVE','TERMINATED']).optional()}).strict().parse(req.query);
    const w=await visibleWhere(identity);
    if(data.q){w.values.push('%'+data.q.replace(/[\\%_]/g,c=>'\\'+c)+'%');w.clauses.push(`(e.full_name ILIKE $${w.values.length} ESCAPE '\\' OR e.employee_code ILIKE $${w.values.length} ESCAPE '\\')`);}
    if(data.status){w.values.push(data.status);w.clauses.push(`e.employment_status=$${w.values.length}`);}
    const where=' WHERE '+w.clauses.join(' AND ');
    const total=(await pool.query('SELECT count(*)::int AS total FROM employees e LEFT JOIN memberships m ON m.user_id=e.user_id AND m.organization_id=e.organization_id'+where,w.values)).rows[0].total;
    w.values.push(data.limit,(data.page-1)*data.limit);
    const rows=await pool.query<Employee>(employeeSelect+where+` ORDER BY e.employee_code,e.id LIMIT $${w.values.length-1} OFFSET $${w.values.length}`,w.values);
    res.json({items:rows.rows.map(row=>dto(row,identity)),total,page:data.page,limit:data.limit});
  });
  app.get(prefix+'/:employeeId',async(req:Authed,res)=>{const identity=identityFor(req);res.json({employee:dto(await employee(identity,uuid.parse(req.params.employeeId)),identity,true),today:(await pool.query('SELECT CURRENT_DATE::text AS today')).rows[0].today});});
  app.post(prefix,async(req:Authed,res)=>{
    const identity=identityFor(req);if(!['ADMIN','HR'].includes(identity.role))fail(403,'FORBIDDEN');
    const data=z.object({employeeCode:code,fullName:z.string().trim().min(1).max(150),hireDate:date,userId:uuid.nullable().optional(),...privateFields,departmentId:uuid.nullable().optional(),positionId:uuid.nullable().optional(),managerUserId:uuid.nullable().optional()}).strict().parse(req.body);
    const id=randomUUID();
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId,...(data.userId?[data.userId]:[])],['ADMIN','HR']);
      if((await db.query('SELECT 1 FROM employees WHERE organization_id=$1 AND upper(btrim(employee_code))=$2',[identity.orgId,data.employeeCode])).rowCount)fail(409,'EMPLOYEE_CODE_EXISTS');
      if(data.hireDate>(await db.query('SELECT CURRENT_DATE::text AS today')).rows[0].today || (data.birthDate&&data.birthDate>data.hireDate))fail(400,'INVALID_EMPLOYEE_DATES');
      let assigned={departmentId:data.departmentId??null,positionId:data.positionId??null,managerUserId:data.managerUserId??null};
      if(data.userId){
        const m=(await db.query('SELECT m.*,u.is_active AS user_active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2',[identity.orgId,data.userId])).rows[0];
        if(!m||!m.is_active||!m.user_active)fail(400,'INVALID_EMPLOYEE_ACCOUNT');
        if(identity.role==='HR'&&m.role!=='EMPLOYEE')fail(403,'FORBIDDEN');
        if((await db.query('SELECT 1 FROM employees WHERE organization_id=$1 AND user_id=$2',[identity.orgId,data.userId])).rowCount)fail(409,'EMPLOYEE_ACCOUNT_EXISTS');
        for(const [field,column] of [['departmentId','department_id'],['positionId','position_id'],['managerUserId','manager_user_id']] as const)if(data[field]!==undefined&&data[field]!==m[column])fail(400,'ACCOUNT_ASSIGNMENT_MISMATCH');
        assigned={departmentId:m.department_id,positionId:m.position_id,managerUserId:m.manager_user_id};
      }else if(identity.role==='HR'&&assigned.managerUserId)fail(403,'FORBIDDEN');
      await validAssignment(db,identity,data.userId??null,assigned);
      await context(db,identity,data.hireDate,'PROFILE_CREATED');
      await db.query(`INSERT INTO employees(id,organization_id,user_id,employee_code,full_name,hire_date,birth_date,phone,personal_email,address,department_id,position_id,manager_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,identity.orgId,data.userId??null,data.employeeCode,data.fullName,data.hireDate,data.birthDate??null,data.phone??null,data.personalEmail??null,data.address??null,assigned.departmentId,assigned.positionId,assigned.managerUserId]);
      await audit(db,'EMPLOYEE_CREATED',identity.userId,identity.orgId,data.userId??undefined,{employeeId:id});
    });res.status(201).json({id});
  });
  app.patch(prefix+'/:employeeId',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const data=z.object({version:z.number().int().positive(),employeeCode:code.optional(),fullName:z.string().trim().min(1).max(150).optional(),employmentStatus:z.enum(['ACTIVE','ON_LEAVE','TERMINATED']).optional(),...privateFields}).strict().parse(req.body);
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);const row=await employee(identity,id,db,true);
      if(row.version!==data.version)fail(409,'STALE_RECORD');
      if(data.birthDate&&data.birthDate>row.hire_date)fail(400,'INVALID_EMPLOYEE_DATES');
      if(data.employeeCode&&(await db.query('SELECT 1 FROM employees WHERE organization_id=$1 AND upper(btrim(employee_code))=$2 AND id<>$3',[identity.orgId,data.employeeCode,id])).rowCount)fail(409,'EMPLOYEE_CODE_EXISTS');
      const columns:Record<string,string>={employeeCode:'employee_code',fullName:'full_name',employmentStatus:'employment_status',birthDate:'birth_date',phone:'phone',personalEmail:'personal_email',address:'address'};
      const values:unknown[]=[identity.orgId,id];const sets:string[]=[];
      for(const [field,column] of Object.entries(columns))if(field in data){values.push(data[field as keyof typeof data]);sets.push(column+'=$'+values.length);}
      if(!sets.length)fail(400,'INVALID_INPUT');
      await db.query('UPDATE employees SET '+sets.join(',')+',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',values);
      await audit(db,'EMPLOYEE_UPDATED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,fields:Object.keys(data).filter(k=>k!=='version')});
    });res.status(204).end();
  });
  app.get(prefix+'/:employeeId/work-history',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);await employee(identity,id);
    const {page,limit}=paging.strict().parse(req.query);
    const total=(await pool.query('SELECT count(*)::int AS total FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2',[identity.orgId,id])).rows[0].total;
    const rows=await pool.query(`SELECT id,effective_on::text AS "effectiveOn",reason,department_name AS "departmentName",position_title AS "positionTitle",manager_name AS "managerName",recorded_at AS "recordedAt" FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_on DESC,recorded_at DESC,id LIMIT $3 OFFSET $4`,[identity.orgId,id,limit,(page-1)*limit]);
    res.json({items:rows.rows.map(row=>identity.role==='MANAGER'?{...row,reason:'ASSIGNMENT_CHANGED'}:row),total,page,limit});
  });
  app.post(prefix+'/:employeeId/account',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    if(identity.role!=='ADMIN')fail(403,'FORBIDDEN');
    const data=z.object({version:z.number().int().positive(),userId:uuid}).strict().parse(req.body);
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId,data.userId],['ADMIN']);const row=await employee(identity,id,db,true);
      if(row.version!==data.version)fail(409,'STALE_RECORD');if(row.user_id)fail(409,'EMPLOYEE_ACCOUNT_EXISTS');
      const member=(await db.query('SELECT m.* FROM memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.organization_id=$1 AND m.user_id=$2 AND m.is_active',[identity.orgId,data.userId])).rows[0];
      if(!member)fail(400,'INVALID_EMPLOYEE_ACCOUNT');
      if((await db.query('SELECT 1 FROM employees WHERE organization_id=$1 AND user_id=$2',[identity.orgId,data.userId])).rowCount)fail(409,'EMPLOYEE_ACCOUNT_EXISTS');
      const today=(await db.query('SELECT CURRENT_DATE::text AS today')).rows[0].today;await context(db,identity,today,'ACCOUNT_LINKED');
      await db.query('UPDATE employees SET user_id=$1,department_id=$2,position_id=$3,manager_user_id=$4,version=version+1,updated_at=now() WHERE organization_id=$5 AND id=$6',[data.userId,member.department_id,member.position_id,member.manager_user_id,identity.orgId,id]);
      await audit(db,'EMPLOYEE_ACCOUNT_LINKED',identity.userId,identity.orgId,data.userId,{employeeId:id});
    });res.status(204).end();
  });
  app.post(prefix+'/:employeeId/work-history',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const data=z.object({version:z.number().int().positive(),effectiveOn:date,reason:z.string().trim().min(1).max(500),...assignment}).strict().parse(req.body);
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId,...(data.managerUserId?[data.managerUserId]:[])],['ADMIN','HR']);const row=await employee(identity,id,db,true);
      if(row.version!==data.version)fail(409,'STALE_RECORD');
      if(identity.role==='HR'&&data.managerUserId!==row.manager_user_id)fail(403,'FORBIDDEN');
      const latest=(await db.query('SELECT max(effective_on)::text AS date,CURRENT_DATE::text AS today FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2',[identity.orgId,id])).rows[0];
      if(data.effectiveOn<row.hire_date||data.effectiveOn>latest.today||(latest.date&&data.effectiveOn<latest.date))fail(400,'INVALID_HISTORY_DATE');
      if(data.departmentId===row.department_id&&data.positionId===row.position_id&&data.managerUserId===row.manager_user_id)fail(409,'ASSIGNMENT_UNCHANGED');
      await validAssignment(db,identity,row.user_id,data);await context(db,identity,data.effectiveOn,data.reason);
      if(row.user_id)await db.query('UPDATE memberships SET department_id=$1,position_id=$2,manager_user_id=$3 WHERE organization_id=$4 AND user_id=$5',[data.departmentId,data.positionId,data.managerUserId,identity.orgId,row.user_id]);
      else await db.query('UPDATE employees SET department_id=$1,position_id=$2,manager_user_id=$3,version=version+1,updated_at=now() WHERE organization_id=$4 AND id=$5',[data.departmentId,data.positionId,data.managerUserId,identity.orgId,id]);
      await audit(db,'EMPLOYEE_TRANSFERRED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,effectiveOn:data.effectiveOn});
    });res.status(204).end();
  });
  async function contractAccess(identity:Identity,id:string){const row=await employee(identity,id);if(!['ADMIN','HR'].includes(identity.role)&&row.user_id!==identity.userId)fail(403,'FORBIDDEN');return row;}
  const contractSelect=`SELECT id,contract_number AS "contractNumber",contract_type AS "contractType",start_date::text AS "startDate",end_date::text AS "endDate",signed_on::text AS "signedOn",termination_date::text AS "terminationDate",status,notes,version FROM employee_contracts`;
  app.get(prefix+'/:employeeId/contracts',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);await contractAccess(identity,id);const {page,limit}=paging.strict().parse(req.query);
    const total=(await pool.query('SELECT count(*)::int AS total FROM employee_contracts WHERE organization_id=$1 AND employee_id=$2',[identity.orgId,id])).rows[0].total;
    const rows=await pool.query(contractSelect+' WHERE organization_id=$1 AND employee_id=$2 ORDER BY start_date DESC,id LIMIT $3 OFFSET $4',[identity.orgId,id,limit,(page-1)*limit]);res.json({items:rows.rows,total,page,limit});
  });
  function validateContract(data:{contractType:string;startDate:string;endDate:string|null}){if((data.endDate&&data.endDate<data.startDate)||(data.contractType==='INDEFINITE'?data.endDate!==null:data.endDate===null))fail(400,'INVALID_CONTRACT_DATES');}
  app.post(prefix+'/:employeeId/contracts',async(req:Authed,res)=>{
    const identity=identityFor(req),employeeId=uuid.parse(req.params.employeeId);const data=z.object(contractFields).strict().parse(req.body);validateContract(data);const id=randomUUID();
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);await employee(identity,employeeId,db,true);
      if((await db.query('SELECT 1 FROM employee_contracts WHERE organization_id=$1 AND upper(btrim(contract_number))=upper($2)',[identity.orgId,data.contractNumber])).rowCount)fail(409,'CONTRACT_NUMBER_EXISTS');
      await db.query('INSERT INTO employee_contracts(id,organization_id,employee_id,contract_number,contract_type,start_date,end_date,signed_on,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,identity.orgId,employeeId,data.contractNumber,data.contractType,data.startDate,data.endDate,data.signedOn??null,data.notes??null]);
      await audit(db,'EMPLOYEE_CONTRACT_CREATED',identity.userId,identity.orgId,undefined,{employeeId,contractId:id});
    });res.status(201).json({id});
  });
  app.patch(prefix+'/:employeeId/contracts/:contractId',async(req:Authed,res)=>{
    const identity=identityFor(req),employeeId=uuid.parse(req.params.employeeId),id=uuid.parse(req.params.contractId);
    const data=contractSchema.partial().extend({version:z.number().int().positive(),status:z.enum(['DRAFT','ACTIVE','TERMINATED','EXPIRED','CANCELLED']).optional(),terminationDate:date.nullable().optional()}).strict().parse(req.body);
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);await employee(identity,employeeId,db,true);
      const old=(await db.query(contractSelect+' WHERE organization_id=$1 AND employee_id=$2 AND id=$3 FOR UPDATE',[identity.orgId,employeeId,id])).rows[0];if(!old)fail(404,'CONTRACT_NOT_FOUND');
      if(old.version!==data.version)fail(409,'STALE_RECORD');
      const next={...old,...data};validateContract(next);
      const material=Object.keys(contractFields);
      if(old.status!=='DRAFT'&&material.some(field=>field in data&&data[field as keyof typeof data]!==old[field]))fail(409,'CONTRACT_IMMUTABLE');
      const allowed:Record<string,string[]>={DRAFT:['DRAFT','ACTIVE','CANCELLED','TERMINATED','EXPIRED'],ACTIVE:['TERMINATED','EXPIRED']};
      if(!allowed[old.status]?.includes(next.status))fail(409,'INVALID_CONTRACT_TRANSITION');
      const today=(await db.query('SELECT CURRENT_DATE::text AS today')).rows[0].today;
      if(['ACTIVE','TERMINATED','EXPIRED'].includes(next.status)&&(!next.signedOn||next.signedOn>today))fail(400,'CONTRACT_SIGNATURE_DATE_REQUIRED');
      if(next.status==='ACTIVE'){
        if(next.startDate>today||(next.endDate&&next.endDate<today))fail(400,'INVALID_CONTRACT_DATES');
        await db.query("UPDATE employee_contracts SET status='EXPIRED',version=version+1,updated_at=now() WHERE organization_id=$1 AND employee_id=$2 AND status='ACTIVE' AND end_date<CURRENT_DATE",[identity.orgId,employeeId]);
        if((await db.query("SELECT 1 FROM employee_contracts WHERE organization_id=$1 AND employee_id=$2 AND status='ACTIVE' AND id<>$3",[identity.orgId,employeeId,id])).rowCount)fail(409,'ACTIVE_CONTRACT_EXISTS');
      }
      if(next.status==='EXPIRED'&&(!next.endDate||next.endDate>=today))fail(400,'INVALID_CONTRACT_DATES');
      if(next.status==='TERMINATED'&&(!next.terminationDate||next.terminationDate<next.startDate||next.terminationDate>today||(next.endDate&&next.terminationDate>next.endDate)))fail(400,'INVALID_CONTRACT_DATES');
      if(next.status!=='TERMINATED'&&next.terminationDate)fail(400,'INVALID_CONTRACT_DATES');
      if((await db.query('SELECT 1 FROM employee_contracts WHERE organization_id=$1 AND upper(btrim(contract_number))=upper($2) AND id<>$3',[identity.orgId,next.contractNumber,id])).rowCount)fail(409,'CONTRACT_NUMBER_EXISTS');
      await db.query('UPDATE employee_contracts SET contract_number=$1,contract_type=$2,start_date=$3,end_date=$4,signed_on=$5,notes=$6,status=$7,termination_date=$8,version=version+1,updated_at=now() WHERE organization_id=$9 AND employee_id=$10 AND id=$11',[next.contractNumber,next.contractType,next.startDate,next.endDate,next.signedOn,next.notes,next.status,next.terminationDate??null,identity.orgId,employeeId,id]);
      await audit(db,'EMPLOYEE_CONTRACT_UPDATED',identity.userId,identity.orgId,undefined,{employeeId,contractId:id,status:next.status});
    });res.status(204).end();
  });
}
