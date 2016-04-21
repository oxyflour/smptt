#!/usr/bin/env node

var net = require('net'),
	tls = require('tls'),
	fs = require('fs'),
	program = require('commander'),
	package = require('./package.json'),
	smptt = require('./index')

program
	.version(package.version)
	.option('-p, --port <number>', 'port number, required', (r, p) => p.concat(parseInt(r)), [ ])
	.option('-P, --peer [addr]', 'peer address like localhost:8081, required as sender', (r, p) => p.concat(r), [ ])
	.option('-t, --target <addr>', 'target address like localhost:8082, required as receiver')
	.option('--ca <file>', 'ca crt file, required when using tls', (r, p) => p.concat(r), [ ])
	.option('--key <file>', 'ssl key file, optional when using tls')
	.option('--cert <file>', 'ssl crt file, optional when using tls')
	.parse(process.argv)

var tlsOpts = {
	withTLS: program.ca.length > 0,
	key: program.key && fs.readFileSync(program.key),
	cert: program.cert && fs.readFileSync(program.cert),
	ca: program.ca.length && program.ca.map(c => fs.readFileSync(c)),
}

function parseAddr(addr, ext) {
	var st = +addr === addr ? ['localhost', addr] : addr.split(':')
	return {
		host: st[0] || 'localhost',
		port: parseInt(st[1] || 8080),

		withTLS: tlsOpts.withTLS,
		key: tlsOpts.key,
		cert: tlsOpts.cert,
		ca: tlsOpts.ca,

		requestCert: true,
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
