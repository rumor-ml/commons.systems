/**
 * User Profile Component
 * Displays user information when authenticated
 */

import { subscribeToAuthState } from '../auth-state.js';

/**
 * Create user profile element
 * @param {Object} options - Configuration options
 * @param {boolean} options.showAvatar - Show user avatar (default: true)
 * @param {boolean} options.showName - Show display name (default: true)
 * @param {boolean} options.showUsername - Show GitHub username (default: true)
 * @param {boolean} options.showEmail - Show email (default: false)
 * @param {string} options.className - Additional CSS class names
 * @param {string} options.avatarSize - Avatar size in pixels (default: 32)
 * @returns {HTMLElement} Profile container element
 */
export function createUserProfile(options = {}) {
  const {
    showAvatar = true,
    showName = true,
    showUsername = true,
    showEmail = false,
    className = '',
    avatarSize = 32,
  } = options;

  // Create container
  const container = document.createElement('div');
  container.className = `user-profile ${className}`.trim();
  container.style.display = 'none'; // Hidden until authenticated

  // Create avatar
  let avatar = null;
  if (showAvatar) {
    avatar = document.createElement('img');
    avatar.className = 'user-profile__avatar';
    avatar.alt = 'User avatar';
    avatar.width = avatarSize;
    avatar.height = avatarSize;
    container.appendChild(avatar);
  }

  // Create info container
  const info = document.createElement('div');
  info.className = 'user-profile__info';
  container.appendChild(info);

  // Create name element
  let name = null;
  if (showName) {
    name = document.createElement('div');
    name.className = 'user-profile__name';
    info.appendChild(name);
  }

  // Create username element
  let username = null;
  if (showUsername) {
    username = document.createElement('div');
    username.className = 'user-profile__username';
    info.appendChild(username);
  }

  // Create email element
  let email = null;
  if (showEmail) {
    email = document.createElement('div');
    email.className = 'user-profile__email';
    info.appendChild(email);
  }

  // Subscribe to auth state
  const unsubscribe = subscribeToAuthState((state) => {
    updateProfile(state);
  });

  // Store unsubscribe function for cleanup
  container._unsubscribe = unsubscribe;

  function updateProfile(state) {
    const { user, isAuthenticated } = state;

    if (!isAuthenticated || !user) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';

    // Update avatar
    if (avatar && user.photoURL) {
      avatar.src = user.photoURL;
      avatar.alt = `${user.displayName || 'User'} avatar`;
    }

    // Update name
    if (name) {
      name.textContent = user.displayName || 'Anonymous User';
    }

    // Update username
    if (username && user.githubUsername) {
      username.textContent = `@${user.githubUsername}`;
    }

    // Update email
    if (email && user.email) {
      email.textContent = user.email;
    }
  }

  return container;
}

/**
 * Destroy user profile and cleanup listeners
 * @param {HTMLElement} profile - Profile element to destroy
 */
export function destroyUserProfile(profile) {
  if (profile._unsubscribe) {
    profile._unsubscribe();
    delete profile._unsubscribe;
  }
  profile.remove();
}
