/**
 * src/utils/logger.js — Colorized console logger
 *
 * A simple, zero-dependency logger that outputs color-coded messages
 * to the console with a timestamp prefix. No external packages needed.
 *
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.info('Bot started');
 *   logger.error('Something broke');
 */

const COLORS = {
  reset:   '\x1b[0m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  gray:    '\x1b[90m',
};

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export const logger = {
  /** General information — blue/cyan */
  info: (msg) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.cyan}INFO ${COLORS.reset}  ${msg}`),

  /** Success / startup confirmation — green */
  success: (msg) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.green}OK   ${COLORS.reset}  ${msg}`),

  /** Non-fatal warnings — yellow */
  warn: (msg) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.yellow}WARN ${COLORS.reset}  ${msg}`),

  /** Errors — red */
  error: (msg) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.red}ERR  ${COLORS.reset}  ${msg}`),

  /** Discord events (message received, interaction fired, etc.) — magenta */
  event: (msg) =>
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.magenta}EVNT ${COLORS.reset}  ${msg}`),
};
