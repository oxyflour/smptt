var tls = require('tls'),
	net = require('net'),
	protocol = require('./protocol')

function Sender(addrs) {
	var peers = [ /* sock[] */ ],
		conns = { /* connId -> conn */ }

	function checkTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			if (!(now - conns[connId].lastActive < 30000)) {
				console.log('[S] connection #' + connId + ' timeout')
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
			delete conn.bufferedData[conn.expectedIndex]
			conn.expectedIndex ++
		}
	}

	function sendViaPeer(connId, packIndex, buffer) {
		var connected = peers.filter(p => p.connected),
			list = connected.length ? connected : peers,
			peer = list[ Math.floor(Math.random() * list.length) ]
		if (peer)
			peer.write(protocol.pack(connId, packIndex, buffer))
		return peer
	}

	function addConn(connId, conn) {
		console.log('[S] accept new connection #' + connId.toString(16))

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

			console.log('[S] close connection #' + connId.toString(16))
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }
		conn.lastActive = Date.now()

		checkTimeout()

		return conns[connId] = conn
	}

	function addPeer(addr, index) {
		console.log('[S] peer connecting to addr' + index + (addr.withTLS ? ' with tls' : ''))

		var sock = addr.withTLS ? tls.connect(addr) : net.connect(addr)

		var buffer = new Buffer(0)
		sock.on('data', buf => {
			buffer = Buffer.concat([buffer, buf])

			var data
			while (data = protocol.unpack(buffer)) {
				var conn = conns[data.connId]
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
			console.log('[S] peer disconnected from addr' + index)

			// keep the peer always available
			addPeer(addr, index)
		})

		return peers[index] = sock
	}

	addrs.forEach(addPeer)

	return conn => addConn(Math.floor(Math.random() * 0x0fffffff), conn)
}

module.exports = Sender