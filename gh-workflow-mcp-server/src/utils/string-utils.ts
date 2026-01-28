/**
 * String utility functions for worktree management
 */

/**
 * Convert text to URL-friendly slug
 *
 * Converts to lowercase, replaces special characters and spaces with hyphens,
 * removes consecutive hyphens, and truncates to max length.
 *
 * @param text - Text to slugify
 * @param maxLength - Maximum length of the slug (default: 50)
 * @returns URL-friendly slug
 */
export function slugify(text: string, maxLength = 50): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Replace non-alphanumeric characters with hyphens
      .replace(/[^a-z0-9]+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
      // Collapse multiple consecutive hyphens
      .replace(/-+/g, '-')
      // Truncate to max length
      .substring(0, maxLength)
      // Remove trailing hyphen if truncation created one
      .replace(/-+$/, '')
  );
}

/**
 * Generate a branch name from issue number and/or title
 *
 * Format:
 * - With issue number: "{issue_number}-{slugified-title}"
 * - Without issue number: "{slugified-description}"
 *
 * @param issueNumber - Optional issue number
 * @param title - Issue title or task description
 * @returns Branch name
 */
export function generateBranchName(issueNumber: number | undefined, title: string): string {
  const slug = slugify(title);

  if (issueNumber !== undefined) {
    return `${issueNumber}-${slug}`;
  }

  return slug;
}
