export interface Employee {
 id:string;organizationId?:string;userId:string|null;employeeCode:string;fullName:string;hireDate:string;
 employmentStatus:'ACTIVE'|'ON_LEAVE'|'TERMINATED';departmentId:string|null;departmentName:string|null;
 positionId:string|null;positionTitle:string|null;managerUserId:string|null;managerName:string|null;
 version:number;canEdit:boolean;birthDate?:string|null;phone?:string|null;personalEmail?:string|null;address?:string|null;
 avatarUrl?:string|null;
 bankName?:string|null;bankAccountNumber?:string|null;bankAccountName?:string|null;
}
export interface EmployeeContract {
 id:string;contractNumber:string;contractType:'PROBATION'|'FIXED_TERM'|'INDEFINITE';startDate:string;endDate:string|null;
 signedOn:string|null;terminationDate:string|null;status:'DRAFT'|'ACTIVE'|'TERMINATED'|'EXPIRED'|'CANCELLED';notes:string|null;version:number;
}
export interface WorkHistory {
 id:string;
 effectiveOn:string;
 reason:string;
 departmentName:string|null;
 positionTitle:string|null;
 managerName:string|null;
 recordedAt:string;
 eventType?:string;
 title?:string|null;
 notes?:string|null;
}
export interface DocumentItem {
 id:string;
 fileName:string;
 fileSize:number;
 mimeType:string;
 documentType:'IDENTIFICATION'|'DEGREE_CERTIFICATE'|'LABOR_CONTRACT'|'DECISION'|'RESUME'|'OTHER';
 description:string|null;
 createdAt:string;
}
export interface ImportPreviewRow {
 rowNumber:number;
 data:{
  employeeCode:string;
  fullName:string;
  hireDate:string;
  birthDate?:string|null;
  phone?:string|null;
  personalEmail?:string|null;
  address?:string|null;
  departmentCode?:string|null;
  positionCode?:string|null;
 };
 errors:string[];
 status:'VALID'|'DUPLICATE'|'ERROR';
}
export interface ImportPreviewResult {
 totalRows:number;
 validCount:number;
 duplicateCount:number;
 errorCount:number;
 rows:ImportPreviewRow[];
}
export interface EmployeePage<T>{items:T[];total:number;page:number;limit:number}
export const employmentLabels={ACTIVE:'Đang làm việc',ON_LEAVE:'Tạm nghỉ',TERMINATED:'Đã nghỉ việc'};
export const contractLabels={DRAFT:'Bản nháp',ACTIVE:'Đang thực hiện',TERMINATED:'Đã chấm dứt',EXPIRED:'Hết hạn',CANCELLED:'Đã hủy'};
export const contractTypeLabels={PROBATION:'Thử việc',FIXED_TERM:'Xác định thời hạn',INDEFINITE:'Không xác định thời hạn'};
export const workEventLabels:Record<string,string>={
 PROFILE_CREATED:'Tạo hồ sơ',
 ASSIGNMENT_CHANGED:'Thay đổi phân công',
 TRANSFER:'Điều chuyển',
 APPOINTMENT:'Bổ nhiệm',
 PROMOTION:'Thăng chức',
 AWARD:'Khen thưởng',
 DISCIPLINE:'Kỷ luật',
 SALARY_ADJUSTMENT:'Điều chỉnh lương',
 OTHER:'Khác',
};
export const documentTypeLabels:Record<string,string>={
 IDENTIFICATION:'CCCD / Hộ chiếu',
 DEGREE_CERTIFICATE:'Bằng cấp / Chứng chỉ',
 LABOR_CONTRACT:'Hợp đồng lao động',
 DECISION:'Quyết định bổ nhiệm / điều chuyển',
 RESUME:'Sơ yếu lý lịch / CV',
 OTHER:'Tài liệu khác',
};
