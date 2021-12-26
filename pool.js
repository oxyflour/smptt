// @ts-check
'use strict'

const net = require('net'),
  debug = require('debug')

function hex(id) {
  return (0x100000000 + id).toString(16).slice(1)
}

function throttle(fn, interval) {
  /**
   * @type { any }
   */
  let timeout = 0
  return function(...args) {
    timeout = timeout || setTimeout(_ => {
      timeout = 0
      fn.apply(this, args)
    }, interval)
  }
}

function debounce(fn, delay) {
  /**
   * @type { any }
   */
  let timeout = 0
  return function(...args) {
    timeout && clearTimeout(timeout)
    timeout = setTimeout(_ => {
      timeout = 0
      fn.apply(this, args)
    }, delay)
  }
}

/**
 * @typedef { import('./protocol').Sock } Sock
 */

/**
 * 
 * @typedef { Object } ConnOpts 
 * @property { number } ConnOpts.sockSelectMaxPing
 * @property { number } ConnOpts.sockMaxAcknowledgeOffset
 * @property { number } ConnOpts.sockAcknowledgeInterval
 * @property { number } ConnOpts.ioMaxBufferSize
 * @property { number } ConnOpts.ioMinBufferSize
 * @property { number } ConnOpts.ioFlushInterval
 */

/**
 * 
 * @param { number } id 
 * @param { net.Socket } sock 
 * @param { ConnOpts } opts 
 * @returns 
 */
function createConn(id, sock, opts) {
  const log = debug('smptt:' + hex(id))
  log('init')

  let lastActive = Date.now(),
    netSentBytes = 0,
    netRecvBytes = 0,
    peerSentCount = { },
    peerRecvCount = { }

  /**
   * @type { Sock[] }
   */
  const peers = [ ]

  /**
   * 
   * @param { Sock } peer 
   * @returns { Sock }
   */
  function add(peer) {
    lastActive = Date.now()
    if (peers.indexOf(peer) === -1) {
      peers.push(peer)
    }
    return peer
  }

  /**
   * 
   * @param { Sock } peer 
   */
  function remove(peer) {
    peers.splice(peers.indexOf(peer), 1)
  }

  /**
   * 
   * @returns { Sock }
   */
  function select() {
    peers.forEach(peer => {
      peer.selectOrder =
        (peer.bufferSize + 1 + Math.random() * 0.1) *
        (peer.averagePing > opts.sockSelectMaxPing * 1000 ? 1e9 : (peer.averagePing || 10000))
    })
    return peers.sort((a, b) => a.selectOrder - b.selectOrder)[0]
  }

  const ioBuffer = [ ]
  let ioBufStart = 0
  const throttleFlush = throttle(() => {
    let peer = select()
    while (ioBufStart < ioBuffer.length && peer) {
      const peerId = peer.usedPeerId = peer.usedPeerId || Math.random()
      peerSentCount[peerId] = (peerSentCount[peerId] || 0) + 1

      const buf = ioBuffer[ioBufStart ++]
      peer.send('data', buf.id, buf.index, buf.body)
      peer = select()
    }

    if (ioBuffer.length > opts.ioMaxBufferSize) {
      const delta = opts.ioMaxBufferSize - opts.ioMinBufferSize
      ioBuffer.splice(0, delta)
      ioBufStart -= delta
    }
  }, opts.ioFlushInterval)

  /**
   * 
   * @param { number } index 
   */
  function rescue(index) {
    const buf = ioBuffer.find(buf => buf.index === index),
      peer = buf && select()
    if (buf && peer) {
      log('rescue ' + index)
      peer.send('data', buf.id, buf.index, buf.body)
    }
    else {
      const indices = ioBuffer.map(buf => buf.index)
      if (index < indices[0]) {
        const start = indices[0], end = indices[indices.length - 1]
        log('can not rescue ' + index + ' (' + start + ' ~ ' + end + ')')
      }
    }
  }

  let isPaused = false
  function pauseIfNotAcknowledged() {
    if (!(ioBufIndex < ioMaxAckIndex + opts.sockMaxAcknowledgeOffset) && !isPaused) {
      log('paused at ' + ioBufIndex)
      isPaused = true
      sock.pause()
    }
  }

  let ioBufIndex = 0
  function emit(body) {
    const index = ioBufIndex ++
    ioBuffer.push({ id, index, body })
    throttleFlush()
    pauseIfNotAcknowledged()
  }

  function sendAcknowledge(index) {
    const peer = select()
    if (peer && !isDestroyed) {
      peer.send('ack', id, index)
    }
  }

  const sendRequestDebounced = debounce((index) => {
    const peer = select()
    if (peer && !isDestroyed) {
      log('request ' + index)
      peer.send('req', id, index)
    }
  }, 3000)

  const netBuffer = { }
  let netBufIndex = 0
  /**
   * 
   * @param { number } index 
   * @param { Buffer } buf 
   * @param { Sock } peer 
   */
  function recv(index, buf, peer) {
    lastActive = Date.now()

    const peerId = peer.usedPeerId = peer.usedPeerId || Math.random()
    peerRecvCount[peerId] = (peerRecvCount[peerId] || 0) + 1

    netBuffer[index] = buf
    while (buf = netBuffer[netBufIndex]) {
      if (buf.length) {
        sock.write(buf)
        netSentBytes += buf.length
        delete netBuffer[netBufIndex ++]
        sendRequestDebounced(netBufIndex)
        if (netBufIndex % opts.sockAcknowledgeInterval === 0) {
          sendAcknowledge(netBufIndex)
        }
      }
      else {
        destroy()
        break
      }
    }
  }

  let ioMaxAckIndex = 0
  /**
   * 
   * @param { number } index 
   */
  function acknowledge(index) {
    ioMaxAckIndex = Math.max(index, ioMaxAckIndex)
    if (ioBufIndex < ioMaxAckIndex + opts.sockMaxAcknowledgeOffset && isPaused) {
      log('resumed at ' + ioBufIndex)
      isPaused = false
      sock.resume()
    }
  }

  let isDestroyed = false
  function destroy() {
    if (!isDestroyed) {
      isDestroyed = true
      log('destroy (sent %d [%s], recv %d [%s])',
        netSentBytes, Object.keys(peerRecvCount).map(id => peerRecvCount[id]).join('/'),
        netRecvBytes, Object.keys(peerSentCount).map(id => peerSentCount[id]).join('/'))
      sock.destroy()
    }
  }

  sock.on('data', buf => {
    lastActive = Date.now()
    netRecvBytes += buf.length
    buf.length && emit(buf)
  })

  sock.on('close', evt => {
    emit()
  })

  sock.on('error', evt => {
    emit()
  })

  return {
    add,
    remove,
    recv,
    rescue,
    acknowledge,
    destroy,
    get lastActive() { return lastActive },
    get isDestroyed() { return isDestroyed },
  }
}

