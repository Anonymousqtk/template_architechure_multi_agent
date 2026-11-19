export interface Employee {
 id:string;userId:string|null;employeeCode:string;fullName:string;hireDate:string;
 employmentStatus:'ACTIVE'|'ON_LEAVE'|'TERMINATED';departmentId:string|null;departmentName:string|null;
 positionId:string|null;positionTitle:string|null;managerUserId:string|null;managerName:string|null;
 version:number;canEdit:boolean;birthDate?:string|null;phone?:string|null;personalEmail?:string|null;address?:string|null;
}
export interface EmployeeContract {
 id:string;contractNumber:string;contractType:'PROBATION'|'FIXED_TERM'|'INDEFINITE';startDate:string;endDate:string|null;
 signedOn:string|null;terminationDate:string|null;status:'DRAFT'|'ACTIVE'|'TERMINATED'|'EXPIRED'|'CANCELLED';notes:string|null;version:number;
}
export interface WorkHistory {id:string;effectiveOn:string;reason:string;departmentName:string|null;positionTitle:string|null;managerName:string|null;recordedAt:string}
export interface EmployeePage<T>{items:T[];total:number;page:number;limit:number}
export const employmentLabels={ACTIVE:'Đang làm việc',ON_LEAVE:'Tạm nghỉ',TERMINATED:'Đã nghỉ việc'};
export const contractLabels={DRAFT:'Bản nháp',ACTIVE:'Đang thực hiện',TERMINATED:'Đã chấm dứt',EXPIRED:'Hết hạn',CANCELLED:'Đã hủy'};
export const contractTypeLabels={PROBATION:'Thử việc',FIXED_TERM:'Xác định thời hạn',INDEFINITE:'Không xác định thời hạn'};
