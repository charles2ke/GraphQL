/**
 * Validation for the User/Post mutations. Each parser returns the normalized
 * values to store plus a list of human-readable issues, mirroring
 * `validateFinanceArgs` so resolvers report every problem at once.
 */

/** Upper bounds that keep the in-memory store from being flooded with oversized values. */
export const MAX_LENGTHS = { name: 100, email: 254, title: 200, content: 10_000 };

// Deliberately permissive: one "@", no whitespace, and a dot in the domain.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isProvided = (value) => value !== undefined && value !== null;

/**
 * Checks a required text field. Single-line fields are trimmed before they are
 * stored; post content keeps its formatting and is only checked.
 */
function readText(issues, field, value, { trim = true } = {}) {
  const text = trim ? value.trim() : value;
  if (value.trim() === '') issues.push(`${field} must not be empty`);
  else if (text.length > MAX_LENGTHS[field]) issues.push(`${field} must be at most ${MAX_LENGTHS[field]} characters`);
  return text;
}

/**
 * Validates and normalizes user fields. With `partial`, omitted (or null)
 * fields are left unchanged, but at least one field must be present.
 *
 * @returns {{ values: { name?: string, email?: string }, issues: string[] }}
 */
export function parseUserInput({ name, email } = {}, { partial = false } = {}) {
  const issues = [];
  const values = {};

  if (partial && !isProvided(name) && !isProvided(email)) issues.push('provide at least one of name or email');
  if (isProvided(name)) values.name = readText(issues, 'name', name);
  if (isProvided(email)) {
    const issueCount = issues.length;
    values.email = readText(issues, 'email', email);
    // Only pattern-check values that already passed the length bound.
    if (issues.length === issueCount && !EMAIL_PATTERN.test(values.email)) issues.push('email must be a valid email address');
  }

  return { values, issues };
}

/**
 * Validates and normalizes post fields; see `parseUserInput` for `partial`.
 *
 * @returns {{ values: { title?: string, content?: string }, issues: string[] }}
 */
export function parsePostInput({ title, content } = {}, { partial = false } = {}) {
  const issues = [];
  const values = {};

  if (partial && !isProvided(title) && !isProvided(content)) issues.push('provide at least one of title or content');
  if (isProvided(title)) values.title = readText(issues, 'title', title);
  if (isProvided(content)) values.content = readText(issues, 'content', content, { trim: false });

  return { values, issues };
}
