/**
 * src/utils/permissions.js — Permission tier system
 *
 * Maps Discord permission flags to a simple 1–5 tier hierarchy.
 * Used throughout moderation commands to avoid hardcoding role checks.
 *
 * Tiers:
 *   5 OWNER     — server owner
 *   4 ADMIN     — has Administrator permission
 *   3 MODERATOR — can kick/ban/timeout members
 *   2 TRUSTED   — can manage messages
 *   1 MEMBER    — everyone else
 */

import { PermissionFlagsBits } from 'discord.js';

export const TIERS = {
  OWNER:     5,
  ADMIN:     4,
  MODERATOR: 3,
  TRUSTED:   2,
  MEMBER:    1,
};

/**
 * Determine the permission tier of a guild member.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} guildOwnerId - from guild.ownerId
 * @returns {number} TIERS value
 */
export function getTier(member, guildOwnerId) {
  if (member.id === guildOwnerId) return TIERS.OWNER;

  if (member.permissions.has(PermissionFlagsBits.Administrator))
    return TIERS.ADMIN;

  if (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers)      ||
    member.permissions.has(PermissionFlagsBits.KickMembers)
  )
    return TIERS.MODERATOR;

  if (member.permissions.has(PermissionFlagsBits.ManageMessages))
    return TIERS.TRUSTED;

  return TIERS.MEMBER;
}

/**
 * Returns true if the member meets or exceeds the required tier.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} guildOwnerId
 * @param {number} required - TIERS.xxx
 */
export function requireTier(member, guildOwnerId, required) {
  return getTier(member, guildOwnerId) >= required;
}
