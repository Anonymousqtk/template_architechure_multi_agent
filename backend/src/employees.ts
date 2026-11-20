import type { Express } from 'express';
import type { PoolClient } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Identity, type Authed } from './types.js';
import { authorizeMutation } from './authorization.js';
import { managementScope } from './management-scope.js';
import { detectReportingCycle, type OrgStructureDeps } from './organization-structure.js';
import { saveFile, readFile, deleteFile, ALLOWED_MIME_TYPES } from './file-storage.js';
import { generateEmployeeTemplate, parseEmployeeImportFile } from './excel-parser.js';

const uuid=z.string().uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
});
const code=z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_.-]+$/).transform(v=>v.toUpperCase());
const privateFields={birthDate:date.nullable().optional(),phone:z.string().trim().min(1).max(32).nullable().optional(),personalEmail:z.string().trim().email().max(254).nullable().optional(),address:z.string().trim().min(1).max(500).nullable().optional(),bankName:z.string().trim().max(100).nullable().optional(),bankAccountNumber:z.string().trim().max(50).nullable().optional(),bankAccountName:z.string().trim().max(150).nullable().optional()};
const assignment={departmentId:uuid.nullable().optional(),positionId:uuid.nullable().optional(),managerUserId:uuid.nullable().optional()};
const contractFields={contractNumber:z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N}_./-]+$/u),contractType:z.enum(['PROBATION','FIXED_TERM','INDEFINITE']),startDate:date,endDate:date.nullable(),signedOn:date.nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()};
const contractSchema=z.object(contractFields);
const paging=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)});

type Employee={id:string;organization_id:string;user_id:string|null;employee_code:string;full_name:string;hire_date:string;employment_status:string;birth_date:string|null;phone:string|null;personal_email:string|null;address:string|null;department_id:string|null;position_id:string|null;manager_user_id:string|null;department_name:string|null;position_title:string|null;manager_name:string|null;version:number;role:string|null;avatar_url:string|null;bank_name:string|null;bank_account_number:string|null;bank_account_name:string|null};

