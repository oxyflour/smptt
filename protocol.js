// @ts-check
'use strict'

const tls = require('tls'),
  EventEmitter = require('events')

const MAGIC = 0xabcd,
  HEAD_LENGTH = 16

/**
 * @typedef { 'ping' | 'pong' | 'open' | 'data' | 'req' | 'ack' | 'listen'  } MsgTypes
 */

/**
 * @type { Record<string, number> | Record<number, string> }
 */
const eventMap = { }
'ping/pong/open/data/req/ack/listen'.split('/').forEach((name, index) => {
  eventMap[name] = index + 10
  eventMap[index + 10] = name
})

/**
 * 
 * @param { number } evtId
 * @param { number } [connId]
 * @param { number } [packId]
 * @param { Buffer } [body]
 * @returns 
 */
function pack(evtId, connId, packId, body) {
  const head = Buffer.alloc(HEAD_LENGTH)
  head.writeUInt16LE(MAGIC,  0)
  head.writeUInt16LE(evtId,  2)
  head.writeUInt32LE(connId || 0, 4)
  head.writeUInt32LE(packId || 0, 8)
  if (body) {
    head.writeUInt32LE(body.length, 12)
    return Buffer.concat([head, body], body.length + head.length)
  } else {
    head.writeUInt32LE(0, 12)
    return head
  }
}

/**
 * 
 * @param { Buffer } chunk 
 * @returns 
 */
function unpack(chunk) {
  const packages = [ ]

  let startLength = 0
  while (1) {
    if (chunk.length < startLength + HEAD_LENGTH) {
      /* head not ready */
      break
    }

    if (chunk.readUInt16LE(startLength) !== MAGIC) {
      startLength ++
      continue
    }

    const
      evtId  = chunk.readUInt16LE(startLength +  2),
      connId = chunk.readUInt32LE(startLength +  4),
      packId = chunk.readUInt32LE(startLength +  8),
      length = chunk.readUInt32LE(startLength + 12)

    if (chunk.length < startLength + HEAD_LENGTH + length) {
      /* package body not ready */
      break
    }

    const body = chunk.slice(startLength + HEAD_LENGTH, startLength + HEAD_LENGTH + length)
    packages.push({ evtId, connId, packId, body })

    startLength += HEAD_LENGTH + length
  }

  var rest = startLength === 0 ? chunk : chunk.slice(startLength)
  return { packages, rest }
}

/**
 * 
 * @param { import('net').Socket } sock 
 * @returns
 */
function ioSocket(sock) {
  const emitter = new EventEmitter()

  sock.on('error', err => {
    emitter.emit('error', err)
    sock.destroy()
  })

  sock.once('close', _ => {
    emitter.emit('disconnect')
  })

  let bytesSent = 0,
    bytesRecv = 0,
    lastActive = Date.now()

  let rest = Buffer.alloc(0)
  sock.on('data', data => {
    const unpacked = unpack(Buffer.concat([rest, data]))
    unpacked.packages.forEach(data => {
      emitter.emit(eventMap[data.evtId], data)
    })
    rest = unpacked.rest

    bytesRecv += data.length
    lastActive = Date.now()
  })

  return {
    /**
     * 
     * @param { string } evtName 
     * @param { (data: any) => void } cb 
     */
    on(evtName, cb) {
      emitter.on(evtName, cb)
    },
    /**
     * 
     * @param { MsgTypes } evtName 
     * @param { (connId: number, packId: number, body: Buffer) => void } cb 
     */
    recv(evtName, cb) {
      if (!eventMap[evtName]) throw Error('invalid event: ' + evtName)
      emitter.on(evtName, evt => cb(evt.connId, evt.packId, evt.body))
    },
    /**
     * 
     * @param { MsgTypes } evtName 
     * @param { number } connId 
     * @param { number } [packId]
     * @param { string | Buffer } [body]
     */
    send(evtName, connId, packId, body) {
      if (!eventMap[evtName]) throw Error('invalid event: ' + evtName)
      if (typeof body === 'string') body = Buffer.from(body)

      const data = pack(eventMap[evtName], connId, packId, body)
      sock.write(data)

      bytesSent += data.length
      lastActive = Date.now()
    },
    destroy() {
      sock.destroy()
    },
    get bytesSent() {
      return bytesSent
    },
    get bytesRecv() {
      return bytesRecv
    },
    get lastActive() {
      return lastActive
    },
    get bufferSize() {
      return sock.bufferSize
    },
    get addrRemote() {
      return sock.remoteAddress + ':' + sock.remotePort
    },
  }
}

/**
 * 
 * @typedef { ReturnType<ioSocket> } Sock 
 */

/**
 * 
 * @param { } opts 
 * @param { (sock: Sock) => void } cb 
 */
function connect(opts, cb) {
  const sock = tls.connect(opts)

  let isDestroyed = false
  function retryConnect() {
    if (!isDestroyed) {
      isDestroyed = true
      sock.destroy()
      setTimeout(_ => connect(opts, cb), opts.failRetryTimeout || 1000)
    }
  }

  let connectTimeout = setTimeout(retryConnect, 30000)
  sock.once('secureConnect', _ => {
    opts.failRetryTimeout = 1000
    clearTimeout(connectTimeout)
    cb(ioSocket(sock))
  })

  sock.once('error', err => {
    opts.failRetryTimeout = Math.min((opts.failRetryTimeout || 1000) * 2, 30000)
    console.error(new Date(), err, `retry in ${opts.failRetryTimeout / 1000} seconds`)
    retryConnect()
  })
  sock.once('close', _ => {
    retryConnect()
  })
}

/**
 * 
 * @param { } opts 
 * @param { (sock: Sock) => void } cb 
 */
function listen(opts, cb) {
  const server = tls.createServer(opts, sock => {
    cb(ioSocket(sock))
  })
  server.listen(opts.port, opts.host)
}

module.exports = { connect, listen }