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
	.option('-P, --peer <addr>', 'peer address like localhost:8081, required as sender', (r, p) => p.concat(r), [ ])
	.option('-t, --target <addr>', 'target address like localhost:8082, required as receiver')
	.option('--ca <file>', 'ca crt file, required when using tls', (r, p) => p.concat(r), [ ])
	.option('--key <file>', 'ssl key file, required when using tls')
	.option('--cert <file>', 'ssl crt file, required when using tls')
	.option('--pfx <file>', 'a single pfx file in replace of ca/key/crt files')
	.parse(process.argv)

var tlsOpts = {
	withTLS: program.key || program.cert || program.ca || program.pfx,
	key: program.key && fs.readFileSync(program.key),
	cert: program.cert && fs.readFileSync(program.cert),
	ca: program.ca.length && program.ca.map(c => fs.readFileSync(c)),
	pfx: program.pfx && fs.readFileSync(program.pfx),
	requestCert: true,
	rejectUnauthorized: true,
}

function parseAddr(addr) {
	var st = +addr === addr ? ['', addr] : addr.split(':')
	return {
		host: st[0] || 'localhost',
		port: parseInt(st[1] || 8080),
	}
}

if (tlsOpts.withTLS && !tlsOpts.pfx && !(!tlsOpts.key || !tlsOpts.cert || tlsOpts.ca)) {
	console.log('A single pfx file or a group of key/cert/ca files are required to use tls')
	process.exit(-1)
}
else if (program.port.length && program.peer.length && !program.target) {
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
