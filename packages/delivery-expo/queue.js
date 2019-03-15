const { FileSystem } = require('expo')

const MAX_ITEMS = 64
const PAYLOAD_PATH = `${FileSystem.cacheDirectory}bugsnag`
const filenameRe = /^bugsnag-.*\.json$/

/*
 * This class resembles FIFO queue in which to store undelivered payloads.
 */
module.exports = class UndeliveredPayloadQueue {
  constructor (resource, onerror = () => {}) {
    this._resource = resource
    this._path = `${PAYLOAD_PATH}/${this._resource}`
    this._onerror = onerror
    this._truncating = false
  }

  /*
   * Ensure the persistent cache directory exists
   */
  async init () {
    const { exists, isDirectory } = await FileSystem.getInfoAsync(this._path)
    if (exists && isDirectory) return true
    await FileSystem.makeDirectoryAsync(this._path, { intermediates: true })
  }

  /*
   * Keeps the queue size bounded by MAX_LENGTH
   */
  async _truncate () {
    // this isn't atomic so only enter this method once at any time
    if (this._truncating) return
    this._truncating = true

    try {
      // list the payloads in order
      const payloads = (await FileSystem.readDirectoryAsync(this._path))
        .filter(f => filenameRe.test(f)).sort()

      // figure out how many over MAX_ITEMS we are
      const diff = payloads.length - MAX_ITEMS

      // do nothing if within the limit
      if (diff < 0) {
        this._truncating = false
        return
      }

      // wait for each of the items over the limit to be removed
      await Promise.all(
        payloads.slice(0, diff)
          .map(f => this.remove(`${this._path}/${f}`))
      )

      // done
      this._truncating = false
    } catch (e) {
      this._truncating = false
      this._onerror(e)
    }
  }

  /*
   * Adds an item to the end of the queue
   */
  async enqueue (req) {
    try {
      await this.init()
      await FileSystem.writeAsStringAsync(
        `${this._path}/${generateFilename(this._resource)}`,
        JSON.stringify({ ...req, retries: 0 })
      )
      this._truncate()
    } catch (e) {
      this._onerror(e)
    }
  }

  /*
   * Returns the oldest item in the queue without removing it
   */
  async peek () {
    try {
      const payloads = await FileSystem.readDirectoryAsync(this._path)
      const payloadFileName = payloads.filter(f => filenameRe.test(f)).sort()[0]
      if (!payloadFileName) return null
      const id = `${this._path}/${payloadFileName}`

      try {
        const payloadJson = await FileSystem.readAsStringAsync(id)
        const payload = JSON.parse(payloadJson)
        return { id, payload }
      } catch (e) {
        // if we got here it's because
        // a) JSON.parse failed or
        // b) the file can no longer be read (maybe it was truncated?)
        // in both cases we want to speculatively remove it and try peeking again
        await this.remove(id)
        return this.peek()
      }
    } catch (e) {
      this._onerror(e)
      return null
    }
  }

  /*
   * Removes an item from the queue by its id (full path).
   * Tolerant of errors while removing.
   */
  async remove (id) {
    try {
      await FileSystem.deleteAsync(id)
    } catch (e) {
      this._onerror(e)
    }
  }

  /*
   * Applies the provided updates to an item. This does a 1-level shallow merge on
   * an object, i.e. it replaces top level keys
   */
  async update (id, updates) {
    try {
      const payloadJson = await FileSystem.readAsStringAsync(id)
      const payload = JSON.parse(payloadJson)
      const updatedPayload = { ...payload, ...updates }
      await FileSystem.writeAsStringAsync(id, JSON.stringify(updatedPayload))
    } catch (e) {
      this._onerror(e)
    }
  }
}

// create a random 16 byte uri
const uid = () => {
  return Array(16).fill(1).reduce((accum, val) => {
    return accum + Math.floor(Math.random() * 10).toString()
  }, '')
}

const generateFilename = module.exports.generateFilename = resource =>
  `bugsnag-${resource}-${(new Date()).toISOString()}-${uid()}.json`