/**
 * 
 * @typedef { ReturnType<createConn> } Conn 
 */

function createPool(opts) {
  opts = Object.assign({
    idleTimeout: 30,
    ioFlushInterval: 5,
    ioMaxBufferSize: 40,
    ioMinBufferSize: 30,
    sockAcknowledgeInterval: 4,
    sockMaxAcknowledgeOffset: 64,
  }, opts)

  const log = debug('smptt:POOL')
  log('init')

  /**
   * @type { Record<string, Conn> }
   */
  const conns = { }

  function check() {
    const lastActive = Date.now() - opts.idleTimeout * 1000
    Object.keys(conns).forEach(key => {
      const conn = conns[key]
      if (conn.isDestroyed || conn.lastActive < lastActive) {
        const reason = conn.isDestroyed ? 'close' : 'timeout'
        conn.destroy()
        delete conns[key]
        log(reason + ' %s (%d left)', key, Object.keys(conns).length)
      }
    })
  }

  /**
   * 
   * @param { number } id 
   * @returns { boolean }
   */
  function has(id) {
    const key = hex(id)
    return !!conns[key]
  }

  /**
   * 
   * @param { number } id 
   * @param { string | net.Socket } [sock]
   * @returns { Conn }
   */
  function open(id, sock) {
    const key = hex(id)
    if (!conns[key]) {
      if (typeof sock === 'string') {
        const st = sock.split(':'),
          port = +st.pop(), host = st.pop()
        sock = net.connect({ host, port })
      }
      conns[key] = createConn(id, sock, opts)
      log('open %s (%d total)', key, Object.keys(conns).length)
    }
    return conns[key]
  }

  /**
   * 
   * @param { (sock: Conn, id: number) => void } fn 
   */
  function eachConn(fn) {
    Object.keys(conns).forEach(id => fn(conns[id], parseInt(id, 16)))
  }

  setInterval(check, 5000)

  return {
    has,
    open,
    eachConn,
  }
}


module.exports = createPool

