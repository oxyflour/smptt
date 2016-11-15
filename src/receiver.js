var net = require('net'),
	protocol = require('./protocol')

function Receiver(target, options) {
	var peers = { /* connId -> sock[] */ },
		conns = { /* connId -> conn */ }

	options = Object.assign({
		connectionTimeout: 30000,
		maxPeerBufferSize: 1 * 1024 * 1024,
		minPeerBufferSize: 256 * 1024,
		throttleInterval: 20,
	}, options)

	function checkTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			var conn = conns[connId]
			if (!(now - conn.lastActive < options.connectionTimeout)) {
				console.log('[R] connection #' + connId + ' timeout, ' +
					Object.keys(conn.bufferedData).length + ' packages pending')
				conn.destroy()
			}
		})
	}

	function throttleStreamFromConnToPeer() {
		Object.keys(conns).map(connId => {
			var conn = conns[connId],
				socks = peers[connId]
			if (conn && socks) {
				if (socks.every(sock => sock.bufferSize > options.maxPeerBufferSize)) {
					if (!conn.paused) {
						conn.paused = true
						conn.pause()
					}
				}
				else if (socks.some(sock => sock.bufferSize < options.minPeerBufferSize)) {
					if (conn.paused) {
						conn.paused = false
						conn.resume()
					}
				}
			}
		})
	}

	function dispatchToConn(connId, packIndex, buffer, peerIndex) {
		var conn = conns[connId]

		if (conn) {
			conn.bufferedData[packIndex] = buffer
			conn.lastActive = Date.now()
		}

		while (conn && conn.bufferedData[conn.expectedIndex]) {
			var buf = conn.bufferedData[conn.expectedIndex]
			try {
				conn.write(buf)
				conn.bytesRecv[peerIndex] = (conn.bytesRecv[peerIndex] || 0) + buf.length
			}
			catch (e) {
				console.log('[R] write to connection #' + connId.toString(16) + ' failed')
			}
			delete conn.bufferedData[conn.expectedIndex]
			conn.expectedIndex ++
		}

		return conn
	}

	function sendViaPeer(connId, packIndex, buffer) {
		var socks = peers[connId] || [ ],
			pairs = socks.map(s => [s, s.bufferSize + Math.random()]),
			peer = pairs.sort((a, b) => a[1] - b[1])[0][0]

		if (peer) try {
			peer.write(protocol.pack(connId, packIndex, buffer))
		} catch (e) {
			console.log('[R] write to peer failed when forwarding #' + connId.toString(16))
		}

		return peer && peer.peerIndex
	}

	function addConn(connId, conn) {
		console.log('[R] create new connection #' + connId.toString(16) + ' (' + Object.keys(conns).length + ')')

		var packIndex = 1

		conn.on('data', buf => {
			var peerIndex = sendViaPeer(connId, packIndex, buf)
			if (peerIndex >= 0) {
				packIndex ++
				conn.bytesSent[peerIndex] = (conn.bytesSent[peerIndex] || 0) + buf.length
			}

			conn.lastActive = Date.now()
		})

		conn.once('close', _ => {
			if (!conn.endedByRemote) {
				console.log('[R] closing remote connection #' + connId.toString(16))
				sendViaPeer(connId, 0, new Buffer(0))
			}

			delete conns[connId]
			delete peers[connId]

			var vals = obj => Object.keys(obj).map(key => obj[key])
			console.log('[R] destroy connection #' + connId.toString(16) +
				' (recv: ' + (vals(conn.bytesRecv).join('/') || 0) +
				', sent: ' + (vals(conn.bytesSent).join('/') || 0) + ')')
		})

		conn.once('error', _ => {
			console.log('[R] connection #' + connId.toString(16) + ' error')
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }

		conn.bytesSent = { }
		conn.bytesRecv = { }

		conn.lastActive = Date.now()

		checkTimeout()

		return conns[connId] = conn
	}

	function addPeer(sock) {
		sock.peerIndex = Math.floor(Math.random() * 0xffffffff)

		console.log('[R] peer connected')

		var buffer = new Buffer(0)

		sock.on('data', buf => {
			var unpacked = protocol.unpack(Buffer.concat([buffer, buf]))
			
			unpacked.packages.forEach(data => {
				if (data.connId === 0) return

				var socks = peers[data.connId] || (peers[data.connId] = [ ])
				if (socks.indexOf(sock) === -1) socks.push(sock)

				var conn = conns[data.connId] ||
					addConn(data.connId, net.connect(target))
				if (conn && data.packIndex > 0) {
					dispatchToConn(data.connId, data.packIndex, data.buffer, sock.peerIndex)
				}
				else if (conn && data.packIndex === 0xffffffff) {
					// do nothing
				}
				else if (conn) {
					console.log('[R] connection #' + data.connId + ' closed by remote')
					conn.endedByRemote = true
					conn.destroy()
				}
				else {
					console.log('[R] ignoring package to #' + data.connId.toString(16) +
						':' + data.packIndex + ' (' + data.buffer.length + 'bytes)')
				}
			})

			buffer = unpacked.rest
		})

		sock.once('close', _ => {
			Object.keys(peers).forEach(connId => {
				peers[connId] = peers[connId].filter(p => p !== sock)
			})

			console.log('[R] peer disconnected')
		})

		sock.once('error', _ => {
			console.log('[R] peer error')
		})

		return sock
	}

	if (options.throttleInterval)
		setInterval(throttleStreamFromConnToPeer, options.throttleInterval)

	return addPeer
}

module.exports = Receiver