export type Account={id:string;email:string;fullName:string;role:string;isActive:boolean;userIsActive:boolean;emailVerified:boolean;managerUserId:string|null;createdAt:string};
export const roleLabels:Record<string,string>={ADMIN:'Quản trị viên',HR:'Nhân sự',MANAGER:'Quản lý',EMPLOYEE:'Nhân viên'};
export const statusLabel=(user:Account)=>!user.userIsActive?'Không hoạt động':user.isActive?'Đang hoạt động':'Đã khóa';
