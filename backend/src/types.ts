import type { Request } from 'express';

export type Role = 'EMPLOYEE' | 'HR' | 'MANAGER' | 'ADMIN';

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export const fail = (status: number, code: string): never => {
  throw new HttpError(status, code);
};

export interface Identity {
  userId: string;
  email: string;
  fullName: string;
  orgId: string;
  orgName: string;
  role: Role;
  sessionId: string;
  mfaEnforced?:boolean;
  mfaEnabled?:boolean;
  mfaVerified?:boolean;
  reauthenticatedAt?:string|null;
  idleMinutes?:number;
}

export type Authed = Request & { identity?: Identity };
