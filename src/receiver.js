var net = require('net'),
	protocol = require('./protocol')

function Receiver(target, options) {
	var peers = { /* connId -> sock[] */ },
		conns = { /* connId -> conn */ }

	options = Object.assign({
		connectionTimeout: 30000,
		maxPackIndexDelay: 100,
		maxPeerBufferSize: 1 * 1024 * 1024,
		throttleInterval: 20,
	}, options)

	function checkTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			if (!(now - conns[connId].lastActive < options.connectionTimeout)) {
				console.log('[R] connection #' + connId.toString(16) + ' timeout')
				conns[connId].destroy()
			}
		})
	}

	function throttleStreamFromConnToPeer(connId) {
		var conn = conns[connId],
			socks = peers[connId]
		if (conn && socks) {
			if (socks.every(sock => sock.bufferSize > options.maxPeerBufferSize)) {
				conn.paused = true
				conn.pause()
				setTimeout(_ => throttleStreamFromConnToPeer(connId), options.throttleInterval)
			}
			else {
				conn.paused = false
				conn.resume()
			}
		}
	}

	function dispatchToConn(connId, packIndex, buffer) {
		var conn = conns[connId]

		if (conn) {
			conn.bufferedData[packIndex] = buffer
			conn.lastActive = Date.now()
		}

		if (conn && packIndex - conn.expectedIndex > options.maxPackIndexDelay) {
			console.log('[R] package #' + connId.toString(16) + ':' +
				conn.expectedIndex + ' seems too later...')
		}

		while (conn && conn.bufferedData[conn.expectedIndex]) {
			var buf = conn.bufferedData[conn.expectedIndex]
			try {
				conn.write(buf)
				conn.bytesRecv += buf.length
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
		var socks = peers[connId],
			peer = socks && socks.sort((a, b) => a.bufferSize - b.bufferSize)[0]

		if (peer) try {
			peer.write(protocol.pack(connId, packIndex, buffer))
		} catch (e) {
			console.log('[R] write to peer failed when forwarding #' + connId.toString(16))
		}

		if (peer && peer.bufferSize > options.maxPeerBufferSize) {
			throttleStreamFromConnToPeer(connId)
		}

		return peer
	}

	function addConn(connId, conn) {
		console.log('[R] create new connection #' + connId.toString(16) + ' (' + Object.keys(conns).length + ')')

		var packIndex = 1

		conn.on('data', buf => {
			if (sendViaPeer(connId, packIndex, buf)) {
				packIndex ++
				conn.bytesSent += buf.length
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

			console.log('[R] destroy connection #' + connId.toString(16) +
				' (sent: ' + conn.bytesSent +', recv :' + conn.bytesRecv + ')')
		})

		conn.once('error', _ => {
			console.log('[R] connection #' + connId.toString(16) + ' error')
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }

		conn.bytesSent = 0
		conn.bytesRecv = 0

		conn.lastActive = Date.now()

		checkTimeout()

		return conns[connId] = conn
	}

	function addPeer(sock) {
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
					dispatchToConn(data.connId, data.packIndex, data.buffer)
				}
				else if (conn) {
					console.log('[R] connection #' + data.connId + ' closed by remote')
					conn.endedByRemote = true
					conn.destroy()
				}
				else {
					console.log('[R] ignoring package to #' + data.connId.toString(16))
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

	return addPeer
}

module.exports = Receiver