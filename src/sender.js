var tls = require('tls'),
	net = require('net'),
	protocol = require('./protocol')

function Sender(addrs, options) {
	var peers = [ /* sock[] */ ],
		conns = { /* connId -> conn */ }

	options = Object.assign({
		connectionTimeout: 30000,
	}, options)

	function checkTimeout() {
		var now = Date.now()
		Object.keys(conns).forEach(connId => {
			if (!(now - conns[connId].lastActive < options.connectionTimeout)) {
				console.log('[S] connection #' + connId + ' timeout')
				conns[connId].destroy()
			}
		})
	}

	function dispatchToConn(connId, packIndex, buffer) {
		var conn = conns[connId]
		if (conn) {
			conn.bufferedData[packIndex] = buffer
			conn.lastActive = Date.now()
		}
		while (conn && conn.bufferedData[conn.expectedIndex]) {
			var buf = conn.bufferedData[conn.expectedIndex]
			try {
				conn.write(buf)
				conn.bytesRecv += buf.length
			}
			catch (e) {
				console.log('[S] write to connection #' + connId.toString(16) + ' failed')
			}
			delete conn.bufferedData[conn.expectedIndex]
			conn.expectedIndex ++
		}
	}

	function sendViaPeer(connId, packIndex, buffer) {
		var connected = peers.filter(p => p.connected),
			socks = connected.length ? connected : peers,
			peer = socks[ Math.floor(Math.random() * socks.length) ]
		if (peer) try {
			peer.write(protocol.pack(connId, packIndex, buffer))
		} catch (e) {
			console.log('[S] write to peer failed when forwarding #' + connId.toString(16))
		}
		return peer
	}

	function addConn(connId, conn) {
		console.log('[S] accept new connection #' + connId.toString(16) + ' (' + Object.keys(conns).length + ')')

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
				console.log('[S] close remote connection #' + connId.toString(16))
				sendViaPeer(connId, 0, new Buffer(0))
			}

			delete conns[connId]

			console.log('[S] close connection #' + connId.toString(16) +
				' (sent: ' + conn.bytesSent +', recv :' + conn.bytesRecv + ')')
		})

		conn.once('error', _ => {
			console.log('[S] connection #' + connId.toString(16) + ' error')
		})

		conn.expectedIndex = packIndex
		conn.bufferedData = { }

		conn.bytesSent = 0
		conn.bytesRecv = 0

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
			buffer = Buffer.concat([buffer, buf], buffer.length + buf.length)

			var data
			while (data = protocol.unpack(buffer)) {
				var conn = conns[data.connId]
				if (conn && data.packIndex > 0) {
					dispatchToConn(data.connId, data.packIndex, data.buffer)
				}
				else if (conn) {
					console.log('[S] connection #' + data.connId.toString(16) + ' closed by remote')
					conn.endedByRemote = true
					conn.destroy()
				}
				else {
					console.log('[S] ignoring package to #' + data.connId.toString(16) +
						':' + data.packIndex + ', ' + data.buffer.length + 'bytes')
				}

				buffer = data.rest
			}
		})

		sock.once('close', _ => {
			console.log('[S] peer disconnected from addr' + index)

			// keep the peer always available
			addPeer(addr, index)
		})

		sock.once('error', _ => {
			console.log('[S] peer error at addr' + index)
		})

		return peers[index] = sock
	}

	addrs.forEach(addPeer)

	return conn => addConn(Math.floor(Math.random() * 0x0fffffff), conn)
}

module.exports = Sender