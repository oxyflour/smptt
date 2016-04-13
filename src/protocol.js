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

const unpack = function(buffer) {
	var headLength = 4 * 4
	if (buffer.length < headLength) {
		/* head not ready */
		return
	}

	var readFunc
	if ((readFunc = 'readUInt32LE') && buffer[readFunc](0) != MAGIC &&
		(readFunc = 'readUInt32BE') && buffer[readFunc](0) != MAGIC) {
		throw 'seems not a valid package'
		return
	}

	var connId = buffer[readFunc](4),
		packIndex = buffer[readFunc](8),
		bufLength = buffer[readFunc](12)

	if (buffer.length < headLength + bufLength) {
		/* buffer body not ready */
		return
	}

	var buf = buffer.slice(headLength, headLength + bufLength),
		rest = buffer.slice(headLength + bufLength)

	return { connId, packIndex, buffer:buf, rest }
}

module.exports = { MAGIC, pack, unpack }