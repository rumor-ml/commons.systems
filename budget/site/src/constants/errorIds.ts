/**
 * Centralized error ID registry for tracking and monitoring errors.
 * Each error ID should be unique and descriptive.
 */
export const errorIds = {
  // Authentication errors
  AUTH_SIGNIN_FAILED: 'AUTH_SIGNIN_FAILED',
  AUTH_SIGNOUT_FAILED: 'AUTH_SIGNOUT_FAILED',
} as const;

export type ErrorId = (typeof errorIds)[keyof typeof errorIds];
