/** Native Host service plus its independently mounted optional browser calls. */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })
