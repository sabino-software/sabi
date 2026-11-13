/** Read the packaged command name; legacy and ordinary installations retain dsh. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the installation-owned public command without accepting arbitrary paths.
 * @param resources Installed application's Resources directory.
 * @returns The fixed dsh or sabi command; missing legacy metadata retains dsh.
 */
export function readDesktopCommandName(resources: string): 'dsh' | 'sabi' {
  let text: string
  try { text = readFileSync(join(resources, 'runtime', 'cli', 'command.json'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'dsh'
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || !('name' in value) || (value.name !== 'dsh' && value.name !== 'sabi')) {
    throw new Error('Invalid packaged command identity.')
  }
  return value.name
}
