// @ts-check
'use strict'

const net = require('net'),
  fs = require('fs'),
  http = require('http'),
  packageJson = require('./package.json'),
  createPool = require('./pool'),
  protocol = require('./protocol')

/**
 * @typedef { import('./protocol').Sock } Sock
 */

/**
 * 
 * @typedef { Object } Options 
 * @property { string[] } Options.peer
 * @property { string[] } Options.forward
 * @property { string[] } Options.reverse
 * @property { string[] } Options.listen
 * @property { string } Options.pfx
 * @property { string } Options.apiAddress
 * @property { number } Options.pingMax
 * @property { number } Options.pingInterval
 */

/**
 * 
 * @param { Options } options
 */
module.exports = function(options) {
  options = Object.assign({
    peer: [ ],
    forward: [ ],
    reverse: [ ],
    listen: [ ],
    pintMax: 30,
    pingInterval: 1,
  }, options)

  const pfx = fs.readFileSync(options.pfx)
  function parseAddr(addr) {
    const st = addr.split(':'),
      port = +st.pop(),
      host = st.pop(),
      servername = st.pop() || host
    return {
      pfx, port, host, servername,
      requestCert: true,
      rejectUnauthorized: true,
    }
  }

  /**
   * @type { Set<Sock> }
   */
  const clientPeers = new Set()
  if (options.peer.length && (options.forward.length || options.reverse.length)) {
    const pool = createPool(options)
    options.peer.forEach(addr => {
      protocol.connect(parseAddr(addr), peer => {
        peer.startupTime = Date.now()
        peer.lastPings = [ ]
        peer.averagePing = options.pingMax * 1000

        peer.urlRemote = addr
        console.log('[C] connected to ' + addr)
        clientPeers.add(peer)
        pool.eachConn((conn, id) => conn.add(peer).send('open', id, 0, forwarding[id]))
        options.reverse.forEach(addr => peer.send('listen', 0, 0, addr))

        peer.on('error', err => {
          console.log('[C] error from ' + addr + ': ', err)
          clientPeers.delete(peer)
          pool.eachConn(conn => conn.remove(peer))
        })
        peer.on('disconnect', _ => {
          console.log('[C] disconnected from ' + addr)
          clientPeers.delete(peer)
          pool.eachConn(conn => conn.remove(peer))
        })

        peer.recv('ping', tick => {
          peer.send('pong', tick)
        })
        peer.recv('pong', tick => {
          peer.lastPings = peer.lastPings.concat(Date.now() % 0xffffffff - tick).slice(-5)
          peer.averagePing = peer.lastPings.reduce((a, b) => a + b, 0) / peer.lastPings.length
        })
        peer.recv('open', (id, index, addr) => {
          pool.open(id, addr.toString()).add(peer)
        })
        peer.recv('data', (id, index, body) => {
          pool.has(id) && pool.open(id).recv(index, body, peer)
        })
        peer.recv('req', (id, index) => {
          pool.has(id) && pool.open(id).rescue(index)
        })
        peer.recv('ack', (id, index) => {
          pool.has(id) && pool.open(id).acknowledge(index)
        })
      })
    })

    /**
     * @type { Record<string, string> }
     */
    const forwarding = { }
    options.forward.forEach(forward => {
      const st = forward.split(':'),
        port = st.pop(), host = st.pop(),
        addr = host + ':' + port

      const server = net.createServer(sock => {
        const id = Math.floor(Math.random() * 0xffffffff),
          conn = pool.open(id, sock)
        forwarding[id] = addr
        clientPeers.forEach(peer => conn.add(peer).send('open', id, 0, addr))
      })

      console.log('[C] forwarding ' + forward)
      st.length > 1 ? server.listen(+st[1], st[0]) : server.listen(+st[0])
    })
  }

  /**
   * @type { Set<Sock> }
   */
  const serverPeers = new Set()
  if (options.listen.length) {
    const pool = createPool(options)
    options.listen.forEach(addr => {
      protocol.listen(parseAddr(addr), peer => {
        peer.startupTime = Date.now()
        peer.lastPings = [ ]
        peer.averagePing = options.pingMax * 1000

        const addr = peer.addrRemote
        console.log('[S] peer connected', addr)
        serverPeers.add(peer)

        peer.on('error', err => {
          console.log('[S] error from ' + addr + ': ', err)
          serverPeers.delete(peer)
          Object.values(listening).forEach(item => item.peers.delete(peer))
          pool.eachConn(conn => conn.remove(peer))
        })
        peer.on('disconnect', _ => {
          console.log('[S] peer disconnected from ', addr)
          serverPeers.delete(peer)
          Object.values(listening).forEach(item => item.peers.delete(peer))
          pool.eachConn(conn => conn.remove(peer))
        })

        peer.recv('ping', tick => {
          peer.send('pong', tick)
        })
        peer.recv('pong', tick => {
          peer.lastPings = peer.lastPings.concat(Date.now() % 0xffffffff - tick).slice(-5)
          peer.averagePing = peer.lastPings.reduce((a, b) => a + b, 0) / peer.lastPings.length
        })
        peer.recv('open', (id, index, addr) => {
          pool.open(id, addr.toString()).add(peer)
        })
        peer.recv('data', (id, index, body) => {
          pool.has(id) && pool.open(id).recv(index, body, peer)
        })
        peer.recv('req', (id, index) => {
          pool.has(id) && pool.open(id).rescue(index)
        })
        peer.recv('ack', (id, index) => {
          pool.has(id) && pool.open(id).acknowledge(index)
        })
        peer.recv('listen', (id, index, forward) => {
          serve(peer, forward.toString())
        })
      })

      console.log('[S] listening at ' + addr)
    })

    /**
     * @type { Record<string, { peers: Set<Sock>, addr: string }> }
     */
    const listening = { }
    /**
     * 
     * @param { net.Socket } sock 
     * @param {{ peers: Set<Sock>, addr: string }} opts
     */
    function listen(sock, opts) {
      if (opts.peers.size) {
        const id = Math.floor(Math.random() * 0xffffffff),
          conn = pool.open(id, sock)
        opts.peers.forEach(peer => conn.add(peer).send('open', id, 0, opts.addr))
      } else {
        sock.end()
      }
    }
    /**
     * 
     * @param { Sock } peer 
     * @param { string } forward 
     */
    function serve(peer, forward) {
      const st = forward.split(':'),
        port = st.pop(), host = st.pop(),
        addr = host + ':' + port,
        listenPort = st.length > 1 ? st[1] : st[0]
      if (!listening[listenPort]) {
        const opts = listening[listenPort] = { peers: new Set(), addr: '' },
          server = net.createServer(sock => listen(sock, opts))
        st.length > 1 ? server.listen(+st[1], st[0]) : server.listen(+st[0])
        console.log('[C] reverse forwarding ' + forward)
      }
      const opts = listening[listenPort]
      if (opts.addr !== addr) {
        opts.addr = addr
        opts.peers = new Set()
      }
      opts.peers.add(peer)
    }
  }

  setInterval(_ => {
    const peers = Array.from(serverPeers).concat(Array.from(clientPeers))

    const peer = peers[Math.floor(Math.random() * peers.length)]
    if (peer) {
      peer.averagePing = options.pingMax * 1000
      peer.send('ping', Date.now() % 0xffffffff)
    }

    const now = Date.now()
    peers.forEach(peer => {
      now - peer.lastActive > options.pingMax * 1000 && peer.destroy()
    })
  }, options.pingInterval * 1000)

  if (options.apiAddress) {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html')
        fs.createReadStream(__dirname + '/monitor.html').pipe(res)
      }
      else if (req.url === '/status.json') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Request-Method', '*')
        res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET')
        res.setHeader('Access-Control-Allow-Headers', req.headers ? req.headers.origin : '*')
        const peerStat = peer => ({
          startup: peer.startupTime,
          addr: peer.urlRemote || peer.addrRemote,
          ping: peer.averagePing,
          sent: peer.bytesSent,
          recv: peer.bytesRecv,
        })
        res.end(JSON.stringify({
          pingMax: options.pingMax * 1000,
          version: packageJson.version,
          server: Array.from(serverPeers).map(peerStat),
          client: Array.from(clientPeers).map(peerStat),
        }, null, 2))
      }
      else if (req.url === '/metrics') {
        res.end([]
          .concat(Array.from(serverPeers).map(peer => ({
            peer,
            type: 'server',
            url: peer.urlRemote || peer.addrRemote
          })))
          .concat(Array.from(clientPeers).map(peer => ({
            peer,
            type: 'client',
            url: peer.urlRemote || peer.addrRemote
          })))
          .map(({ peer, type, url }) => [
              `smptt_${type}_ping_milliseconds{addr="${url}"} ${peer.averagePing}`,
              `smptt_${type}_sent_bytes{addr="${url}"} ${peer.bytesSent}`,
              `smptt_${type}_recv_bytes{addr="${url}"} ${peer.bytesRecv}`,
          ].join('\n'))
          .join('\n') + '\n')
      }
    })
    const st = options.apiAddress.split(':')
    st.length > 1 ? server.listen(+st[1], st[0]) : server.listen(st[0])

    console.log('[S] api server at ' + options.apiAddress)
  }
}
