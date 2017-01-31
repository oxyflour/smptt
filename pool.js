'use strict'

const net = require('net'),
  debug = require('debug')

function hex(id) {
  return (0x100000000 + id).toString(16).slice(1)
}

function throttle(fn, interval) {
  let timeout = 0
  return function() {
    timeout = timeout || setTimeout(_ => {
      timeout = 0
      fn.apply(this, arguments)
    }, interval)
  }
}

function debounce(fn, delay) {
  let timeout = 0
  return function() {
    timeout && clearTimeout(timeout)
    timeout = setTimeout(_ => {
      timeout = 0
      fn.apply(this, arguments)
    }, delay)
  }
}

function createConn(id, sock, opts) {
  const log = debug('smptt:' + hex(id))
  log('init')

  let lastActive = Date.now(),
    netSentBytes = 0,
    netRecvBytes = 0,
    peerSentCount = { },
    peerRecvCount = { }

  const peers = [ ]
  function add(peer) {
    lastActive = Date.now()
    if (peers.indexOf(peer) === -1) {
      peers.push(peer)
    }
    return peer
  }

  function remove(peer) {
    peers.splice(peers.indexOf(peer), 1)
  }

  function select() {
    peers.forEach(peer => peer.selectOrder = (peer.bufferSize + 1 + Math.random() * 0.1) * (peer.averagePing || 1000))
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

function createPool(opts) {
  const log = debug('smptt:POOL')
  log('init')

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

  function has(id) {
    const key = hex(id)
    return !!conns[key]
  }

  function open(id, sock) {
    const key = hex(id)
    if (!conns[key]) {
      conns[key] = createConn(id, sock, opts)
      log('open %s (%d total)', key, Object.keys(conns).length)
    }
    return conns[key]
  }

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

