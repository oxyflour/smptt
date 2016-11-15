var tls = require('tls'),
	net = require('net'),
	protocol = require('./protocol')

function Sender(addrs, options) {
	var peers = [ /* sock[] */ ],
		conns = { /* connId -> conn */ }

	options = Object.assign({
		connectionTimeout: 30000,
		keepAliveInterval: 2000,
	}, options)

	function checkTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			var conn = conns[connId]
			if (!(now - conn.lastActive < options.connectionTimeout)) {
				console.log('[S] connection #' + connId + ' timeout, ' +
					Object.keys(conn.bufferedData).length + ' packages pending')
				conn.destroy()
			}
		})
	}

	function keepPeerAlive() {
		peers.forEach((peer, index) => {
			try {
				// set connId = 0
				peer.write(protocol.pack(0, 0, new Buffer(0)))
			}
			catch (e) {
				console.log('[S] write to peer failed when pinging #' + index)
			}
		})
	}

	function dispatchToConn(connId, packIndex, buffer, peerIndex) {
		var conn = conns[connId]

		if (conn) {
			conn.bufferedData[packIndex] = { buffer, peerIndex }
			conn.lastActive = Date.now()
		}

		while (conn && conn.bufferedData[conn.expectedIndex]) {
			var data = conn.bufferedData[conn.expectedIndex]
			try {
				conn.write(data.buffer)
				conn.bytesRecv[data.peerIndex] += data.buffer.length
			}
			catch (e) {
				console.log('[S] write to connection #' + connId.toString(16) + ' failed')
			}
			delete conn.bufferedData[conn.expectedIndex]
			conn.expectedIndex ++
		}

		return conn
	}

	function sendViaPeer(connId, packIndex, buffer) {
		var connected = peers.filter(p => p.connected),
			socks = connected.length ? connected : peers,
			pairs = socks.map(s => [s, s.bufferSize + Math.random()]),
			peer = pairs.sort((a, b) => a[1] - b[1])[0][0]

		if (peer) try {
			peer.write(protocol.pack(connId, packIndex, buffer))
		} catch (e) {
			console.log('[S] write to peer failed when forwarding #' + connId.toString(16))
		}

		return socks.indexOf(peer)
	}

	function addConn(connId, conn) {
		console.log('[S] accept new connection #' + connId.toString(16) + ' (' + Object.keys(conns).length + ')')

		peers.forEach(peer => peer.write(protocol.pack(connId, 0xffffffff, new Buffer(0))))

		var packIndex = 1

		conn.on('data', buf => {
			var peerIndex = sendViaPeer(connId, packIndex, buf)
			if (peerIndex >= 0) {
				packIndex ++
				conn.bytesSent[peerIndex] += buf.length
			}

			conn.lastActive = Date.now()
		})

		conn.once('close', _ => {
			if (!conn.endedByRemote) {
				console.log('[S] closing remote connection #' + connId.toString(16))
				sendViaPeer(connId, 0, new Buffer(0))
			}

			delete conns[connId]

			console.log('[S] close connection #' + connId.toString(16) +
				' (sent: ' + conn.bytesSent.join('/') +', recv: ' + conn.bytesRecv.join('/') + ')')
		})

		conn.once('error', _ => {
			console.log('[S] connection #' + connId.toString(16) + ' error')
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }

		conn.bytesSent = peers.map(_ => 0)
		conn.bytesRecv = peers.map(_ => 0)

		conn.lastActive = Date.now()

		checkTimeout()

		return conns[connId] = conn
	}

	function addPeer(addr, index) {
		console.log('[S] start peer #' + index + ' to ' +
			addr.host + ':' + addr.port + (addr.withTLS ? ' with tls' : ''))

		var sock = addr.withTLS ? tls.connect(addr) : net.connect(addr)

		var buffer = new Buffer(0)
		sock.on('data', buf => {
			var unpacked = protocol.unpack(Buffer.concat([buffer, buf]))

			unpacked.packages.forEach(data => {
				var conn = conns[data.connId]
				if (conn && data.packIndex > 0) {
					dispatchToConn(data.connId, data.packIndex, data.buffer, index)
				}
				else if (conn) {
					console.log('[S] connection #' + data.connId.toString(16) + ' closed by remote')
					conn.endedByRemote = true
					conn.destroy()
				}
				else {
					console.log('[S] ignoring package to #' + data.connId.toString(16) +
						':' + data.packIndex + ' (' + data.buffer.length + 'bytes)')
				}
			})

			buffer = unpacked.rest
		})

		sock.once('close', _ => {
			console.log('[S] peer disconnected from addr' + index)

			// keep the peer always available
			setTimeout(_ => addPeer(addr, index), 200)
		})

		sock.once('error', e => {
			console.log('[S] peer error at addr' + index + ' (' + e.message + ')')
		})

		return peers[index] = sock
	}

	addrs.forEach(addPeer)

	if (options.keepAliveInterval > 0)
		setInterval(keepPeerAlive, options.keepAliveInterval)

	return conn => addConn(Math.floor(Math.random() * 0xffffffff), conn)
}

module.exports = Sender