#!/usr/bin/env node

var net = require('net'),
	tls = require('tls'),
	fs = require('fs'),
	program = require('commander'),
	package = require('./package.json'),
	smptt = require('./index')

program
	.version(package.version)
	.option('-p, --port <number>', 'listen port, required', (r, p) => p.concat(parseInt(, 10)(r)), [ ])
	.option('-P, --peer <addr>', 'peer address or port, required as sender', (r, p) => p.concat(r), [ ])
	.option('-t, --target <addr>', 'target address, required as receiver')
	.option('--pfx <file>', 'pfx file containning ca/crt/key, required to use tls')
	.parse(process.argv)

var tlsOpts = {
	withTLS: !!program.pfx,
	pfx: program.pfx && fs.readFileSync(program.pfx),
	requestCert: true,
	rejectUnauthorized: true,
}

function parseAddr(addr) {
	var st = parseInt(addr) === +addr ?
		['', addr] :
		addr.split(':')
	return {
		host: st[0] || 'localhost',
		port: parseInt(st[1] || 8080),
	}
}

if (program.port.length && program.peer.length && !program.target) {
	console.log('starting as sender at port ' + program.port.join(', '))

	var useTLS = addr => tlsOpts.withTLS ? Object.assign(addr, tlsOpts) : addr,
		handler = new smptt.Sender(program.peer.map(parseAddr).map(useTLS))
	program.port.forEach(port => net.createServer(handler).listen(port))
}
else if (program.port.length && program.target && !program.peer.length) {
	console.log('starting as receiver at port ' + program.port.join(', '))

	var handler = new smptt.Receiver(parseAddr(program.target)),
		server = _ => tlsOpts.withTLS ? tls.createServer(tlsOpts, handler) : net.createServer(handler)
	program.port.forEach(port => server().listen(port))
}
else {
	program.outputHelp()
	process.exit(-1)
}
