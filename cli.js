#!/usr/bin/env node

var net = require('net'),
	tls = require('tls'),
	fs = require('fs'),
	program = require('commander'),
	package = require('./package.json'),
	smptt = require('./index')

program
	.version(package.version)
	.option('-p, --port <n>', 'port number, required',
		(r, p) => p.concat(parseInt(r)), [ ])
	.option('--key <file>', 'tls key file, required when using tls')
	.option('--cert <file>', 'tls crt file, optional when using tls')
	.option('--ca <file>', 'ca crt file, optional when using tls')
	.option('-P, --peer [addr]', 'peer address like localhost:8081, required as sender',
		(r, p) => p.concat(r), [ ])
	.option('-t, --target <addr>', 'target address like localhost:8082, required as receiver')
	.parse(process.argv)

var tlsOpts = {
	withTLS: !!program.key,
	cert: program.cert && fs.readFileSync(program.cert),
	key: program.key && fs.readFileSync(program.key),
	ca: program.ca && fs.readFileSync(program.ca),
}

function parseAddr(addr, ext) {
	var st = addr.split(':')
	return {
		host: st[0] || 'localhost',
		port: parseInt(st[1] || 8080),

		withTLS: tlsOpts.withTLS,
		cert: tlsOpts.cert,
		key: tlsOpts.key,
		ca: tlsOpts.ca,

		requestCert: true,
		// TODO: make it work
		rejectUnauthorized: false,
	}
}

if (program.port.length && program.peer.length && !program.target) {
	console.log('starting as sender at port ' + program.port.join(', '))

	var handler = new smptt.Sender(program.peer.map(parseAddr))
	program.port.forEach(port => net.createServer(handler).listen(port))
}
else if (program.port.length && program.target && !program.peer.length) {
	console.log('starting as receiver at port ' + program.port.join(', '))

	var handler = new smptt.Receiver(parseAddr(program.target))
	program.port.forEach(port => (tlsOpts.withTLS ?
		tls.createServer(tlsOpts, handler) : net.createServer(handler)).listen(port))
}
else {
	program.outputHelp()
	process.exit(-1)
}
