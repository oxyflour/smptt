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
	.option('--key <file>', 'ssl key file, required when using tls')
	.option('--cert <file>', 'ssl crt file, required when using tls')
	.option('--ca <file>', 'ca crt file, required when using tls')
	.parse(process.argv)

var tlsOpts = {
	withTLS: program.key && program.cert && program.ca,
	key: program.key && fs.readFileSync(program.key),
	cert: program.cert && fs.readFileSync(program.cert),
	ca: program.ca && fs.readFileSync(program.ca),
}

function parseAddr(addr, ext) {
	var st = addr.split(':')
	return {
		host: st[0] || 'localhost',
		port: parseInt(st[1] || 8080),

		withTLS: tlsOpts.withTLS,
		key: tlsOpts.key,
		cert: tlsOpts.cert,
		ca: tlsOpts.ca,

		requestCert: true,
		rejectUnauthorized: true,
	}
}

if (program.port.length === 0) {
	console.log('at least one port number is required')
	process.exit(-1)
}
else if (tlsOpts.withTLS && (!tlsOpts.key || !tlsOpts.cert || !tlsOpts.ca)) {
	console.log('key, cert and ca files are required when using tls')
	process.exit(-1)
}
else if (program.port.length && program.peer.length && !program.target) {
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
