import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline/promises'

const scryptAsync = promisify(scrypt)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = await rl.question('Dashboard password: ')
rl.close()

if (password.length < 12) {
  console.error('\nUse at least 12 characters. This is the only thing between the internet and your data.')
  process.exit(1)
}

const salt = randomBytes(16)
const key = await scryptAsync(password, salt, 32)

console.log('\nAdd these to your Vercel project and to .env.local:\n')
console.log(`DASHBOARD_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${key.toString('hex')}`)
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`)
