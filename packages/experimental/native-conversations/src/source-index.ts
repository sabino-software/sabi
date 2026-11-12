/** Durable source-to-Session assignments prevent a refresh from cloning a newly created chat. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const assignment = z.object({
  sessionId: z.string().min(1).transform(value => brandString<SessionId>(value)),
  createdAt: z.number().int().nonnegative(),
}).strict()

/** Session lifecycle assigned to the hashed original-source identity. */
export type SourceSessionAssignment = z.infer<typeof assignment>

/** Original IDs and page URLs never become filenames; keys use sourceSessionId's hash. */
export const nativeSourceIndex = defineDomain({
  name: 'native_conversations', version: 1,
  tables: { sources: domainTable<SessionId, SourceSessionAssignment>(assignment) },
})
