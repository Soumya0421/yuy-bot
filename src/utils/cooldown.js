/**
 * src/utils/cooldown.js — In-memory rate limiter
 *
 * Prevents users from spamming commands. Cooldowns are per-user per-action
 * and reset when the process restarts (stored in RAM, not Firebase).
 *
 * Usage:
 *   const { limited, remaining } = checkCooldown(userId, 'imagine', 10);
 *   if (limited) return message.reply(`Wait ${remaining}s!`);
 */

// Map<"userId:action", expiryTimestamp>
const cooldowns = new Map();

/**
 * Check and set a cooldown for a user action.
 * Returns { limited: true, remaining: N } if still on cooldown,
 * or { limited: false, remaining: 0 } and starts the cooldown timer.
 *
 * @param {string} userId
 * @param {string} action  - e.g. 'nlp', 'imagine', 'checkin'
 * @param {number} seconds - cooldown duration in seconds
 */
export function checkCooldown(userId, action, seconds) {
  const key     = `${userId}:${action}`;
  const now     = Date.now();
  const expires = cooldowns.get(key);

  if (expires && now < expires) {
    const remaining = Math.ceil((expires - now) / 1000);
    return { limited: true, remaining };
  }

  // Set (or refresh) the cooldown
  cooldowns.set(key, now + seconds * 1000);
  return { limited: false, remaining: 0 };
}

/**
 * Manually clear a cooldown — useful when a command fails and
 * we don't want to penalize the user.
 *
 * @param {string} userId
 * @param {string} action
 */
export function clearCooldown(userId, action) {
  cooldowns.delete(`${userId}:${action}`);
}
