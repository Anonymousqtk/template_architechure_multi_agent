export const englishErrors: Record<string, string> = {
  UNIT_NOT_FOUND: 'The unit was not found or you do not have access.',
  UNIT_ADMIN_UNAVAILABLE: 'The administrator email must belong to an active account with a verified email address.',
  UNIT_CURRENT: 'Switch to another unit before archiving your current unit.',
  INVALID_PASSKEY: 'Could not verify the passkey. Try again or use your password.',
  PASSKEY_CHALLENGE_EXPIRED: 'The verification request has expired. Try again.',
  PASSKEY_LIMIT: 'This account has 10 passkeys. Remove one before adding another.',
  PASSKEY_EXISTS: 'This passkey is already registered.',
  MFA_REQUIRED: 'Complete two-factor authentication on the Security page.',
  REAUTH_REQUIRED: 'Reauthenticate on the Security page before continuing.',
  REAUTH_CANCELLED: 'Verification was cancelled. No action was performed.',
  INVALID_FACTOR: 'The code is invalid or has already been used. Wait for a new code or use an unused recovery code.',
  LAST_ADMIN_REQUIRED: 'The organization must retain at least one active administrator.',
  SELF_CHANGE_FORBIDDEN: 'You cannot change your own role or lock your own account.',
  INVALID_MANAGER: 'Select an active manager in the same organization.',
  FILE_TOO_LARGE: 'The file exceeds the maximum size. Choose a smaller file.',
  EMPLOYEE_NOT_FOUND: 'The employee record was not found within your access scope.',
  EMPLOYEE_CODE_EXISTS: 'The employee code already exists in this organization.',
  STALE_RECORD: 'The data has changed. Reload the record before saving.',
};

export const englishFieldLabels: Record<string, string> = {
  employeeCode: 'Employee code', fullName: 'Full name', hireDate: 'Hire date',
  birthDate: 'Date of birth', phone: 'Personal phone', personalEmail: 'Personal email',
  address: 'Contact address', bankName: 'Bank name', bankAccountNumber: 'Bank account number',
  bankAccountName: 'Bank account holder', userId: 'Linked account',
};
