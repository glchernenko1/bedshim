import type { MessageCode, MessageParams } from './messages'

// Core errors carry a translatable code, the parameters it needs and, where it
// makes sense, the source line. `message` stays a developer-facing string (the
// CLI prints it); the UI renders the translated form.
export class CoreError extends Error {
  readonly code: MessageCode
  readonly params: MessageParams
  readonly line: number | undefined

  constructor(code: MessageCode, params: MessageParams = {}, line?: number) {
    super(line === undefined ? code : `${code} (line ${line})`)
    this.name = 'CoreError'
    this.code = code
    this.params = params
    this.line = line
  }
}
