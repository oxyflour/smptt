const MAGIC = 0xabcdefab

const pack = function(connId, packIndex, buffer) {
	var array = new Uint32Array(4)
	array[0] = MAGIC
	array[1] = connId
	array[2] = packIndex
	array[3] = buffer.length
	var head = new Buffer(array.buffer)

	return Buffer.concat([head, buffer], buffer.length + head.length)
}

const unpack = function(buf) {
	var headLength = 4 * 4,
		startLength = 0,
		packages = [ ]

	// test magic
	var readFunc
	if ((readFunc = 'readUInt32LE') && buf[readFunc](0) != MAGIC &&
		(readFunc = 'readUInt32BE') && buf[readFunc](0) != MAGIC) {
		throw 'seems not a valid package'
		return
	}

	while (1) {
		if (buf.length < startLength + headLength) {
			/* head not ready */
			break
		}

		var connId    = buf[readFunc](startLength + 4),
			packIndex = buf[readFunc](startLength + 8),
			bufLength = buf[readFunc](startLength + 12)

		if (buf.length < startLength + headLength + bufLength) {
			/* package body not ready */
			break
		}

		var buffer = buf.slice(startLength + headLength, startLength + headLength + bufLength)
		packages.push({ connId, packIndex, buffer })

		startLength += headLength + bufLength
	}

	var rest = startLength === 0 ? buf : buf.slice(startLength)
	return { packages, rest }
}

module.exports = { MAGIC, pack, unpack }