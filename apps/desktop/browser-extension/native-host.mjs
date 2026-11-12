/** Fixed native-messaging relay; website credentials and arbitrary filesystem requests are not exposed. */
import { readFileSync, lstatSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { BrowserFrameDecoder, encodeBrowserFrame } from './framing.mjs'
import { homedir } from 'node:os'

const config = JSON.parse(readFileSync(new URL('./native-host-config.json', import.meta.url), 'utf8'))
if (process.argv[2] !== `chrome-extension://${config.extensionId}/`) process.exit(1)
const directory = config.stateDirectory ?? join(homedir(), 'Library', 'Application Support', config.profileDirectory, 'electron', 'axiom-browser')
const info = lstatSync(directory)
if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) process.exit(1)
const descriptorPath = join(directory, 'connection.json')
const descriptorInfo = lstatSync(descriptorPath)
if (!descriptorInfo.isFile() || descriptorInfo.isSymbolicLink() || (descriptorInfo.mode & 0o077) !== 0 || descriptorInfo.uid !== process.getuid()) process.exit(1)
const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
if (typeof descriptor.socketPath !== 'string' || !descriptor.socketPath.startsWith('/') || !/^[a-f0-9]{64}$/.test(descriptor.key)) process.exit(1)
const socket = connect(descriptor.socketPath)
const input = new BrowserFrameDecoder()
const output = new BrowserFrameDecoder()
const stop = () => { socket.destroy(); process.exitCode = 1; process.stdin.destroy() }
socket.once('connect', () => {
  socket.write(encodeBrowserFrame({ type: 'authenticate', version: 1, key: descriptor.key, origin: process.argv[2] }))
  process.stdin.on('data', bytes => {
    try { input.push(bytes, value => { if (socket.writableLength > 4 * 1024 * 1024) throw new Error('Backpressure'); socket.write(encodeBrowserFrame(value)) }) }
    catch { stop() }
  })
  process.stdin.resume()
})
socket.on('data', bytes => {
  try { output.push(bytes, value => { if (process.stdout.writableLength > 4 * 1024 * 1024) throw new Error('Backpressure'); process.stdout.write(encodeBrowserFrame(value)) }) }
  catch { stop() }
})
socket.on('error', stop)
socket.on('close', () => { process.stdin.destroy() })
process.stdin.on('end', () => { socket.end() })
process.stdin.on('error', stop)
process.stdout.on('error', stop)
