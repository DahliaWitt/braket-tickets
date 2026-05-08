export interface AuthAccountCredentials {
  email: string;
  password: string;
  name: string;
}

export const SHARED_USER_ACCOUNT: AuthAccountCredentials = {
  email: 'global-user@example.com',
  password: 'GlobalUserPassword123!',
  name: 'Global User',
};

export const SHARED_ADMIN_ACCOUNT: AuthAccountCredentials = {
  email: 'global-admin@example.com',
  password: 'GlobalAdminPassword123!',
  name: 'Global Admin',
};
