/** Print a reviewable native-host manifest; this command never installs it into a browser profile. */
import { isAbsolute, join } from 'node:path'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
const { values } = parseArgs({ options: { app: { type: 'string' } } })
if (!values.app || !isAbsolute(values.app) || !values.app.endsWith('.app')) throw new Error('Pass --app with the absolute installed Sabi.app path')
const config = JSON.parse(readFileSync(new URL('./native-host-config.json', import.meta.url), 'utf8'))
process.stdout.write(JSON.stringify({ name: config.hostName, description: 'Sabi selected ChatGPT Dot bridge',
  path: join(values.app, 'Contents', 'Resources', 'runtime', 'axiom-browser', 'native-host.sh'), type: 'stdio',
  allowed_origins: [`chrome-extension://${config.extensionId}/`] }, null, 2) + '\n')