const employeeSelect=`SELECT e.*,e.hire_date::text AS hire_date,e.birth_date::text AS birth_date,
  d.name AS department_name,p.title AS position_title,u.full_name AS manager_name,m.role,e.avatar_url,
  e.bank_name,e.bank_account_number,e.bank_account_name
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
    const avatarUrl=row.avatar_url?`/api/organizations/${row.organization_id}/employees/${row.id}/avatar`:null;
    const basic={id:row.id,organizationId:row.organization_id,userId:row.user_id,employeeCode:row.employee_code,fullName:row.full_name,avatarUrl,hireDate:row.hire_date,employmentStatus:row.employment_status,departmentId:row.department_id,departmentName:row.department_name,positionId:row.position_id,positionTitle:row.position_title,managerUserId:row.manager_user_id,managerName:row.manager_name,version:row.version,canEdit:identity.role==='ADMIN'||(identity.role==='HR'&&(!row.user_id||row.role==='EMPLOYEE')),bankName:row.bank_name,bankAccountNumber:row.bank_account_number,bankAccountName:row.bank_account_name};
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

  // --- 1. Roster and Basic CRUD ---
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

  app.get(prefix+'/me',async(req:Authed,res)=>{
    const identity=identityFor(req);
    const row=(await pool.query<Employee>(employeeSelect+' WHERE e.organization_id=$1 AND e.user_id=$2 LIMIT 1',[identity.orgId,identity.userId])).rows[0];
    if(!row)fail(404,'EMPLOYEE_PROFILE_NOT_FOUND');
    res.json({employee:dto(row,identity)});
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
      await db.query(`INSERT INTO employees(id,organization_id,user_id,employee_code,full_name,hire_date,birth_date,phone,personal_email,address,department_id,position_id,manager_user_id,bank_name,bank_account_number,bank_account_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[id,identity.orgId,data.userId??null,data.employeeCode,data.fullName,data.hireDate,data.birthDate??null,data.phone??null,data.personalEmail??null,data.address??null,assigned.departmentId,assigned.positionId,assigned.managerUserId,data.bankName??null,data.bankAccountNumber??null,data.bankAccountName??null]);
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
      const columns:Record<string,string>={employeeCode:'employee_code',fullName:'full_name',employmentStatus:'employment_status',birthDate:'birth_date',phone:'phone',personalEmail:'personal_email',address:'address',bankName:'bank_name',bankAccountNumber:'bank_account_number',bankAccountName:'bank_account_name'};
      const values:unknown[]=[identity.orgId,id];const sets:string[]=[];
      for(const [field,column] of Object.entries(columns))if(field in data){values.push(data[field as keyof typeof data]);sets.push(column+'=$'+values.length);}
      if(!sets.length)fail(400,'INVALID_INPUT');
      await db.query('UPDATE employees SET '+sets.join(',')+',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',values);
      await audit(db,'EMPLOYEE_UPDATED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,fields:Object.keys(data).filter(k=>k!=='version')});
    });res.status(204).end();
  });

  // --- 2. Avatar Upload & Serving ---
  app.post(prefix+'/:employeeId/avatar',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const data=z.object({
      fileName:z.string().trim().min(1).max(150),
      mimeType:z.enum(['image/jpeg','image/png']),
      contentBase64:z.string().min(1),
    }).strict().parse(req.body);

    const buffer=Buffer.from(data.contentBase64,'base64');
    let avatarRelativeUrl='';
    await transaction(async db=>{
      const r=await db.query<Employee>(employeeSelect+' WHERE e.organization_id=$1 AND e.id=$2 FOR UPDATE OF e',[identity.orgId,id]);
      const row=r.rows[0];
      if(!row)fail(404,'EMPLOYEE_NOT_FOUND');
      if(!['ADMIN','HR'].includes(identity.role)&&row.user_id!==identity.userId)fail(403,'FORBIDDEN');
      if(identity.role==='HR'&&row.user_id&&row.role!=='EMPLOYEE')fail(403,'FORBIDDEN');
      const saved=await saveFile(identity.orgId,'avatars',data.fileName,buffer,['image/jpeg','image/png'],5*1024*1024);
      avatarRelativeUrl=`/api/organizations/${identity.orgId}/employees/${id}/avatar`;
      await db.query('UPDATE employees SET avatar_url=$1,version=version+1,updated_at=now() WHERE organization_id=$2 AND id=$3',[saved.filePath,identity.orgId,id]);
      await audit(db,'EMPLOYEE_AVATAR_UPDATED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,filePath:saved.filePath});
    });
    res.json({avatarUrl:avatarRelativeUrl});
  });

  app.get(prefix+'/:employeeId/avatar',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const row=await employee(identity,id);
    if(!row.avatar_url)fail(404,'AVATAR_NOT_FOUND');
    const {buffer,absolutePath}=await readFile(identity.orgId,row.avatar_url!);
    const ext=path.extname(absolutePath).toLowerCase();
    const mime=ext==='.png'?'image/png':'image/jpeg';
    res.setHeader('Content-Type',mime);
    res.setHeader('Cache-Control','private, max-age=86400');
    res.send(buffer);
  });

  // --- 3. Work History & Events ---
  app.get(prefix+'/:employeeId/work-history',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);await employee(identity,id);
    const {page,limit}=paging.strict().parse(req.query);
    const total=(await pool.query('SELECT count(*)::int AS total FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2',[identity.orgId,id])).rows[0].total;
    const rows=await pool.query(`SELECT id,effective_on::text AS "effectiveOn",reason,event_type AS "eventType",title,notes,department_name AS "departmentName",position_title AS "positionTitle",manager_name AS "managerName",recorded_at AS "recordedAt" FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_on DESC,recorded_at DESC,id LIMIT $3 OFFSET $4`,[identity.orgId,id,limit,(page-1)*limit]);
    res.json({items:rows.rows.map(row=>identity.role==='MANAGER'?{...row,reason:'ASSIGNMENT_CHANGED'}:row),total,page,limit});
  });

  app.post(prefix+'/:employeeId/work-history',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const data=z.object({
      version:z.number().int().positive(),
      effectiveOn:date,
      reason:z.string().trim().min(1).max(500),
      eventType:z.enum(['PROFILE_CREATED','ASSIGNMENT_CHANGED','TRANSFER','APPOINTMENT','PROMOTION','AWARD','DISCIPLINE','SALARY_ADJUSTMENT','OTHER']).default('TRANSFER'),
      title:z.string().trim().max(200).nullable().optional(),
      notes:z.string().trim().max(1000).nullable().optional(),
      ...assignment,
    }).strict().parse(req.body);

    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId,...(data.managerUserId?[data.managerUserId]:[])],['ADMIN','HR']);const row=await employee(identity,id,db,true);
      if(row.version!==data.version)fail(409,'STALE_RECORD');
      if(identity.role==='HR'&&data.managerUserId!==undefined&&data.managerUserId!==row.manager_user_id)fail(403,'FORBIDDEN');
      const latest=(await db.query('SELECT max(effective_on)::text AS date,CURRENT_DATE::text AS today FROM employee_work_history WHERE organization_id=$1 AND employee_id=$2',[identity.orgId,id])).rows[0];
      if(data.effectiveOn<row.hire_date||data.effectiveOn>latest.today||(latest.date&&data.effectiveOn<latest.date))fail(400,'INVALID_HISTORY_DATE');

      const targetDeptId = data.departmentId !== undefined ? data.departmentId : row.department_id;
      const targetPosId = data.positionId !== undefined ? data.positionId : row.position_id;
      const targetManagerId = data.managerUserId !== undefined ? data.managerUserId : row.manager_user_id;

      const assignmentChanged = targetDeptId !== row.department_id || targetPosId !== row.position_id || targetManagerId !== row.manager_user_id;
      if (['TRANSFER', 'ASSIGNMENT_CHANGED'].includes(data.eventType) && !assignmentChanged) {
        fail(409, 'ASSIGNMENT_UNCHANGED');
      }

      await validAssignment(db,identity,row.user_id,{departmentId:targetDeptId,positionId:targetPosId,managerUserId:targetManagerId});
      await context(db,identity,data.effectiveOn,data.reason);

      if (assignmentChanged) {
        if(row.user_id)await db.query('UPDATE memberships SET department_id=$1,position_id=$2,manager_user_id=$3 WHERE organization_id=$4 AND user_id=$5',[targetDeptId,targetPosId,targetManagerId,identity.orgId,row.user_id]);
        else await db.query('UPDATE employees SET department_id=$1,position_id=$2,manager_user_id=$3,version=version+1,updated_at=now() WHERE organization_id=$4 AND id=$5',[targetDeptId,targetPosId,targetManagerId,identity.orgId,id]);
      } else {
        await db.query('UPDATE employees SET version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[identity.orgId,id]);
        // Insert history record manually if trigger did not fire
        await db.query(`INSERT INTO employee_work_history(organization_id,employee_id,effective_on,reason,event_type,title,notes,department_id,position_id,manager_user_id,department_name,position_title,manager_name,actor_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [identity.orgId,id,data.effectiveOn,data.reason,data.eventType,data.title??null,data.notes??null,targetDeptId,targetPosId,targetManagerId,row.department_name,row.position_title,row.manager_name,identity.userId]);
      }

      await audit(db,'EMPLOYEE_TRANSFERRED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,effectiveOn:data.effectiveOn,eventType:data.eventType,title:data.title});
    });res.status(204).end();
  });

  // --- 4. Documents Management ---
  app.get(prefix+'/:employeeId/documents',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const row=await employee(identity,id);
    if(!['ADMIN','HR'].includes(identity.role)&&row.user_id!==identity.userId&&identity.role!=='MANAGER')fail(403,'FORBIDDEN');
    const rows=await pool.query(`SELECT id,file_name AS "fileName",file_size AS "fileSize",mime_type AS "mimeType",document_type AS "documentType",description,created_at AS "createdAt" FROM employee_documents WHERE organization_id=$1 AND employee_id=$2 ORDER BY created_at DESC`,[identity.orgId,id]);
    res.json({items:rows.rows});
  });

  app.post(prefix+'/:employeeId/documents',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId);
    const data=z.object({
      fileName:z.string().trim().min(1).max(150),
      mimeType:z.enum(ALLOWED_MIME_TYPES),
      documentType:z.enum(['IDENTIFICATION','DEGREE_CERTIFICATE','LABOR_CONTRACT','DECISION','RESUME','OTHER']).default('OTHER'),
      description:z.string().trim().max(500).nullable().optional(),
      contentBase64:z.string().min(1),
    }).strict().parse(req.body);

    const buffer=Buffer.from(data.contentBase64,'base64');
    let docId='';
    await transaction(async db=>{
      const r=await db.query<Employee>(employeeSelect+' WHERE e.organization_id=$1 AND e.id=$2 FOR UPDATE OF e',[identity.orgId,id]);
      const row=r.rows[0];
      if(!row)fail(404,'EMPLOYEE_NOT_FOUND');
      if(!['ADMIN','HR'].includes(identity.role)&&row.user_id!==identity.userId)fail(403,'FORBIDDEN');
      const saved=await saveFile(identity.orgId,'documents',data.fileName,buffer,ALLOWED_MIME_TYPES,10*1024*1024);
      docId=saved.fileId;
      await db.query(`INSERT INTO employee_documents(id,organization_id,employee_id,file_name,file_path,file_size,mime_type,document_type,description,uploaded_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [docId,identity.orgId,id,saved.fileName,saved.filePath,saved.fileSize,saved.mimeType,data.documentType,data.description??null,identity.userId]);
      await audit(db,'EMPLOYEE_DOCUMENT_UPLOADED',identity.userId,identity.orgId,row.user_id??undefined,{employeeId:id,documentId:docId,fileName:saved.fileName});
    });
    res.status(201).json({id:docId});
  });

  app.get(prefix+'/:employeeId/documents/:documentId/download',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId),docId=uuid.parse(req.params.documentId);
    const row=await employee(identity,id);
    if(!['ADMIN','HR'].includes(identity.role)&&row.user_id!==identity.userId&&identity.role!=='MANAGER')fail(403,'FORBIDDEN');
    const doc=(await pool.query(`SELECT file_name,file_path,file_size,mime_type FROM employee_documents WHERE organization_id=$1 AND employee_id=$2 AND id=$3`,[identity.orgId,id,docId])).rows[0];
    if(!doc)fail(404,'DOCUMENT_NOT_FOUND');
    const {buffer}=await readFile(identity.orgId,doc.file_path);
    res.setHeader('Content-Type',doc.mime_type);
    res.setHeader('Content-Disposition',`attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    res.setHeader('Content-Length',doc.file_size);
    res.send(buffer);
  });

  app.delete(prefix+'/:employeeId/documents/:documentId',async(req:Authed,res)=>{
    const identity=identityFor(req),id=uuid.parse(req.params.employeeId),docId=uuid.parse(req.params.documentId);
    if(!['ADMIN','HR'].includes(identity.role))fail(403,'FORBIDDEN');
    await transaction(async db=>{
      await employee(identity,id,db,true);
      const doc=(await db.query(`SELECT file_path FROM employee_documents WHERE organization_id=$1 AND employee_id=$2 AND id=$3 FOR UPDATE`,[identity.orgId,id,docId])).rows[0];
      if(!doc)fail(404,'DOCUMENT_NOT_FOUND');
      await db.query(`DELETE FROM employee_documents WHERE organization_id=$1 AND employee_id=$2 AND id=$3`,[identity.orgId,id,docId]);
      await deleteFile(identity.orgId,doc.file_path);
      await audit(db,'EMPLOYEE_DOCUMENT_DELETED',identity.userId,identity.orgId,undefined,{employeeId:id,documentId:docId});
    });
    res.status(204).end();
  });

  // --- 5. Excel / CSV Batch Import ---
  app.get(prefix+'-import/template',async(req:Authed,res)=>{
    identityFor(req);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="mau_nhap_nhan_vien.xlsx"');
    res.send(generateEmployeeTemplate());
  });

  app.post(prefix+'-import/preview',async(req:Authed,res)=>{
    const identity=identityFor(req);if(!['ADMIN','HR'].includes(identity.role))fail(403,'FORBIDDEN');
    const data=z.object({
      fileName:z.string().trim().min(1).max(150),
      mimeType:z.string().trim(),
      contentBase64:z.string().min(1),
    }).strict().parse(req.body);

    const buffer=Buffer.from(data.contentBase64,'base64');
    const rawRows=parseEmployeeImportFile(buffer,data.mimeType);

    const existingCodes=new Set((await pool.query('SELECT upper(btrim(employee_code)) AS code FROM employees WHERE organization_id=$1',[identity.orgId])).rows.map(r=>r.code));
    const existingEmails=new Set((await pool.query('SELECT lower(btrim(personal_email)) AS email FROM employees WHERE organization_id=$1 AND personal_email IS NOT NULL',[identity.orgId])).rows.map(r=>r.email));
    const depts=new Map((await pool.query('SELECT id,upper(btrim(code)) as code FROM departments WHERE organization_id=$1 AND is_active AND code IS NOT NULL',[identity.orgId])).rows.map(r=>[r.code,r.id]));
    const positions=new Map((await pool.query('SELECT id,upper(btrim(code)) as code,department_id FROM positions WHERE organization_id=$1 AND is_active AND code IS NOT NULL',[identity.orgId])).rows.map(r=>[r.code,{id:r.id,departmentId:r.department_id}]));
    const today=(await pool.query('SELECT CURRENT_DATE::text AS today')).rows[0].today;

    const seenCodesInFile=new Set<string>();
    const seenEmailsInFile=new Set<string>();

    let validCount=0,duplicateCount=0,errorCount=0;

    const processedRows=rawRows.map(row=>{
      const errors:string[]=[];
      let status:'VALID'|'DUPLICATE'|'ERROR'='VALID';

      const normCode=row.employeeCode.toUpperCase().trim();
      if(!normCode)errors.push('Mã nhân viên không được để trống.');
      else if(!/^[A-Za-z0-9_.-]+$/.test(normCode))errors.push('Mã nhân viên chỉ chứa chữ cái, số, gạch dưới, gạch ngang.');

      if(!row.fullName.trim())errors.push('Họ và tên không được để trống.');

      if(!row.hireDate)errors.push('Ngày vào làm không được để trống.');
      else if(!/^\d{4}-\d{2}-\d{2}$/.test(row.hireDate))errors.push('Ngày vào làm phải có định dạng YYYY-MM-DD.');
      else if(row.hireDate>today)errors.push('Ngày vào làm không được lớn hơn ngày hiện tại.');

      if(row.birthDate){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(row.birthDate))errors.push('Ngày sinh phải có định dạng YYYY-MM-DD.');
        else if(row.birthDate>row.hireDate)errors.push('Ngày sinh không được sau ngày vào làm.');
      }

      const normEmail=row.personalEmail?.toLowerCase().trim();
      if(normEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail))errors.push('Email cá nhân không đúng định dạng.');

      let departmentId:string|null=null;
      if(row.departmentCode){
        const dId=depts.get(row.departmentCode.toUpperCase().trim());
        if(!dId)errors.push(`Mã phòng ban "${row.departmentCode}" không tồn tại hoặc đã bị khóa.`);
        else departmentId=dId;
      }

      let positionId:string|null=null;
      if(row.positionCode){
        const pObj=positions.get(row.positionCode.toUpperCase().trim());
        if(!pObj)errors.push(`Mã chức danh "${row.positionCode}" không tồn tại hoặc đã bị khóa.`);
        else {
          positionId=pObj.id;
          if(pObj.departmentId&&departmentId&&pObj.departmentId!==departmentId){
            errors.push('Chức danh thuộc phòng ban khác với phòng ban đã chọn.');
          }
        }
      }

      // Check duplicates
      let isDuplicate=false;
      if(normCode){
        if(seenCodesInFile.has(normCode)||existingCodes.has(normCode)){
          isDuplicate=true;
          errors.push(`Mã nhân viên "${normCode}" đã tồn tại trong hệ thống hoặc tệp nhập.`);
        }
        seenCodesInFile.add(normCode);
      }
      if(normEmail){
        if(seenEmailsInFile.has(normEmail)||existingEmails.has(normEmail)){
          isDuplicate=true;
          errors.push(`Email "${normEmail}" đã tồn tại trong hệ thống hoặc tệp nhập.`);
        }
        seenEmailsInFile.add(normEmail);
      }

      if(errors.length>0){
        if(isDuplicate&&errors.every(e=>e.includes('đã tồn tại')))status='DUPLICATE';
        else status='ERROR';
      }

      if(status==='VALID')validCount++;
      else if(status==='DUPLICATE')duplicateCount++;
      else errorCount++;

      return {
        rowNumber:row.rowNumber,
        status,
        data:{...row,employeeCode:normCode,departmentId,positionId},
        errors,
      };
    });

    res.json({
      totalRows:processedRows.length,
      validCount,
      duplicateCount,
      errorCount,
      rows:processedRows,
    });
  });

  app.post(prefix+'-import/execute',async(req:Authed,res)=>{
    const identity=identityFor(req);if(!['ADMIN','HR'].includes(identity.role))fail(403,'FORBIDDEN');
    const data=z.object({
      skipDuplicates:z.boolean().default(true),
      rows:z.array(z.object({
        employeeCode:code,
        fullName:z.string().trim().min(1).max(150),
        hireDate:date,
        birthDate:date.nullable().optional(),
        phone:z.string().trim().max(32).nullable().optional(),
        personalEmail:z.string().trim().email().max(254).nullable().optional(),
        address:z.string().trim().max(500).nullable().optional(),
        departmentId:uuid.nullable().optional(),
        positionId:uuid.nullable().optional(),
      })),
    }).strict().parse(req.body);

    let importedCount=0;
    let skippedCount=0;

    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);
      const existingCodes=new Set((await db.query('SELECT upper(btrim(employee_code)) AS code FROM employees WHERE organization_id=$1 FOR UPDATE',[identity.orgId])).rows.map(r=>r.code));

      for(const row of data.rows){
        if(existingCodes.has(row.employeeCode)){
          if(data.skipDuplicates){
            skippedCount++;
            continue;
          } else {
            fail(409,'EMPLOYEE_CODE_EXISTS');
          }
        }

        const id=randomUUID();
        await context(db,identity,row.hireDate,'PROFILE_CREATED');
        await db.query(`INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date,birth_date,phone,personal_email,address,department_id,position_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id,identity.orgId,row.employeeCode,row.fullName,row.hireDate,row.birthDate??null,row.phone??null,row.personalEmail??null,row.address??null,row.departmentId??null,row.positionId??null]);

        existingCodes.add(row.employeeCode);
        importedCount++;
      }

      await audit(db,'EMPLOYEES_BATCH_IMPORTED',identity.userId,identity.orgId,undefined,{importedCount,skippedCount});
    });

    res.json({importedCount,skippedCount,insertedCount:importedCount,failedCount:skippedCount});
  });

  // --- 6. Account Linking and Labor Contracts ---
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
