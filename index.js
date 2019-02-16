'use strict'

const net = require('net'),
  fs = require('fs'),
  http = require('http'),
  packageJson = require('./package.json'),
  createPool = require('./pool'),
  protocol = require('./protocol')

module.exports = function(options) {
  options = Object.assign({
    peer: [ ],
    forward: [ ],
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

  const clientPeers = [ ]
  if (options.peer.length && options.forward.length) {
    const pool = createPool(options)
    options.peer.forEach(addr => {
      protocol.connect(parseAddr(addr), peer => {
        peer.startupTime = Date.now()
        peer.lastPings = [ ]
        peer.averagePing = options.pingMax * 1000

        peer.urlRemote = addr
        console.log('[C] connected to ' + addr)
        clientPeers.indexOf(peer) === -1 && clientPeers.push(peer)
        pool.eachConn((conn, id) => conn.add(peer).send('open', id, 0, forwarding[id]))

        peer.on('error', err => {
          console.log('[C] error from ' + addr + ': ', err)
          clientPeers.indexOf(peer) >= 0 && clientPeers.splice(clientPeers.indexOf(peer), 1)
          pool.eachConn(conn => conn.remove(peer))
        })
        peer.on('disconnect', _ => {
          console.log('[C] disconnected from ' + addr)
          clientPeers.indexOf(peer) >= 0 && clientPeers.splice(clientPeers.indexOf(peer), 1)
          pool.eachConn(conn => conn.remove(peer))
        })

        peer.recv('ping', tick => {
          peer.send('pong', tick)
        })
        peer.recv('pong', tick => {
          peer.lastPings = peer.lastPings.concat(Date.now() % 0xffffffff - tick).slice(-5)
          peer.averagePing = peer.lastPings.reduce((a, b) => a + b, 0) / peer.lastPings.length
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

    const forwarding = { }
    options.forward.forEach(forward => {
      const st = forward.split(':'),
        port = st.pop(), host = st.pop(),
        addr = host + ':' + port

      const server = net.createServer(sock => {
        const id = Math.floor(Math.random() * 0xffffffff),
          conn = pool.open(id, sock)
        forwarding[id] = addr
        clientPeers.forEach(peer => conn.add(peer).send('open', id, 0, forwarding[id]))
      })

      console.log('[C] forwarding ' + forward)
      st.length > 1 ? server.listen(+st[1], st[0]) : server.listen(+st[0])
    })
  }

  const serverPeers = [ ]
  if (options.listen.length) {
    const pool = createPool(options)
    options.listen.forEach(addr => {
      protocol.listen(parseAddr(addr), peer => {
        peer.startupTime = Date.now()
        peer.lastPings = [ ]
        peer.averagePing = options.pingMax * 1000

        const addr = peer.addrRemote
        console.log('[S] peer connected', addr)
        serverPeers.indexOf(peer) === -1 && serverPeers.push(peer)

        peer.on('error', err => {
          console.log('[S] error from ' + addr + ': ', err)
          serverPeers.indexOf(peer) >= 0 && serverPeers.splice(serverPeers.indexOf(peer), 1)
          pool.eachConn(conn => conn.remove(peer))
        })
        peer.on('disconnect', _ => {
          console.log('[S] peer disconnected from ', addr)
          serverPeers.indexOf(peer) >= 0 && serverPeers.splice(serverPeers.indexOf(peer), 1)
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

      console.log('[S] listening at ' + addr)
    })
  }

  setInterval(_ => {
    const peers = serverPeers.concat(clientPeers)

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
        res.setHeader('Access-Control-Allow-Headers', req.header ? req.header.origin : '*')
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
          server: serverPeers.map(peerStat),
          client: clientPeers.map(peerStat),
        }, null, 2))
      }
      else if (req.url === '/metrics') {
        res.end([]
          .concat(serverPeers.map(peer => ({ peer, type: 'server', url: peer.urlRemote || peer.addrRemote })))
          .concat(clientPeers.map(peer => ({ peer, type: 'client', url: peer.urlRemote || peer.addrRemote })))
          .map(({ peer, type, url }) => [
              `smptt_${type}_ping_milliseconds{addr="${url}"} ${peer.averagePing}`,
              `smptt_${type}_sent_bytes{addr="${url}"} ${peer.bytesSent}`,
              `smptt_${type}_recv_bytes{addr="${url}"} ${peer.bytesRecv}`,
          ].join('\n'))
          .join('\n') + '\n')
      }
    })
    const st = options.apiAddress.split(':')
    st.length > 1 ? server.listen(st[1], st[0]) : server.listen(st[0])

    console.log('[S] api server at ' + options.apiAddress)
  }
}
