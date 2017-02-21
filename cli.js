#!/usr/bin/env node
'use strict'

const net = require('net'),
	fs = require('fs'),
  program = require('commander'),
  packageJson = require('./package.json'),
  createPool = require('./pool'),
  protocol = require('./protocol')

program
  .version(packageJson.version)
  .option('-F, --forward <[host:]port:remoteHost:remotePort>', 'forward host:port to remoteHost:remotePort, required as client', (r, p) => p.concat(r), [ ])
  .option('-P, --peer <[host:]port>', 'server address, required as client', (r, p) => p.concat(r), [ ])
  .option('-l, --listen <[host:]port>', 'listen address, required as server', (r, p) => p.concat(r), [ ])
  .option('--pfx <string>', 'pfx file path, required')
  .option('--idle-timeout <integer>', 'seconds to wait before closing idle connections. default 30s', parseFloat, 30)
  .option('--ping-interval <integer>', 'seconds to periodically update peer ping. default 1s', parseFloat, 1)
  .option('--io-flush-interval <integer>', 'milliseconds to flush data, default 5ms', parseFloat, 5)
  .option('--io-max-buffer-size <integer>', 'default 40', parseFloat, 40)
  .option('--io-min-buffer-size <integer>', 'default 30', parseFloat, 30)
  .option('--sock-acknowledge-interval <integer>', 'send acknowledge message to another side every * packages. default 4', parseFloat, 4)
  .option('--sock-max-acknowledge-offset <integer>', 'pause socket until last message received. default 64', parseFloat, 64)
  .parse(process.argv)

if (!program.listen.length && !(program.peer.length && program.forward.length)) {
  program.outputHelp()
  process.exit(-1)
}

if (!fs.existsSync(program.pfx)) {
  program.outputHelp()
  process.exit(-1)
}

const pfx = fs.readFileSync(program.pfx)
function parse(addr) {
	const st = addr.split(':'),
    port = +st.pop(),
    host = st.pop(),
    servername = host
	return {
		pfx, port, host, servername,
		requestCert: true,
		rejectUnauthorized: true,
	}
}

if (program.peer.length && program.forward.length) {
  const pool = createPool(program)

  const peers = [ ]
  program.peer.forEach(addr => {
  	protocol.connect(parse(addr), peer => {
      console.log('[C] connected to ' + addr)
      peers.indexOf(peer) === -1 && peers.push(peer)
      pool.eachConn((conn, id) => conn.add(peer).send('open', id, 0, forwarding[id]))

      peer.on('error', err => {
        console.log('[C] error from ' + addr + ': ', err)
        peers.splice(peers.indexOf(peer), 1)
        pool.eachConn(conn => conn.remove(peer))
      })
      peer.on('disconnect', _ => {
        console.log('[C] disconnected from ' + addr)
        peers.splice(peers.indexOf(peer), 1)
        pool.eachConn(conn => conn.remove(peer))
      })

      peer.recv('ping', tick => {
        peer.send('pong', tick)
      })
      peer.recv('pong', tick => {
        peer.lastPings = (peer.lastPings || [ ]).concat(Date.now() % 0xffffffff - tick).slice(-5)
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
  program.forward.forEach(forward => {
    const st = forward.split(':'),
    	port = st.pop(), host = st.pop(),
    	addr = host + ':' + port

    const server = net.createServer(sock => {
      const id = Math.floor(Math.random() * 0xffffffff),
        conn = pool.open(id, sock)
      forwarding[id] = addr
      peers.forEach(peer => conn.add(peer).send('open', id, 0, forwarding[id]))
    })

    console.log('[C] forwarding ' + forward)
    st.length > 1 ? server.listen(+st[1], st[0]) : server.listen(+st[0])
  })

  setInterval(_ => {
    const peer = peers[Math.floor(Math.random() * peers.length)]
    if (peer) {
      peer.averagePing = 9999
      peer.send('ping', Date.now() % 0xffffffff)
    }
  }, program.pingInterval * 1000)
}

if (program.listen.length) {
  const pool = createPool(program)

  const peers = [ ]
  program.listen.forEach(addr => {
  	protocol.listen(parse(addr), peer => {
      const addr = peer.addrRemote
      console.log('[S] peer connected', addr)
      peers.indexOf(peer) === -1 && peers.push(peer)

      peer.on('error', err => {
        console.log('[S] error from ' + addr + ': ', err)
        peers.splice(peers.indexOf(peer), 1)
        pool.eachConn(conn => conn.remove(peer))
      })
      peer.on('disconnect', _ => {
        console.log('[S] peer disconnected from ', addr)
        peers.splice(peers.indexOf(peer), 1)
        pool.eachConn(conn => conn.remove(peer))
      })

      peer.recv('ping', tick => {
        peer.send('pong', tick)
      })
      peer.recv('pong', tick => {
        peer.lastPings = (peer.lastPings || [ ]).concat(Date.now() % 0xffffffff - tick).slice(-5)
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

  setInterval(_ => {
    const peer = peers[Math.floor(Math.random() * peers.length)]
    if (peer) {
      peer.averagePing = 9999
      peer.send('ping', Date.now() % 0xffffffff)
    }
  }, program.pingInterval * 1000)
}
