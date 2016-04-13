var net = require('net'),
	protocol = require('./protocol')

function Receiver(target) {
	var peers = { /* connId -> sock[] */ },
		conns = { /* connId -> conn */ }

	function checkoutTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			if (!(now - conns[connId].lastActive < 30000)) {
				console.log('[R] connection #' + connId + ' timeout')
				conns[connId].end()
			}
		})
	}

	function dispatchToConn(connId, packIndex, buffer) {
		var conn = conns[connId]
		if (conn) {
			conn.bufferedData[packIndex] = buffer
			conn.lastActive = Date.now()
		}
		while (conn && !conn.ended && conn.bufferedData[conn.expectedIndex]) {
			conn.write(conn.bufferedData[conn.expectedIndex])
			conn.expectedIndex ++
		}
		return conn
	}

	function sendViaPeer(connId, packIndex, buffer) {
		var list = peers[connId],
			peer = list && list[ Math.floor(Math.random() * list.length) ]
		if (peer)
			peer.write(protocol.pack(connId, packIndex, buffer))
		return peer
	}

	function addConn(connId, conn) {
		console.log('[R] create new connection #' + connId.toString(16))

		var packIndex = 1

		conn.on('data', buf => {
			if (sendViaPeer(connId, packIndex, buf)) packIndex ++

			conn.lastActive = Date.now()
		})

		conn.once('end', _ => {
			conn.ended = true

			if (!conn.endedByRemote)
				sendViaPeer(connId, 0, new Buffer(0))

			delete conns[connId]
			delete peers[connId]

			console.log('[R] destroy connection #' + connId.toString(16))
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }
		conn.lastActive = Date.now()

		checkoutTimeout()

		return conns[connId] = conn
	}

	function addPeer(sock) {
		console.log('[R] peer connected')

		var buffer = new Buffer(0)

		sock.on('data', buf => {
			buffer = Buffer.concat([buffer, buf])

			var data
			while (data = protocol.unpack(buffer)) {
				var list = peers[data.connId] || (peers[data.connId] = [ ])
				if (list.indexOf(sock) === -1) list.push(sock)

				var conn = conns[data.connId] ||
					addConn(data.connId, net.connect(target))
				if (conn && data.packIndex > 0) {
					dispatchToConn(data.connId, data.packIndex, data.buffer)
				}
				else if (conn) {
					conn.endedByRemote = true
					conn.end()
				}

				buffer = data.rest
			}
		})

		sock.once('end', _ => {
			Object.keys(peers).forEach(connId => {
				peers[connId] = peers[connId].filter(p => p !== sock)
			})

			console.log('[R] peer disconnected')
		})

		return sock
	}

	return addPeer
}

module.exports = Receiver