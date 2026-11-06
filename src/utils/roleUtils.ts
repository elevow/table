// Role management utilities for admin access control

import { UserRole } from '../types/user';
import { adminEmails } from '../lib/config/env';

/**
 * Parse admin emails from environment variable
 */
export function getAdminEmails(): string[] {
  return adminEmails();
}

/**
 * Check if an email address is configured as an admin
 */
export function isAdminEmail(email: string): boolean {
  const adminEmails = getAdminEmails();
  return adminEmails.includes(email.toLowerCase());
}

/**
 * Determine user role based on email and authentication method
 */
export function determineUserRole(email: string, isGuest: boolean = false): UserRole {
  if (isGuest) {
    return 'guest';
  }
  
  if (isAdminEmail(email)) {
    return 'admin';
  }
  
  return 'player';
}

/**
 * Check if a role has admin privileges
 */
export function hasAdminPrivileges(role: UserRole): boolean {
  return role === 'admin';
}